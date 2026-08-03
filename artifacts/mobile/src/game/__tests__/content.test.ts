/**
 * Tests for content access (src/game/content.ts) and sanity checks on the
 * JSON data files themselves — so a bad hand-edit to species.json,
 * types.json or balance.json fails the test run instead of breaking the app.
 */

import { describe, expect, it } from 'vitest';
import {
  allSpecies,
  allTypes,
  balance,
  cumulativeStatMultiplier,
  getSpecies,
  getType,
  tierMultiplier,
  typeWeight,
} from '../content';
import { STAT_KEYS } from '../models';

describe('content lookups', () => {
  it('finds every species listed in species.json', () => {
    for (const s of allSpecies) {
      expect(getSpecies(s.id).name).toBe(s.name);
    }
  });

  it('finds every type listed in types.json', () => {
    for (const t of allTypes) {
      expect(getType(t.id).name).toBe(t.name);
    }
  });

  it('throws a clear error for an unknown species instead of returning undefined', () => {
    expect(() => getSpecies('not-a-real-species')).toThrow(/Unknown species/);
  });

  it('throws a clear error for an unknown type', () => {
    expect(() => getType('not-a-real-type')).toThrow(/Unknown type/);
  });
});

describe('tier multipliers', () => {
  it('tier 0 has multiplier 1 (hatched stats are the base stats)', () => {
    expect(tierMultiplier(0)).toBe(1);
  });

  it('multipliers never decrease from one tier to the next', () => {
    for (let t = 1; t < balance.tierMultipliers.length; t++) {
      expect(tierMultiplier(t)).toBeGreaterThanOrEqual(tierMultiplier(t - 1));
    }
  });

  it('tiers beyond the table reuse the last multiplier instead of crashing', () => {
    const last = balance.tierMultipliers[balance.tierMultipliers.length - 1];
    expect(tierMultiplier(999)).toBe(last);
  });
});

describe('cumulativeStatMultiplier (the true, honest tier-power number)', () => {
  it('is 1 at tier 0 (no growth applied yet)', () => {
    expect(cumulativeStatMultiplier(0)).toBe(1);
  });

  it('equals the product of every step multiplier up to that tier', () => {
    let expected = 1;
    for (let t = 1; t <= 6; t++) {
      expected *= tierMultiplier(t);
      expect(cumulativeStatMultiplier(t)).toBeCloseTo(expected, 9);
    }
  });

  it('only ever increases as tier increases', () => {
    for (let t = 1; t <= 6; t++) {
      expect(cumulativeStatMultiplier(t)).toBeGreaterThan(cumulativeStatMultiplier(t - 1));
    }
  });
});

describe('type hatch weights', () => {
  it('every type has a positive weight', () => {
    for (const t of allTypes) {
      expect(typeWeight(t)).toBeGreaterThan(0);
    }
  });

  it('rarer types have strictly lower weight: common > rare > mythic', () => {
    const weights = { common: 0, rare: 0, mythic: 0 };
    for (const t of allTypes) {
      weights[t.rarity] = typeWeight(t);
    }
    expect(weights.common).toBeGreaterThan(weights.rare);
    expect(weights.rare).toBeGreaterThan(weights.mythic);
  });
});

describe('data file sanity', () => {
  it('species ids are unique', () => {
    const ids = allSpecies.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('type ids are unique', () => {
    const ids = allTypes.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has the nine expected types: the six-ring, plus umbra/lumen, plus mythic aether', () => {
    const ids = allTypes.map((t) => t.id).sort();
    expect(ids).toEqual(
      ['ember', 'bloom', 'tide', 'gale', 'crag', 'volt', 'umbra', 'lumen', 'aether'].sort(),
    );
  });

  it('umbra and lumen are rare, aether is mythic, everything else is common', () => {
    const byRarity = (r: 'common' | 'rare' | 'mythic') =>
      allTypes.filter((t) => t.rarity === r).map((t) => t.id).sort();
    expect(byRarity('rare')).toEqual(['lumen', 'umbra']);
    expect(byRarity('mythic')).toEqual(['aether']);
    expect(byRarity('common')).toEqual(['bloom', 'crag', 'ember', 'gale', 'tide', 'volt'].sort());
  });

  it('every species has positive base stats across all eight stats', () => {
    for (const s of allSpecies) {
      for (const k of STAT_KEYS) {
        expect(s.baseStats[k], `${s.id} ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('the stat roll variance is the agreed ±15%', () => {
    expect(balance.statRollVariance).toBe(0.15);
  });

  it('an egg batch is big enough to select two eggs to merge', () => {
    expect(balance.eggsPerBatch).toBeGreaterThanOrEqual(2);
  });
});
