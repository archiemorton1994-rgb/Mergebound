/**
 * The merge rules. Pure function — no side effects, no React, no UI imports.
 * Same two parents + same rng state always produce the same result.
 */

import { getSpecies, tierMultiplier } from './content';
import { rollStat } from './hatch';
import { balance } from './content';
import type { Creature, Rng, Stats } from './models';
import { makeId } from './rng';

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

/** Stat rule: per-stat average of parents × tier multiplier, ±variance roll, rounded. */
export function mergedStats(a: Creature, b: Creature, tier: number, rng: Rng): Stats {
  const mult = tierMultiplier(tier);
  const v = balance.statRollVariance;
  const avg = (x: number, y: number) => (x + y) / 2;
  return {
    hp: rollStat(avg(a.stats.hp, b.stats.hp) * mult, rng, v),
    atk: rollStat(avg(a.stats.atk, b.stats.atk) * mult, rng, v),
    def: rollStat(avg(a.stats.def, b.stats.def) * mult, rng, v),
    spd: rollStat(avg(a.stats.spd, b.stats.spd) * mult, rng, v),
  };
}

/**
 * merge(creatureA, creatureB) → newCreature.
 * The caller is responsible for removing both parents from the collection
 * and adding the result (see CollectionContext in src/screens/).
 */
export function merge(a: Creature, b: Creature, rng: Rng): Creature {
  const tier = mergedTier(a, b);
  const dom = dominantParent(a, b);
  const species = getSpecies(dom.speciesId);
  return {
    id: makeId(rng),
    speciesId: species.id,
    name: species.name,
    tier,
    types: mergedTypes(a, b),
    stats: mergedStats(a, b, tier, rng),
    parentIds: [a.id, b.id],
  };
}
