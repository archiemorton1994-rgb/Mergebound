/**
 * The tools a player needs once their collection stops fitting on one screen:
 * searching, filtering, sorting, and the padlock that stops a favourite
 * creature being eaten by a merge.
 *
 * Pure TypeScript — no React, no UI imports, no clock, no randomness. Every
 * function here is a query over a collection the caller owns, and nothing in
 * this file ever mutates what it is handed. That matters more than it sounds:
 * these run inside a grid that re-renders constantly, and a sort that quietly
 * reordered the caller's array would corrupt the save.
 *
 * Locking is the load-bearing part. A merge consumes BOTH parents, so one
 * mis-tap on a grid of eighty creatures permanently destroys the best thing a
 * player owns, with no undo — that is a quit-the-game moment, not an
 * inconvenience. Which is why "which creatures are protected" has exactly one
 * implementation, save.ts's, re-exported below rather than rewritten here. Two
 * copies of that rule that could disagree is a bug waiting to eat somebody's
 * collection: the save layer would restore a lock the merge screen had already
 * decided to ignore.
 */

import { allTypes, creaturePower } from './content';
import { STAT_KEYS, type Creature } from './models';
import { applyAutoLocks, pruneLocks, shouldAutoLock } from './save';

/**
 * Re-exported, never reimplemented. The grid's sort order and the rest of the
 * game must agree on what "stronger" means, and the weighting lives with the
 * balance numbers in content.ts. Display and sorting only — battle resolves
 * from the real stats, never from this.
 */
export { creaturePower };

/**
 * The one definition of "protected", owned by save.ts because it also runs at
 * load time (a migrated save arrives with its perfect creatures already safe).
 */
export { applyAutoLocks, pruneLocks, shouldAutoLock };

// --- filtering --------------------------------------------------------------

export interface CollectionFilter {
  /** Free text, matched against the creature's name and its type names. */
  search?: string;
  /** Show creatures holding ANY of these types. Empty means "no type filter". */
  typeIds?: string[];
  /** Inclusive tier bounds. */
  minTier?: number;
  maxTier?: number;
  lockedOnly?: boolean;
  dualTypeOnly?: boolean;
}

const typeNameById = new Map(allTypes.map((type) => [type.id, type.name]));

/**
 * Everything a search box should match on, folded to lower case once.
 *
 * An unknown type id falls back to the raw id instead of throwing (getType
 * would throw): a save can outlive a type being renamed, and a filter that
 * throws blanks the player's entire collection rather than showing one odd
 * row. Searching the type's display NAME also covers its id, because ids are
 * just the lower-cased names — so typing "ember" works whichever the player
 * has in mind.
 */
function searchableText(creature: Creature): string {
  const typeNames = creature.types.map((id) => typeNameById.get(id) ?? id);
  return [creature.name, ...typeNames].join(' ').toLowerCase();
}

/**
 * Narrow a collection down to what the player asked for. Returns a new array;
 * the caller's is untouched.
 *
 * Every criterion is AND-ed with the others, but the type list is OR-ed within
 * itself: the chips read "show me my Ember and Tide creatures", so requiring
 * all of them would only ever match a creature holding that exact pair — which
 * is what dualTypeOnly is for. An empty type list means no type filter at all,
 * so deselecting the last chip returns the whole collection rather than an
 * empty grid that reads as a broken screen.
 */
export function filterCollection(
  collection: readonly Creature[],
  filter: CollectionFilter,
  lockedIds: readonly string[] = [],
): Creature[] {
  const search = (filter.search ?? '').trim().toLowerCase();
  const typeIds = filter.typeIds ?? [];
  const locked = new Set(lockedIds);

  return collection.filter((creature) => {
    if (search.length > 0 && !searchableText(creature).includes(search)) return false;
    if (typeIds.length > 0 && !creature.types.some((id) => typeIds.includes(id))) return false;
    if (filter.minTier !== undefined && creature.tier < filter.minTier) return false;
    if (filter.maxTier !== undefined && creature.tier > filter.maxTier) return false;
    if (filter.lockedOnly === true && !locked.has(creature.id)) return false;
    if (filter.dualTypeOnly === true && creature.types.length < 2) return false;
    return true;
  });
}

// --- sorting ----------------------------------------------------------------

export type SortKey = 'power' | 'tier' | 'newest' | 'bestRoll' | 'name';
export type SortDirection = 'asc' | 'desc';

/**
 * The best single roll on a creature, 0-100.
 *
 * Deliberately the maximum and not the average. Chasing a perfect roll is a
 * per-stat hunt — a creature can be a 98 on critChance and a 6 on hp at the
 * same time — so the number a player scans a grid for is its best one. An
 * average would bury the exact creature they are looking for underneath a pile
 * of merely consistent ones.
 */
export function bestRoll(creature: Creature): number {
  return STAT_KEYS.reduce((best, key) => Math.max(best, creature.statRolls[key]), 0);
}

/** Which way round a sort key reads naturally: strongest/newest/best first, but names A to Z. */
export function defaultSortDirection(key: SortKey): SortDirection {
  return key === 'name' ? 'asc' : 'desc';
}

/**
 * Compare names without localeCompare, on purpose: its result depends on the
 * device's locale data, so the same collection could come back in two
 * different orders on two phones. An order that varies by handset is not a
 * deterministic one. Case-folded so 'cindret' and 'Cindret' never interleave.
 */
function compareNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

interface Ranked {
  creature: Creature;
  /** Position in the caller's array — see the 'newest' case below. */
  index: number;
}

function compareByKey(key: SortKey, a: Ranked, b: Ranked): number {
  switch (key) {
    case 'power':
      return creaturePower(a.creature) - creaturePower(b.creature);
    case 'tier':
      return a.creature.tier - b.creature.tier;
    case 'bestRoll':
      return bestRoll(a.creature) - bestRoll(b.creature);
    case 'newest':
      // There is no timestamp to read. Creatures are appended to the collection
      // as they are hatched or merged, so the array's own order IS arrival
      // order. Adding a date to Creature would be a save migration for
      // something already recorded — but note the consequence: anything that
      // reorders the stored collection destroys this, so persist it in the
      // order things happened.
      return a.index - b.index;
    case 'name':
      return compareNames(a.creature.name, b.creature.name);
  }
}

/**
 * Sort a collection without touching it — always a new array, always the same
 * order for the same input.
 *
 * Ties fall back to arrival order, and that tiebreak is never flipped by
 * direction. Sorting one way and reversing for the other would reshuffle every
 * group of equal creatures each time the player tapped the direction arrow, so
 * the grid would visibly rearrange items whose sort value had not changed —
 * which reads as the app losing track of things.
 */
export function sortCollection(
  collection: readonly Creature[],
  key: SortKey,
  direction: SortDirection = defaultSortDirection(key),
): Creature[] {
  const ranked: Ranked[] = collection.map((creature, index) => ({ creature, index }));
  const flip = direction === 'desc' ? -1 : 1;
  ranked.sort((a, b) => {
    const byKey = compareByKey(key, a, b);
    if (byKey !== 0) return byKey * flip;
    return a.index - b.index;
  });
  return ranked.map((entry) => entry.creature);
}

// --- locking ----------------------------------------------------------------

export function isLocked(lockedIds: readonly string[], creatureId: string): boolean {
  return lockedIds.includes(creatureId);
}

/**
 * Flip one creature's padlock, returning a new list. The caller's list is never
 * modified.
 *
 * A player CAN unlock a creature that auto-locked itself for a perfect roll.
 * Refusing would be worse than it looks: merging your best creature up a tier
 * is a real and often correct move, and protection that cannot be switched off
 * is a cage rather than a safety net. Note the asymmetry this leaves —
 * applyAutoLocks runs on every load, so an unlocked perfect creature that
 * survives to the next launch comes back protected. That is the right
 * direction to fail in: the cost of the lock reappearing is one extra tap, and
 * the cost of it not reappearing is a destroyed collection.
 */
export function toggleLock(lockedIds: readonly string[], creatureId: string): string[] {
  return isLocked(lockedIds, creatureId)
    ? lockedIds.filter((id) => id !== creatureId)
    : [...lockedIds, creatureId];
}

// --- merge candidates -------------------------------------------------------

export interface MergeCheck {
  ok: boolean;
  /**
   * Shown to the player verbatim, so these are sentences rather than error
   * codes. If you add one, write it the way you would say it out loud.
   */
  reason?: string;
}

/**
 * Whether these two creatures are allowed to merge at all.
 *
 * Two things are deliberately NOT checked here. Affordability: the merge stone
 * cost lives with the wallet in economy.ts, and reaching for it would make
 * every collection query depend on economy state — the commit bar asks both,
 * separately. And whether the merge raises the tier: a cross-tier merge is a
 * legitimate move that rerolls a creature's types and can hand it a hybrid
 * move neither parent had, so "this will not raise the tier" is a warning for
 * the preview panel to make, never a block here.
 *
 * The locked message does not say which of the two it means, because the
 * screen already knows — it badges the padlock on the slot isLocked reports.
 */
export function canMerge(a: Creature, b: Creature, lockedIds: readonly string[] = []): MergeCheck {
  if (a.id === b.id) return { ok: false, reason: 'Pick two different creatures.' };

  const aLocked = isLocked(lockedIds, a.id);
  const bLocked = isLocked(lockedIds, b.id);
  if (aLocked && bLocked) {
    return { ok: false, reason: 'Both of these are locked. Unlock one to merge it.' };
  }
  if (aLocked || bLocked) {
    return { ok: false, reason: 'This one is locked. Unlock it to merge it.' };
  }

  return { ok: true };
}

/**
 * Who to merge this creature with, best candidates first.
 *
 * Same tier only, and that is not a convenience filter. A same-tier merge is
 * the ONLY merge that raises the tier, and the tier multiplier is where all
 * the growth in this game comes from. A cross-tier merge keeps the higher tier
 * and applies no multiplier at all, so its stats are just an average with
 * something weaker — the result is a strictly worse creature than the parent
 * that went in. Cross-tier partners are reached separately, through
 * filterCollection's minTier/maxTier, precisely because that trade has to be
 * chosen on purpose: putting them in a list headed "suggested" would be
 * recommending a stat loss as if it were an upgrade.
 *
 * Locked creatures are absent entirely rather than greyed out. The point of
 * the padlock is that the creature is not on the table.
 *
 * Ordered by power, strongest first, because a merge averages both parents —
 * the strongest partner makes the strongest result, with no exception to
 * explain. Type variety is deliberately not ranked in: there is no honest
 * exchange rate between "one extra type" and "forty more power", and inventing
 * one would put a balance number in code. A player hunting a particular
 * pairing uses the type filter, where the intent is explicit.
 *
 * A locked source creature still gets suggestions — canMerge is the single
 * gate on whether a pair can actually go through, and showing what unlocking
 * would buy beats an unexplained empty list.
 */
export function suggestMergePartners(
  creature: Creature,
  collection: readonly Creature[],
  lockedIds: readonly string[] = [],
): Creature[] {
  const locked = new Set(lockedIds);
  const candidates = collection.filter(
    (other) => other.id !== creature.id && other.tier === creature.tier && !locked.has(other.id),
  );
  return sortCollection(candidates, 'power', 'desc');
}
