/**
 * Enemy generation for battles. Pure functions — no React, no UI imports.
 * Deliberately reuses the same stat-rolling pipeline as hatching/merging
 * (rollAllStats + cumulativeStatMultiplier) instead of inventing a second
 * one — an enemy at tier T is built the same way a player creature that
 * legitimately reached tier T would be.
 */

import { allSpecies, allTypes, cumulativeStatMultiplier, typeWeight } from './content';
import { rollAllStats } from './hatch';
import type { Creature, Rng } from './models';
import { makeId, pickOne, pickWeighted } from './rng';

/**
 * One enemy at the given tier. Tier-0 enemies get one type (like a freshly
 * hatched creature); tier 1+ enemies get two (like something that's been
 * merged at least once) — mirroring how a player creature actually acquires
 * its second type, rather than a special "enemy" rule.
 */
export function generateEnemy(rng: Rng, tier: number): Creature {
  const species = pickOne(rng, allSpecies);
  const typeCount = tier === 0 ? 1 : 2;
  const types = new Set<string>();
  // Guard against an infinite loop if typeCount ever exceeded the type list.
  while (types.size < typeCount && types.size < allTypes.length) {
    types.add(pickWeighted(rng, allTypes, typeWeight).id);
  }
  const { stats, statRolls } = rollAllStats(species.baseStats, rng, cumulativeStatMultiplier(tier));
  return {
    id: makeId(rng),
    speciesId: species.id,
    name: species.name,
    tier,
    types: [...types],
    stats,
    statRolls,
    parentIds: [],
  };
}

/** A wave of enemies at the same tier, for one battle. */
export function generateEnemyParty(rng: Rng, tier: number, size: number): Creature[] {
  return Array.from({ length: size }, () => generateEnemy(rng, tier));
}
