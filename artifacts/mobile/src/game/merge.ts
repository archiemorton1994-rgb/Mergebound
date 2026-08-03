/**
 * The merge rules. Pure function — no side effects, no React, no UI imports.
 * Same two parents + same rng state always produce the same result.
 */

import { getSpecies, tierMultiplier } from './content';
import { rollStat } from './hatch';
import { balance } from './content';
import { STAT_KEYS, type Creature, type Rng, type Stats } from './models';
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
 */
export function mergedStats(a: Creature, b: Creature, tier: number, rng: Rng): { stats: Stats; statRolls: Stats } {
  const tierIncreased = a.tier === b.tier;
  const mult = tierIncreased ? tierMultiplier(tier) : 1;
  const v = balance.statRollVariance;
  const stats = {} as Stats;
  const statRolls = {} as Stats;
  for (const key of STAT_KEYS) {
    const avg = (a.stats[key] + b.stats[key]) / 2;
    const { value, rollPercent } = rollStat(avg * mult, rng, v);
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
export function merge(a: Creature, b: Creature, rng: Rng): Creature {
  const tier = mergedTier(a, b);
  const dom = dominantParent(a, b);
  const species = getSpecies(dom.speciesId);
  const { stats, statRolls } = mergedStats(a, b, tier, rng);
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
