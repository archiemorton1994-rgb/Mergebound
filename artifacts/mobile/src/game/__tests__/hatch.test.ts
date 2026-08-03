/**
 * Tests for egg hatching (src/game/hatch.ts).
 */

import { describe, expect, it } from 'vitest';
import { allSpecies, allTypes, balance, getSpecies } from '../content';
import { generateEggBatch, hatchEgg, rollStat } from '../hatch';
import { createRng } from '../rng';

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

  it('rolls stats within ±15% of the species base stats', () => {
    const keys = ['hp', 'atk', 'def', 'spd'] as const;
    for (let seed = 1; seed <= 100; seed++) {
      const c = hatchEgg(createRng(seed));
      const base = getSpecies(c.speciesId).baseStats;
      for (const k of keys) {
        const min = Math.max(1, Math.floor(base[k] * (1 - balance.statRollVariance)));
        const max = Math.ceil(base[k] * (1 + balance.statRollVariance));
        expect(c.stats[k], `${k} out of range for seed ${seed}`).toBeGreaterThanOrEqual(min);
        expect(c.stats[k], `${k} out of range for seed ${seed}`).toBeLessThanOrEqual(max);
      }
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
      expect(rollStat(0.4, createRng(seed), 0.15)).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns whole numbers only', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(Number.isInteger(rollStat(37.6, createRng(seed), 0.15))).toBe(true);
    }
  });
});
