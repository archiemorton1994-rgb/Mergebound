/**
 * Egg generation and hatching. Pure functions — same rng state in,
 * same creature out. No React, no UI imports.
 */

import { allSpecies, allTypes, balance, tierMultiplier, typeWeight } from './content';
import { PERCENT_STAT_KEYS, STAT_KEYS, type Creature, type Rng, type Stats } from './models';
import { makeId, pickOne, pickWeighted } from './rng';

export interface StatRollResult {
  value: number;
  /** 0-100: where this roll landed within its ±variance band. 100 = best possible. */
  rollPercent: number;
}

/** Roll a single stat: apply the ±variance factor, round, floor at 1, and report the roll quality. */
export function rollStat(base: number, rng: Rng, variance: number): StatRollResult {
  const factor = 1 + (rng() * 2 - 1) * variance;
  const value = Math.max(1, Math.round(base * factor));
  const clampedFactor = Math.min(1 + variance, Math.max(1 - variance, factor));
  const rollPercent = Math.round(((clampedFactor - (1 - variance)) / (2 * variance)) * 100);
  return { value, rollPercent };
}

/**
 * Roll every stat in a Stats object, returning both the values and their roll quality.
 *
 * The tier multiplier is applied to MAGNITUDE stats only. Percentage stats
 * (critChance, critDamage — see PERCENT_STAT_KEYS) are deliberately excluded:
 * they are odds and ratios, not amounts, so scaling them by tier is meaningless.
 * Left unexcluded, a tier-4 creature reaches a critChance above 100 and crits on
 * literally every hit, and a tier-6 one hits for roughly 4400x normal damage —
 * which is exactly what shipped before this exclusion existed. Every stat still
 * takes exactly one rng draw, so roll quality stays independent per stat.
 */
export function rollAllStats(
  base: Stats,
  rng: Rng,
  multiplier: number,
): { stats: Stats; statRolls: Stats } {
  const v = balance.statRollVariance;
  const stats = {} as Stats;
  const statRolls = {} as Stats;
  for (const key of STAT_KEYS) {
    const keyMultiplier = PERCENT_STAT_KEYS.includes(key) ? 1 : multiplier;
    const { value, rollPercent } = rollStat(base[key] * keyMultiplier, rng, v);
    stats[key] = value;
    statRolls[key] = rollPercent;
  }
  return { stats, statRolls };
}

/**
 * Hatch a single egg: tier-0 creature, random species,
 * exactly one random type (weighted by rarity), stats rolled from the
 * species base stats.
 */
export function hatchEgg(rng: Rng): Creature {
  const species = pickOne(rng, allSpecies);
  const type = pickWeighted(rng, allTypes, typeWeight);
  const { stats, statRolls } = rollAllStats(species.baseStats, rng, tierMultiplier(0));
  return {
    id: makeId(rng),
    speciesId: species.id,
    name: species.name,
    tier: 0,
    types: [type.id],
    stats,
    statRolls,
    parentIds: [],
  };
}

/** Generate a batch of eggs (eggsPerBatch comes from balance.json). */
export function generateEggBatch(rng: Rng): Creature[] {
  return Array.from({ length: balance.eggsPerBatch }, () => hatchEgg(rng));
}
