/**
 * Core game data shapes. Pure TypeScript — no React, no UI imports.
 */

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

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

export interface TypeDef {
  id: string;
  name: string;
  color: string;
  rare: boolean;
}

/** A random source: returns a float in [0, 1). Seeded implementations live in rng.ts. */
export type Rng = () => number;
