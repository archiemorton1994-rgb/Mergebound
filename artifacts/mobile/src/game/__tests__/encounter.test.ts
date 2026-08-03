/**
 * Tests for enemy generation (src/game/encounter.ts).
 */

import { describe, expect, it } from 'vitest';
import { allSpecies, allTypes, cumulativeStatMultiplier, getSpecies } from '../content';
import { generateEnemy, generateEnemyParty } from '../encounter';
import { balance } from '../content';
import { PERCENT_STAT_KEYS, STAT_KEYS } from '../models';
import { createRng } from '../rng';

describe('generateEnemy', () => {
  it('only produces species and types that exist in the data files', () => {
    const speciesIds = new Set(allSpecies.map((s) => s.id));
    const typeIds = new Set(allTypes.map((t) => t.id));
    for (let seed = 1; seed <= 50; seed++) {
      const e = generateEnemy(createRng(seed), 2);
      expect(speciesIds.has(e.speciesId)).toBe(true);
      for (const t of e.types) expect(typeIds.has(t)).toBe(true);
    }
  });

  it('a tier-0 enemy has exactly one type, like a hatched creature', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(generateEnemy(createRng(seed), 0).types).toHaveLength(1);
    }
  });

  it('a tier 1+ enemy has exactly two types, like a merged creature', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(generateEnemy(createRng(seed), 3).types).toHaveLength(2);
      expect(generateEnemy(createRng(seed), 1).types).toHaveLength(2);
    }
  });

  it('scales stats by the true cumulative multiplier for its tier, ±statRollVariance', () => {
    const tier = 3;
    const mult = cumulativeStatMultiplier(tier);
    for (let seed = 1; seed <= 50; seed++) {
      const e = generateEnemy(createRng(seed), tier);
      const base = getSpecies(e.speciesId).baseStats;
      for (const k of STAT_KEYS) {
        // Percentage stats (crit chance/damage) deliberately never take the tier
        // multiplier — they are odds and ratios, not amounts. See rollAllStats.
        const expected = base[k] * (PERCENT_STAT_KEYS.includes(k) ? 1 : mult);
        const min = Math.max(1, Math.floor(expected * (1 - balance.statRollVariance)));
        const max = Math.ceil(expected * (1 + balance.statRollVariance));
        expect(e.stats[k], `${k} seed ${seed}`).toBeGreaterThanOrEqual(min);
        expect(e.stats[k], `${k} seed ${seed}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('has no parents — enemies are not merged', () => {
    expect(generateEnemy(createRng(1), 0).parentIds).toEqual([]);
  });

  it('is deterministic: same seed and tier produce the same enemy', () => {
    expect(generateEnemy(createRng(9), 2)).toEqual(generateEnemy(createRng(9), 2));
  });
});

describe('generateEnemyParty', () => {
  it('produces exactly the requested number of enemies', () => {
    expect(generateEnemyParty(createRng(1), 1, 3)).toHaveLength(3);
  });

  it('gives every enemy in a party a unique id', () => {
    const party = generateEnemyParty(createRng(1), 2, 3);
    expect(new Set(party.map((e) => e.id)).size).toBe(3);
  });
});
