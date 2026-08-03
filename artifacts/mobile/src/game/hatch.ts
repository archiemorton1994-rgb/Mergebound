/**
 * Egg generation and hatching. Pure functions — same rng state in,
 * same creature out. No React, no UI imports.
 */

import { allSpecies, allTypes, balance, tierMultiplier } from './content';
import type { Creature, Rng, Stats } from './models';
import { makeId, pickOne } from './rng';

/** Apply the ±variance roll to a single stat value and round to an integer. */
export function rollStat(base: number, rng: Rng, variance: number): number {
  const factor = 1 + (rng() * 2 - 1) * variance;
  return Math.max(1, Math.round(base * factor));
}

function rollStats(base: Stats, rng: Rng, multiplier: number): Stats {
  const v = balance.statRollVariance;
  return {
    hp: rollStat(base.hp * multiplier, rng, v),
    atk: rollStat(base.atk * multiplier, rng, v),
    def: rollStat(base.def * multiplier, rng, v),
    spd: rollStat(base.spd * multiplier, rng, v),
  };
}

/**
 * Hatch a single egg: tier-0 creature, random species,
 * exactly one random type, stats rolled from the species base stats.
 */
export function hatchEgg(rng: Rng): Creature {
  const species = pickOne(rng, allSpecies);
  const type = pickOne(rng, allTypes);
  return {
    id: makeId(rng),
    speciesId: species.id,
    name: species.name,
    tier: 0,
    types: [type.id],
    stats: rollStats(species.baseStats, rng, tierMultiplier(0)),
    parentIds: [],
  };
}

/** Generate a batch of eggs (eggsPerBatch comes from balance.json). */
export function generateEggBatch(rng: Rng): Creature[] {
  return Array.from({ length: balance.eggsPerBatch }, () => hatchEgg(rng));
}
