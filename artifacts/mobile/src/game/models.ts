/**
 * Core game data shapes. Pure TypeScript — no React, no UI imports.
 */

/** The eight stats every creature has. Single source of truth for iteration order. */
export const STAT_KEYS = [
  'hp',
  'atk',
  'spAtk',
  'def',
  'spDef',
  'spd',
  'critChance',
  'critDamage',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type Stats = Record<StatKey, number>;

/** critChance/critDamage are stored as plain percentages (6 = 6%, 150 = 150%). */
export const PERCENT_STAT_KEYS: readonly StatKey[] = ['critChance', 'critDamage'];

export interface Creature {
  /** Unique id. */
  id: string;
  /** References an entry in src/data/species.json. */
  speciesId: string;
  name: string;
  /** Integer, starts at 0. */
  tier: number;
  /** 1 or 2 type ids, never more. */
  types: string[];
  stats: Stats;
  /**
   * Where each stat's roll landed within its variance band the last time it
   * was rolled (hatch, or the most recent merge), as a 0-100 percentile.
   * 100 = the best possible roll that hatch/merge could have produced.
   * This is what makes "perfect rolls" a visible, chaseable thing — a
   * creature can have a 98 on critChance and a 6 on hp at the same time.
   */
  statRolls: Stats;
  /** The two creatures this was merged from. Empty for hatched creatures. */
  parentIds: string[];
}

export interface SpeciesDef {
  id: string;
  name: string;
  /** Placeholder for future art — file path or null. */
  sprite: string | null;
  baseStats: Stats;
}

export type TypeRarity = 'common' | 'rare' | 'mythic';

export interface TypeDef {
  id: string;
  name: string;
  color: string;
  rarity: TypeRarity;
}

/** A random source: returns a float in [0, 1). Seeded implementations live in rng.ts. */
export type Rng = () => number;
