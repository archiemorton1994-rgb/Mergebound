/**
 * Save/load serialisation. Pure functions — they turn game state into a
 * string and back, with validation. Actual storage (AsyncStorage) happens
 * in the UI layer (src/screens/CollectionContext.tsx).
 * No React, no UI imports.
 *
 * Save data is versioned. Bumping SAVE_VERSION without a migration wipes
 * every player's collection on their next update — always add a migration
 * path in the same change that changes what's saved.
 */

import { STAT_KEYS, type Creature, type Stats } from './models';

const SAVE_VERSION = 3;

export interface SaveData {
  collection: Creature[];
  /** Merges since the last natural (or pity-forced) perfect stat roll — see merge.ts's mergeWithPity. */
  mergePity: number;
}

interface SaveFile {
  version: number;
  collection: Creature[];
  mergePity: number;
}

export function serializeCollection(data: SaveData): string {
  const file: SaveFile = { version: SAVE_VERSION, collection: data.collection, mergePity: data.mergePity };
  return JSON.stringify(file);
}

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
    return { collection: rawCollection.map(migrateCreatureV1ToV2), mergePity: 0 };
  }

  // v2: current Creature shape, but saved before the pity system existed.
  if (version === 2) {
    if (!rawCollection.every(isCreature)) {
      throw new Error('Save data contains an invalid creature');
    }
    return { collection: rawCollection, mergePity: 0 };
  }

  if (version === SAVE_VERSION) {
    if (!rawCollection.every(isCreature)) {
      throw new Error('Save data contains an invalid creature');
    }
    if (!isValidMergePity(file['mergePity'])) {
      throw new Error('Save data has an invalid mergePity value');
    }
    return { collection: rawCollection, mergePity: file['mergePity'] };
  }

  throw new Error(`Unsupported save version: ${String(version)}`);
}
