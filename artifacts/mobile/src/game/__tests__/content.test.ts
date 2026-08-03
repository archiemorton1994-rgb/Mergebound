/**
 * Tests for content access (src/game/content.ts) and sanity checks on the
 * JSON data files themselves — so a bad hand-edit to species.json,
 * types.json or balance.json fails the test run instead of breaking the app.
 */

import { describe, expect, it } from 'vitest';
import {
  allHybridMoves,
  allMoves,
  allSpecies,
  allTypes,
  balance,
  cumulativeStatMultiplier,
  effectivenessForMove,
  getSpecies,
  getType,
  hybridMoveFor,
  movesForCreature,
  movesForType,
  tierMultiplier,
  typeEffectiveness,
  typeWeight,
} from '../content';
import { STAT_KEYS } from '../models';
import { makeCreature } from './helpers';

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

describe('moves', () => {
  it('every type grants exactly 2 physical and 2 special damage moves', () => {
    for (const t of allTypes) {
      const damageMoves = movesForType(t.id).filter((m) => m.kind === 'damage');
      expect(damageMoves.filter((m) => m.category === 'physical').length, t.id).toBe(2);
      expect(damageMoves.filter((m) => m.category === 'special').length, t.id).toBe(2);
    }
  });

  it('every move id is unique', () => {
    const ids = allMoves.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every move references a real type', () => {
    const typeIds = new Set(allTypes.map((t) => t.id));
    for (const m of allMoves) {
      expect(typeIds.has(m.typeId), m.id).toBe(true);
    }
  });

  it('exactly bloom, umbra and lumen grant a support move (heal or drain)', () => {
    const supportTypeIds = allTypes
      .filter((t) => movesForType(t.id).some((m) => m.kind === 'heal' || m.kind === 'drain'))
      .map((t) => t.id)
      .sort();
    expect(supportTypeIds).toEqual(['bloom', 'lumen', 'umbra'].sort());
  });

  it('movesForCreature returns the union of a dual-typed creature’s two movepools, plus its hybrid move', () => {
    const creature = makeCreature({ types: ['ember', 'bloom'] });
    const moves = movesForCreature(creature);
    expect(moves.some((m) => m.kind !== 'hybrid' && m.typeId === 'ember')).toBe(true);
    expect(moves.some((m) => m.kind !== 'hybrid' && m.typeId === 'bloom')).toBe(true);
    expect(moves.filter((m) => m.kind === 'hybrid')).toHaveLength(1);
    expect(moves).toHaveLength(movesForType('ember').length + movesForType('bloom').length + 1);
  });

  it('a single-typed creature has no hybrid move', () => {
    const creature = makeCreature({ types: ['ember'] });
    expect(movesForCreature(creature).some((m) => m.kind === 'hybrid')).toBe(false);
  });

  it('every heal/drain fraction is a sane, positive proportion', () => {
    for (const m of allMoves) {
      if (m.kind === 'heal') expect(m.healFraction).toBeGreaterThan(0);
      if (m.kind === 'drain') expect(m.drainFraction).toBeGreaterThan(0);
    }
  });
});

describe('hybrid moves', () => {
  it('every one of the 36 possible type pairs has an authored hybrid move', () => {
    const ids = allTypes.map((t) => t.id);
    let count = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (!a || !b) continue;
        expect(hybridMoveFor(a, b), `${a}+${b}`).toBeDefined();
        count++;
      }
    }
    expect(count).toBe(36);
  });

  it('hybrid move lookup does not care about argument order', () => {
    expect(hybridMoveFor('ember', 'tide')).toBe(hybridMoveFor('tide', 'ember'));
  });

  it('every hybrid move id and name is unique', () => {
    expect(new Set(allHybridMoves.map((m) => m.id)).size).toBe(allHybridMoves.length);
    expect(new Set(allHybridMoves.map((m) => m.name)).size).toBe(allHybridMoves.length);
  });

  it('effectivenessForMove averages a hybrid move’s two component types instead of stacking them', () => {
    const move = hybridMoveFor('ember', 'volt');
    if (!move) throw new Error('expected an ember+volt hybrid move');
    // ember->bloom = 2, volt->bloom = 1 (no entry) -> average 1.5
    expect(effectivenessForMove(move, ['bloom'])).toBeCloseTo(1.5, 9);
  });
});

describe('type effectiveness', () => {
  it('is neutral (1x) when there is no entry either way', () => {
    expect(typeEffectiveness('aether', ['ember'])).toBe(1);
    expect(typeEffectiveness('ember', ['aether'])).toBe(1);
  });

  it('is strong (2x) exactly where types.json says so', () => {
    expect(typeEffectiveness('ember', ['bloom'])).toBe(2);
  });

  it('is weak (0.5x) exactly where types.json says so', () => {
    expect(typeEffectiveness('ember', ['volt'])).toBe(0.5);
  });

  it('stacks multiplicatively across a dual-typed defender', () => {
    expect(typeEffectiveness('ember', ['bloom', 'volt'])).toBe(1); // 2 * 0.5
  });

  it('umbra and lumen are strong against each other and nothing else', () => {
    expect(typeEffectiveness('umbra', ['lumen'])).toBe(2);
    expect(typeEffectiveness('lumen', ['umbra'])).toBe(2);
    expect(typeEffectiveness('umbra', ['ember'])).toBe(1);
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
