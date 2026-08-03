/**
 * The merge rules. Pure function — no side effects, no React, no UI imports.
 * Same two parents + same rng state always produce the same result.
 */

import { getSpecies, tierMultiplier } from './content';
import { mergeAdvancesPity } from './economy';
import { rollStat } from './hatch';
import { balance } from './content';
import {
  PERCENT_STAT_KEYS,
  STAT_KEYS,
  type Creature,
  type Rng,
  type Stats,
  type StatKey,
} from './models';
import { makeId, pickOne } from './rng';

/** How many merges without a natural perfect roll before one is forced. See mergeWithPity below. */
export const MERGE_PITY_THRESHOLD = balance.mergePityThreshold;

/**
 * Decide which parent is "dominant" (the higher-tier parent).
 * On a tier tie, pick deterministically: the one whose id sorts first.
 */
export function dominantParent(a: Creature, b: Creature): Creature {
  if (a.tier !== b.tier) return a.tier > b.tier ? a : b;
  return a.id <= b.id ? a : b;
}

/** Tier rule: same tier T → T + 1; different tiers → the higher tier. */
export function mergedTier(a: Creature, b: Creature): number {
  return a.tier === b.tier ? a.tier + 1 : Math.max(a.tier, b.tier);
}

/** Type rule: dominant parent's types first, then the other's; dedupe; keep first two. */
export function mergedTypes(a: Creature, b: Creature): string[] {
  const dom = dominantParent(a, b);
  const other = dom === a ? b : a;
  const combined = [...dom.types, ...other.types];
  const unique = combined.filter((t, i) => combined.indexOf(t) === i);
  return unique.slice(0, 2);
}

/**
 * Stat rule: per-stat average of the parents, with the tier's growth
 * multiplier applied ONLY when the merge actually raises the tier
 * (both parents same tier). A cross-tier merge keeps the higher parent's
 * tier but gets no growth multiplier — the average with a weaker parent
 * just pulls its stats down. This is what makes "merge like with like"
 * the correct strategy and closes off cross-tier merging as a free stat
 * pump. See balance.json and content.ts's cumulativeStatMultiplier for
 * how same-tier merges are meant to compound into big numbers over time.
 * Every stat gets its own independent ±variance roll (see rollStat), which
 * is what makes chasing a "perfect roll" on e.g. critChance meaningful even
 * when the rest of a merge's rolls are mediocre.
 *
 * forcedPerfectStat, if given, skips the random roll for that one stat and
 * gives it the best possible value instead (rollPercent 100) — this is how
 * the merge pity system (mergeWithPity below) guarantees a perfect roll
 * without needing a separate code path.
 */
export function mergedStats(
  a: Creature,
  b: Creature,
  tier: number,
  rng: Rng,
  forcedPerfectStat?: StatKey,
): { stats: Stats; statRolls: Stats } {
  const tierIncreased = a.tier === b.tier;
  const mult = tierIncreased ? tierMultiplier(tier) : 1;
  const v = balance.statRollVariance;
  const stats = {} as Stats;
  const statRolls = {} as Stats;
  for (const key of STAT_KEYS) {
    const avg = (a.stats[key] + b.stats[key]) / 2;
    // Percentage stats (crit chance/damage) never take the tier multiplier —
    // they are odds and ratios, not amounts. See rollAllStats in hatch.ts.
    const keyMult = PERCENT_STAT_KEYS.includes(key) ? 1 : mult;
    if (key === forcedPerfectStat) {
      stats[key] = Math.max(1, Math.round(avg * keyMult * (1 + v)));
      statRolls[key] = 100;
      continue;
    }
    const { value, rollPercent } = rollStat(avg * keyMult, rng, v);
    stats[key] = value;
    statRolls[key] = rollPercent;
  }
  return { stats, statRolls };
}

/**
 * merge(creatureA, creatureB) → newCreature.
 * The caller is responsible for removing both parents from the collection
 * and adding the result (see CollectionContext in src/screens/).
 */
export function merge(a: Creature, b: Creature, rng: Rng, forcedPerfectStat?: StatKey): Creature {
  const tier = mergedTier(a, b);
  const dom = dominantParent(a, b);
  const species = getSpecies(dom.speciesId);
  const { stats, statRolls } = mergedStats(a, b, tier, rng, forcedPerfectStat);
  return {
    id: makeId(rng),
    speciesId: species.id,
    name: species.name,
    tier,
    types: mergedTypes(a, b),
    stats,
    statRolls,
    parentIds: [a.id, b.id],
  };
}

/** True if any stat on this creature rolled the maximum possible (100) this merge/hatch. */
export function hasNaturalPerfectRoll(creature: Creature): boolean {
  return STAT_KEYS.some((key) => creature.statRolls[key] === 100);
}

export interface MergeWithPityResult {
  creature: Creature;
  /** Merges since the last natural (or pity-forced) perfect roll — persist this and pass it back in next time. */
  mergesSincePerfectRoll: number;
  /** True if this merge's perfect roll was forced by pity rather than rolled naturally. */
  pityTriggered: boolean;
}

/**
 * Merge, but with a pity system: if MERGE_PITY_THRESHOLD merges pass with no
 * stat naturally rolling 100 anywhere, the next merge guarantees one
 * (randomly chosen) stat rolls perfect. This turns bad luck into its own
 * countdown instead of an unbounded grind, without ever taking away the
 * chance of an early natural perfect roll resetting the counter.
 */
export function mergeWithPity(
  a: Creature,
  b: Creature,
  rng: Rng,
  mergesSincePerfectRoll: number,
): MergeWithPityResult {
  // A merge that costs nothing is invisible to the countdown: it cannot trigger
  // pity, cannot advance it, and cannot reset it. Tier-0 merges are free and
  // eggs are unlimited, so without this a player could farm free merges to
  // force a guaranteed perfect roll — and because gems buy gold and gold buys
  // merge stones, real money would speed that up. That would make money buy a
  // BETTER outcome rather than a faster one, which is the one line DESIGN.md
  // forbids crossing. Defined as "did it cost stones" rather than "is it tier
  // 0" so the rule and the price list can never disagree.
  if (!mergeAdvancesPity(a, b)) {
    return {
      creature: merge(a, b, rng),
      mergesSincePerfectRoll,
      pityTriggered: false,
    };
  }

  const pityTriggered = mergesSincePerfectRoll + 1 >= MERGE_PITY_THRESHOLD;
  const forcedStat = pityTriggered ? pickOne(rng, STAT_KEYS) : undefined;
  const creature = merge(a, b, rng, forcedStat);
  const resetByLuck = !pityTriggered && hasNaturalPerfectRoll(creature);
  return {
    creature,
    mergesSincePerfectRoll: pityTriggered || resetByLuck ? 0 : mergesSincePerfectRoll + 1,
    pityTriggered,
  };
}
