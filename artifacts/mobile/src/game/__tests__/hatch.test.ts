/**
 * Tests for egg hatching (src/game/hatch.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  allSpecies,
  allTypes,
  balance,
  cumulativeStatMultiplier,
  getSpecies,
  typeWeight,
} from '../content';
import { generateEggBatch, hatchEgg, rollAllStats, rollStat } from '../hatch';
import { STAT_KEYS } from '../models';
import { createRng } from '../rng';
import { defaultStats } from './helpers';

describe('rollAllStats: percentage stats never grow with tier', () => {
  it('leaves critical-hit chance and damage untouched however high the tier multiplier goes', () => {
    // Crit chance is odds and crit damage is a ratio — neither is an amount, so
    // neither may take the tier multiplier. Left scaling, a tier-4 creature
    // passes 100% crit chance and criticals on literally every hit, and a
    // tier-6 one hits for roughly 4400x normal damage. That shipped once.
    const base = { ...defaultStats, critChance: 6, critDamage: 150 };
    const midpointRoll = () => 0.5; // exact centre of the variance band, factor 1

    for (const multiplier of [1, cumulativeStatMultiplier(3), cumulativeStatMultiplier(6)]) {
      const { stats } = rollAllStats(base, midpointRoll, multiplier);
      expect(stats.critChance, `multiplier ${multiplier}`).toBe(base.critChance);
      expect(stats.critDamage, `multiplier ${multiplier}`).toBe(base.critDamage);
      // ...while ordinary magnitude stats still scale exactly as before.
      expect(stats.hp, `multiplier ${multiplier}`).toBe(Math.round(base.hp * multiplier));
      expect(stats.atk, `multiplier ${multiplier}`).toBe(Math.round(base.atk * multiplier));
    }
  });

  it('keeps critical-hit chance a real chance at every tier a player can reach', () => {
    for (let tier = 0; tier <= 8; tier++) {
      for (const species of allSpecies) {
        const { stats } = rollAllStats(species.baseStats, () => 1, cumulativeStatMultiplier(tier));
        expect(stats.critChance, `${species.name} at tier ${tier}`).toBeLessThan(100);
      }
    }
  });
});

describe('hatching an egg', () => {
  it('always produces a tier-0 creature', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(hatchEgg(createRng(seed)).tier).toBe(0);
    }
  });

  it('always produces exactly one type', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(hatchEgg(createRng(seed)).types).toHaveLength(1);
    }
  });

  it('only produces species and types that exist in the data files', () => {
    const speciesIds = new Set(allSpecies.map((s) => s.id));
    const typeIds = new Set(allTypes.map((t) => t.id));
    for (let seed = 1; seed <= 100; seed++) {
      const c = hatchEgg(createRng(seed));
      expect(speciesIds.has(c.speciesId)).toBe(true);
      expect(typeIds.has(c.types[0] ?? '')).toBe(true);
    }
  });

  it('rolls every stat within ±15% of the species base stats', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const c = hatchEgg(createRng(seed));
      const base = getSpecies(c.speciesId).baseStats;
      for (const k of STAT_KEYS) {
        const min = Math.max(1, Math.floor(base[k] * (1 - balance.statRollVariance)));
        const max = Math.ceil(base[k] * (1 + balance.statRollVariance));
        expect(c.stats[k], `${k} out of range for seed ${seed}`).toBeGreaterThanOrEqual(min);
        expect(c.stats[k], `${k} out of range for seed ${seed}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('records a statRolls percentile for every stat', () => {
    const c = hatchEgg(createRng(1));
    for (const k of STAT_KEYS) {
      expect(c.statRolls[k]).toBeGreaterThanOrEqual(0);
      expect(c.statRolls[k]).toBeLessThanOrEqual(100);
    }
  });

  it('has no parents (hatched, not merged)', () => {
    expect(hatchEgg(createRng(1)).parentIds).toEqual([]);
  });

  it('is deterministic: same seed hatches the same creature', () => {
    expect(hatchEgg(createRng(123))).toEqual(hatchEgg(createRng(123)));
  });
});

describe('generating an egg batch', () => {
  it('produces exactly the number of eggs set in balance.json', () => {
    expect(generateEggBatch(createRng(5))).toHaveLength(balance.eggsPerBatch);
  });

  it('gives every egg in a batch a unique id', () => {
    const batch = generateEggBatch(createRng(5));
    const ids = new Set(batch.map((c) => c.id));
    expect(ids.size).toBe(batch.length);
  });
});

describe('the stat roll helper', () => {
  it('never returns less than 1, even for tiny base values', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(rollStat(0.4, createRng(seed), 0.15).value).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns whole numbers only', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(Number.isInteger(rollStat(37.6, createRng(seed), 0.15).value)).toBe(true);
    }
  });

  it('reports a 0-100 roll percentile alongside the value', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { rollPercent } = rollStat(50, createRng(seed), 0.15);
      expect(rollPercent).toBeGreaterThanOrEqual(0);
      expect(rollPercent).toBeLessThanOrEqual(100);
    }
  });

  it('a roll at the very top of the band reports 100, at the very bottom reports 0', () => {
    // rng() = 1 -> factor = 1 + variance (max); rng() = 0 -> factor = 1 - variance (min).
    expect(rollStat(50, () => 1, 0.15).rollPercent).toBe(100);
    expect(rollStat(50, () => 0, 0.15).rollPercent).toBe(0);
  });
});

describe('type hatch odds (rarity)', () => {
  it('a common type has a much higher hatch weight than a rare type', () => {
    const common = allTypes.find((t) => t.rarity === 'common');
    const rare = allTypes.find((t) => t.rarity === 'rare');
    if (!common || !rare) throw new Error('expected at least one common and one rare type');
    expect(typeWeight(common)).toBeGreaterThan(typeWeight(rare));
  });

  it('a rare type has a higher hatch weight than the mythic type', () => {
    const rare = allTypes.find((t) => t.rarity === 'rare');
    const mythic = allTypes.find((t) => t.rarity === 'mythic');
    if (!rare || !mythic) throw new Error('expected at least one rare and one mythic type');
    expect(typeWeight(rare)).toBeGreaterThan(typeWeight(mythic));
  });

  it('the mythic type hatches far less often than a common type over a large sample', () => {
    const mythic = allTypes.find((t) => t.rarity === 'mythic');
    if (!mythic) throw new Error('expected a mythic type');
    const rng = createRng(1);
    let mythicCount = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i++) {
      if (hatchEgg(rng).types[0] === mythic.id) mythicCount++;
    }
    // Weighted odds put mythic around 1 in 200; give this a wide margin so
    // the test isn't flaky, while still catching "rarity does nothing".
    expect(mythicCount / samples).toBeLessThan(0.02);
    expect(mythicCount).toBeGreaterThan(0);
  });
});
