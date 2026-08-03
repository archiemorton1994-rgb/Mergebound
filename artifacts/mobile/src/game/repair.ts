/**
 * One-off repairs applied to creatures loaded from older saves.
 * Pure functions — no React, no UI imports, no randomness.
 *
 * These exist because a save file is a permanent record of a bug. Fixing the
 * rule that produced bad data does nothing for creatures that were already
 * written to disk with it, so the fix has to reach backwards too.
 */

import { allSpecies, balance } from './content';
import { PERCENT_STAT_KEYS, type Creature, type Stats } from './models';

/**
 * Upper bounds used only when a creature's species is missing from the data
 * files (renamed or removed between builds). Without a species we cannot
 * reconstruct the true value, so we clamp to something sane instead of
 * throwing — losing one creature's exact numbers is recoverable, refusing to
 * load the save is not.
 */
const FALLBACK_MAX_CRIT_CHANCE = 100;
const FALLBACK_MAX_CRIT_DAMAGE = 400;

/**
 * Rebuild a creature's percentage stats (critChance, critDamage) as if they had
 * never been multiplied by the tier growth multiplier.
 *
 * Why this is needed: until this repair existed, every stat took the tier
 * multiplier, including the two that are percentages rather than amounts. By
 * tier 4 that puts critChance above 100, so every single hit is a critical; by
 * tier 6 a creature hits for roughly 4400x normal damage. Saved creatures carry
 * those numbers permanently.
 *
 * The reconstruction is exact, not a guess, because `statRolls` already records
 * where each stat landed inside its ±variance band as a 0-100 percentile. That
 * inverts back to the original roll factor, which applied to the species' base
 * value gives precisely the number the creature should have had. Nothing else
 * about the creature changes — same id, same species, same types, same roll
 * quality, same magnitude stats.
 *
 * Returns the same object when nothing needed changing, so callers can cheaply
 * tell whether a save was actually altered.
 */
export function repairPercentStats(creature: Creature): Creature {
  const species = allSpecies.find((s) => s.id === creature.speciesId);
  const v = balance.statRollVariance;

  let changed = false;
  const stats: Stats = { ...creature.stats };

  for (const key of PERCENT_STAT_KEYS) {
    const current = creature.stats[key];
    let repaired: number;

    if (species) {
      // Only touch values that are provably impossible. An unscaled roll can
      // never exceed the species base plus the full variance band, so anything
      // at or below that ceiling is already correct and is left EXACTLY as it
      // is. That matters: statRolls stores a rounded 0-100 percentile, so
      // reconstructing from it can land one off the original value. Rebuilding
      // healthy creatures would quietly nudge everyone's numbers for no reason.
      const maxUnscaled = Math.max(1, Math.round(species.baseStats[key] * (1 + v)));
      if (current <= maxUnscaled) continue;

      // Invert rollStat: rollPercent -> the factor that produced it.
      const rollPercent = creature.statRolls[key];
      const clampedFactor = (rollPercent / 100) * (2 * v) + (1 - v);
      repaired = Math.max(1, Math.round(species.baseStats[key] * clampedFactor));
    } else {
      const ceiling = key === 'critChance' ? FALLBACK_MAX_CRIT_CHANCE : FALLBACK_MAX_CRIT_DAMAGE;
      if (current <= ceiling) continue;
      repaired = Math.max(1, ceiling);
    }

    if (repaired !== current) {
      stats[key] = repaired;
      changed = true;
    }
  }

  return changed ? { ...creature, stats } : creature;
}

/** Apply repairPercentStats across a whole collection. */
export function repairCollection(collection: Creature[]): Creature[] {
  return collection.map(repairPercentStats);
}
