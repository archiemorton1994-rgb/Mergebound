/**
 * Save/load serialisation. Pure functions — they turn game state into a
 * string and back, with validation. Actual storage (AsyncStorage) happens
 * in the UI layer (src/screens/CollectionContext.tsx).
 * No React, no UI imports.
 *
 * Save data is versioned. Bumping SAVE_VERSION without a migration wipes
 * every player's collection on their next update — always add a migration
 * path in the same change that changes what's saved.
 *
 * Two rules keep this file safe to extend:
 *  1. Every version branch returns through withDefaults(), so adding a field
 *     is one line in one place instead of one per branch.
 *  2. Missing or broken PARTS are tolerated and rebuilt; only a broken
 *     COLLECTION rejects the save. Losing one cosmetic is recoverable.
 *     Losing a collection is not.
 */

import { defaultBinderAppearance, economy } from './content';
import {
  ONBOARDING_STEPS,
  freshOnboardingSeed,
  isComplete,
  stepForExistingSave,
} from './onboarding';
import { repairCollection } from './repair';
import {
  STAT_KEYS,
  type Binder,
  type BinderAppearance,
  type CampaignProgress,
  type Creature,
  type EconomyState,
  type OnboardingState,
  type OnboardingStep,
  type ShopState,
  type StageProgress,
  type StarCount,
  type Stats,
  type Wallet,
} from './models';

const SAVE_VERSION = 4;

export interface SaveData {
  collection: Creature[];
  /** Merges since the last natural (or pity-forced) perfect stat roll — see merge.ts's mergeWithPity. */
  mergePity: number;
  /** Creature ids the player has protected from being consumed by a merge. */
  lockedIds: string[];
  wallet: Wallet;
  economy: EconomyState;
  campaign: CampaignProgress;
  binder: Binder;
  onboarding: OnboardingState;
  shop: ShopState;
}

interface SaveFile extends SaveData {
  version: number;
}

export function serializeCollection(data: SaveData): string {
  const file: SaveFile = { version: SAVE_VERSION, ...data };
  return JSON.stringify(file);
}

// --- validators -------------------------------------------------------------
// Hand-rolled in the same style as the original isCreature, deliberately: this
// path must never depend on a schema library, because a validation library
// failing to load would take every player's save with it.

function isStats(value: unknown): value is Stats {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return STAT_KEYS.every((k) => typeof s[k] === 'number' && Number.isFinite(s[k]));
}

function isCreature(value: unknown): value is Creature {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c['id'] === 'string' &&
    typeof c['speciesId'] === 'string' &&
    typeof c['name'] === 'string' &&
    typeof c['tier'] === 'number' &&
    Number.isInteger(c['tier']) &&
    Array.isArray(c['types']) &&
    c['types'].length >= 1 &&
    c['types'].length <= 2 &&
    c['types'].every((t) => typeof t === 'string') &&
    isStats(c['stats']) &&
    isStats(c['statRolls']) &&
    Array.isArray(c['parentIds']) &&
    c['parentIds'].every((p) => typeof p === 'string')
  );
}

function isValidMergePity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isWallet(value: unknown): value is Wallet {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Record<string, unknown>;
  return isFiniteNumber(w['gold']) && isFiniteNumber(w['mergeStones']) && isFiniteNumber(w['gems']);
}

function isEconomyState(value: unknown): value is EconomyState {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isFiniteNumber(e['lastCollectedAt']) &&
    isFiniteNumber(e['dayIndex']) &&
    isFiniteNumber(e['stonesEarnedToday']) &&
    isFiniteNumber(e['stonesPurchasedToday']) &&
    isFiniteNumber(e['clockAnomalies'])
  );
}

function isStageProgress(value: unknown): value is StageProgress {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isFiniteNumber(s['bestStars']) &&
    (s['bestStars'] as number) >= 0 &&
    (s['bestStars'] as number) <= 3 &&
    isFiniteNumber(s['bestRounds']) &&
    isFiniteNumber(s['clears']) &&
    isFiniteNumber(s['attemptsToday']) &&
    isFiniteNumber(s['attemptsDay'])
  );
}

function isBinderAppearance(value: unknown): value is BinderAppearance {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a['buildId'] === 'string' &&
    typeof a['skinToneId'] === 'string' &&
    typeof a['hairStyleId'] === 'string' &&
    typeof a['hairColorId'] === 'string' &&
    typeof a['outfitId'] === 'string' &&
    typeof a['outfitToneId'] === 'string' &&
    typeof a['accentTypeId'] === 'string' &&
    typeof a['markId'] === 'string'
  );
}

/**
 * The step list is imported, never restated here. It used to be a second copy,
 * and a second copy is how a newly added step passes validation in the tutorial
 * and fails it here: the save would be judged corrupt, rebuilt from defaults,
 * and the player would be dropped back at the start of a tutorial they had
 * already half finished. One list, one place to add to.
 */
function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

// --- defaults ---------------------------------------------------------------

function freshWallet(): Wallet {
  return { ...economy.startingWallet };
}

function freshEconomy(): EconomyState {
  return {
    lastCollectedAt: 0,
    dayIndex: -1,
    stonesEarnedToday: 0,
    stonesPurchasedToday: 0,
    clockAnomalies: 0,
  };
}

function freshCampaign(): CampaignProgress {
  return { stages: {}, claimedChests: [] };
}

function freshBinder(): Binder {
  return { name: '', appearance: defaultBinderAppearance() };
}

function freshShop(): ShopState {
  return { purchasedOneTimeIds: [], ownedCosmeticIds: [], equippedCosmetics: {} };
}

/**
 * Creatures whose roll history proves they are exceptional are protected
 * automatically. Applied on migration too, so the update that introduces
 * locking arrives with a player's best creatures already safe rather than
 * asking them to go and protect everything by hand.
 */
export function shouldAutoLock(creature: Creature): boolean {
  return STAT_KEYS.some((key) => creature.statRolls[key] === 100);
}

export function applyAutoLocks(existing: string[], collection: Creature[]): string[] {
  const locked = new Set(existing);
  for (const creature of collection) {
    if (shouldAutoLock(creature)) locked.add(creature.id);
  }
  return [...locked];
}

/** Drop locks pointing at creatures that no longer exist (merged away, or a corrupt entry). */
export function pruneLocks(lockedIds: string[], collection: Creature[]): string[] {
  const ids = new Set(collection.map((c) => c.id));
  return lockedIds.filter((id) => ids.has(id));
}

/**
 * Fill in every field a SaveData needs, from whatever subset a given save
 * version actually stored. Every version branch returns through here so a new
 * field is added once, not once per branch.
 *
 * An existing player is never sent back to the tutorial: a save that already
 * has creatures is treated as onboarding-complete. A save with an empty
 * collection — someone who installed and never hatched — still gets theirs.
 */
export function withDefaults(
  partial: Pick<SaveData, 'collection' | 'mergePity'> & Partial<SaveData>,
): SaveData {
  const collection = repairCollection(partial.collection);
  const lockedIds = pruneLocks(
    applyAutoLocks(partial.lockedIds ?? [], collection),
    collection,
  );

  return {
    collection,
    mergePity: partial.mergePity,
    lockedIds,
    wallet: partial.wallet ?? freshWallet(),
    economy: partial.economy ?? freshEconomy(),
    campaign: partial.campaign ?? freshCampaign(),
    binder: partial.binder ?? freshBinder(),
    // The "veteran skips the tutorial" rule lives in onboarding.ts and is called
    // from here rather than restated, so the two can never disagree about who
    // counts as an existing player. seed 0 means "not drawn yet" — stampFreshSave
    // draws it, because that is where the clock enters the app.
    onboarding: partial.onboarding ?? {
      step: stepForExistingSave(collection),
      seed: 0,
      seenTips: [],
    },
    shop: partial.shop ?? freshShop(),
  };
}

/**
 * Put real timestamps on a save that has never had them. Kept separate from
 * deserializeCollection so that parsing stays a pure string-in/data-out
 * function with no clock in it: the clock enters the app in exactly one place,
 * CollectionContext's load effect.
 *
 * A migrated save is stamped as collected right now and therefore has NO
 * pending idle income. Paying eight hours of earnings for a save that predates
 * idle income existing would be inventing money the player never earned.
 *
 * It also draws the tutorial's egg seed, for the same reason it stamps the
 * clock: nothing else in the game may read the time, and an undrawn seed (0)
 * means every player alive opens the game to the same three eggs. Only an
 * UNFINISHED tutorial draws one — a save part-way through keeps the seed it
 * already had, so a resumed tutorial shows the eggs the player was choosing
 * between, and a veteran's save is never rewritten to no purpose.
 */
export function stampFreshSave(data: SaveData, now: number, dayIndex: number): SaveData {
  const needsTimestamp = data.economy.lastCollectedAt === 0;
  const needsDay = data.economy.dayIndex < 0;
  const needsSeed = data.onboarding.seed === 0 && !isComplete(data.onboarding);
  if (!needsTimestamp && !needsDay && !needsSeed) return data;

  return {
    ...data,
    economy: {
      ...data.economy,
      lastCollectedAt: needsTimestamp ? now : data.economy.lastCollectedAt,
      dayIndex: needsDay ? dayIndex : data.economy.dayIndex,
    },
    onboarding: needsSeed
      ? { ...data.onboarding, seed: freshOnboardingSeed(now) }
      : data.onboarding,
  };
}

// --- v1 → v2 migration -----------------------------------------------------
// v1 creatures had only { hp, atk, def, spd } and no statRolls at all (the
// game shipped before special stats, crit, and roll tracking existed).

const V1_STAT_KEYS = ['hp', 'atk', 'def', 'spd'] as const;

interface CreatureV1 {
  id: string;
  speciesId: string;
  name: string;
  tier: number;
  types: string[];
  stats: { hp: number; atk: number; def: number; spd: number };
  parentIds: string[];
}

function isCreatureV1(value: unknown): value is CreatureV1 {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  const s = c['stats'];
  if (typeof s !== 'object' || s === null) return false;
  const stats = s as Record<string, unknown>;
  return (
    typeof c['id'] === 'string' &&
    typeof c['speciesId'] === 'string' &&
    typeof c['name'] === 'string' &&
    typeof c['tier'] === 'number' &&
    Number.isInteger(c['tier']) &&
    Array.isArray(c['types']) &&
    c['types'].length >= 1 &&
    c['types'].length <= 2 &&
    c['types'].every((t) => typeof t === 'string') &&
    V1_STAT_KEYS.every((k) => typeof stats[k] === 'number' && Number.isFinite(stats[k])) &&
    Array.isArray(c['parentIds']) &&
    c['parentIds'].every((p) => typeof p === 'string')
  );
}

/**
 * Old saves have no data for spAtk/spDef/critChance/critDamage and no
 * roll-quality history, so migrated creatures get reasonable neutral
 * defaults rather than a crash or a wipe: the physical stats they already
 * had carry over exactly, the special stats mirror the physical ones they're
 * closest to, crit gets the same baseline every species starts with, and
 * every roll is marked as a perfectly average (50) roll since we have no
 * record of how good the original roll actually was.
 */
function migrateCreatureV1ToV2(old: CreatureV1): Creature {
  const NEUTRAL_ROLL = 50;
  const BASELINE_CRIT_CHANCE = 5;
  const BASELINE_CRIT_DAMAGE = 150;
  return {
    id: old.id,
    speciesId: old.speciesId,
    name: old.name,
    tier: old.tier,
    types: old.types,
    stats: {
      hp: old.stats.hp,
      atk: old.stats.atk,
      spAtk: old.stats.atk,
      def: old.stats.def,
      spDef: old.stats.def,
      spd: old.stats.spd,
      critChance: BASELINE_CRIT_CHANCE,
      critDamage: BASELINE_CRIT_DAMAGE,
    },
    statRolls: STAT_KEYS.reduce((rolls, key) => {
      rolls[key] = NEUTRAL_ROLL;
      return rolls;
    }, {} as Stats),
    parentIds: old.parentIds,
  };
}

// --- v4 part readers --------------------------------------------------------
// Each of these takes whatever was on disk and returns either a usable value or
// undefined, letting withDefaults rebuild the part. A corrupt cosmetic list
// must never cost somebody their creatures.

function readCampaign(value: unknown): CampaignProgress | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const c = value as Record<string, unknown>;
  const rawStages = c['stages'];
  if (typeof rawStages !== 'object' || rawStages === null) return undefined;

  const stages: Record<string, StageProgress> = {};
  for (const [id, progress] of Object.entries(rawStages as Record<string, unknown>)) {
    // An unknown or malformed stage id is skipped, not rejected — stages are
    // pure data and may be renamed between builds.
    if (isStageProgress(progress)) {
      stages[id] = {
        bestStars: progress.bestStars as StarCount,
        bestRounds: progress.bestRounds,
        clears: progress.clears,
        attemptsToday: progress.attemptsToday,
        attemptsDay: progress.attemptsDay,
      };
    }
  }
  return { stages, claimedChests: isStringArray(c['claimedChests']) ? c['claimedChests'] : [] };
}

function readBinder(value: unknown): Binder | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const b = value as Record<string, unknown>;
  if (typeof b['name'] !== 'string') return undefined;
  if (!isBinderAppearance(b['appearance'])) return undefined;
  return { name: b['name'], appearance: b['appearance'] };
}

function readOnboarding(value: unknown): OnboardingState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const o = value as Record<string, unknown>;
  if (!isOnboardingStep(o['step'])) return undefined;
  return {
    step: o['step'],
    seed: isFiniteNumber(o['seed']) ? o['seed'] : 0,
    seenTips: isStringArray(o['seenTips']) ? o['seenTips'] : [],
  };
}

function readShop(value: unknown): ShopState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const s = value as Record<string, unknown>;
  const equipped = s['equippedCosmetics'];
  return {
    purchasedOneTimeIds: isStringArray(s['purchasedOneTimeIds']) ? s['purchasedOneTimeIds'] : [],
    ownedCosmeticIds: isStringArray(s['ownedCosmeticIds']) ? s['ownedCosmeticIds'] : [],
    equippedCosmetics:
      typeof equipped === 'object' && equipped !== null
        ? Object.fromEntries(
            Object.entries(equipped as Record<string, unknown>).filter(
              ([, v]) => typeof v === 'string',
            ) as [string, string][],
          )
        : {},
  };
}

/**
 * Parse a saved string back into game state, migrating older save versions
 * forward. Throws with a clear message if the data is corrupt or from a
 * version newer than this build understands — callers decide how to surface
 * that. Never silently returns partial data.
 */
export function deserializeCollection(raw: string): SaveData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Save data is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Save data has an unexpected shape');
  }
  const file = parsed as Record<string, unknown>;
  const version = file['version'];
  const rawCollection = file['collection'];
  if (!Array.isArray(rawCollection)) {
    throw new Error('Save data has an unexpected shape');
  }

  // v1: pre-special-stats. No mergePity concept existed yet — starts at 0.
  if (version === 1) {
    if (!rawCollection.every(isCreatureV1)) {
      throw new Error('Save data contains an invalid creature');
    }
    return withDefaults({
      collection: rawCollection.map(migrateCreatureV1ToV2),
      mergePity: 0,
    });
  }

  // v2: current Creature shape, but saved before the pity system existed.
  if (version === 2) {
    if (!rawCollection.every(isCreature)) {
      throw new Error('Save data contains an invalid creature');
    }
    return withDefaults({ collection: rawCollection, mergePity: 0 });
  }

  // v3: collection + pity, but before currencies, campaign, Binder and onboarding.
  if (version === 3) {
    if (!rawCollection.every(isCreature)) {
      throw new Error('Save data contains an invalid creature');
    }
    if (!isValidMergePity(file['mergePity'])) {
      throw new Error('Save data has an invalid mergePity value');
    }
    return withDefaults({ collection: rawCollection, mergePity: file['mergePity'] });
  }

  if (version === SAVE_VERSION) {
    if (!rawCollection.every(isCreature)) {
      throw new Error('Save data contains an invalid creature');
    }
    if (!isValidMergePity(file['mergePity'])) {
      throw new Error('Save data has an invalid mergePity value');
    }
    return withDefaults({
      collection: rawCollection,
      mergePity: file['mergePity'],
      lockedIds: isStringArray(file['lockedIds']) ? file['lockedIds'] : [],
      wallet: isWallet(file['wallet']) ? file['wallet'] : undefined,
      economy: isEconomyState(file['economy']) ? file['economy'] : undefined,
      campaign: readCampaign(file['campaign']),
      binder: readBinder(file['binder']),
      onboarding: readOnboarding(file['onboarding']),
      shop: readShop(file['shop']),
    });
  }

  throw new Error(`Unsupported save version: ${String(version)}`);
}
