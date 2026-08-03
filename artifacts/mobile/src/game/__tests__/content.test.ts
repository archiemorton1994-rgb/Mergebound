/**
 * Tests for content access (src/game/content.ts) and sanity checks on the
 * JSON data files themselves — so a bad hand-edit to species.json,
 * types.json or balance.json fails the test run instead of breaking the app.
 */

import { describe, expect, it } from 'vitest';
import { allSpecies, allTypes, balance, getSpecies, getType, tierMultiplier } from '../content';

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

describe('data file sanity', () => {
  it('species ids are unique', () => {
    const ids = allSpecies.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('type ids are unique', () => {
    const ids = allTypes.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has the eight expected types: the six-ring plus umbra and lumen', () => {
    const ids = allTypes.map((t) => t.id).sort();
    expect(ids).toEqual(['bloom', 'crag', 'ember', 'gale', 'lumen', 'tide', 'umbra'].concat('volt').sort());
  });

  it('umbra and lumen are the only rare types', () => {
    const rare = allTypes.filter((t) => t.rare).map((t) => t.id).sort();
    expect(rare).toEqual(['lumen', 'umbra']);
  });

  it('every species has positive base stats', () => {
    for (const s of allSpecies) {
      expect(s.baseStats.hp, `${s.id} hp`).toBeGreaterThan(0);
      expect(s.baseStats.atk, `${s.id} atk`).toBeGreaterThan(0);
      expect(s.baseStats.def, `${s.id} def`).toBeGreaterThan(0);
      expect(s.baseStats.spd, `${s.id} spd`).toBeGreaterThan(0);
    }
  });

  it('the stat roll variance is the agreed ±15%', () => {
    expect(balance.statRollVariance).toBe(0.15);
  });

  it('an egg batch is big enough to select two eggs to merge', () => {
    expect(balance.eggsPerBatch).toBeGreaterThanOrEqual(2);
  });
});
