/**
 * Tests for the merge rules (src/game/merge.ts) against the written spec:
 *
 *  Tier    — same tier T + T → T+1; different tiers → the higher tier, no increase.
 *  Types   — higher-tier parent's types first, then the other's, deduped, max two.
 *  Stats   — per-stat average of the parents × tier multiplier, ±15% roll, rounded.
 *  Species — inherited from the higher-tier parent; deterministic on a tie.
 *  Parents — the result records both parent ids (removal itself happens in the UI layer).
 */

import { describe, expect, it } from 'vitest';
import { balance, tierMultiplier } from '../content';
import { dominantParent, merge, mergedStats, mergedTier, mergedTypes } from '../merge';
import { createRng } from '../rng';
import { makeCreature } from './helpers';

describe('merge: tier rule', () => {
  it('two same-tier parents produce a creature one tier higher', () => {
    const a = makeCreature({ tier: 2 });
    const b = makeCreature({ tier: 2 });
    expect(mergedTier(a, b)).toBe(3);
  });

  it('two tier-0 parents produce a tier-1 creature', () => {
    expect(mergedTier(makeCreature({ tier: 0 }), makeCreature({ tier: 0 }))).toBe(1);
  });

  it('different-tier parents produce the higher tier with NO increase', () => {
    const low = makeCreature({ tier: 1 });
    const high = makeCreature({ tier: 4 });
    expect(mergedTier(low, high)).toBe(4);
    expect(mergedTier(high, low)).toBe(4);
  });
});

describe('merge: type rule', () => {
  it('takes the higher-tier parent’s types first', () => {
    const high = makeCreature({ tier: 2, types: ['tide'] });
    const low = makeCreature({ tier: 0, types: ['ember'] });
    expect(mergedTypes(high, low)).toEqual(['tide', 'ember']);
    // Argument order must not matter — dominance comes from tier, not position.
    expect(mergedTypes(low, high)).toEqual(['tide', 'ember']);
  });

  it('never produces more than two types, even when parents have three between them', () => {
    const high = makeCreature({ tier: 1, types: ['ember', 'volt'] });
    const low = makeCreature({ tier: 0, types: ['tide'] });
    expect(mergedTypes(high, low)).toEqual(['ember', 'volt']);
    expect(mergedTypes(high, low)).toHaveLength(2);
  });

  it('caps at two when four distinct types are in play', () => {
    const a = makeCreature({ tier: 3, types: ['crag', 'gale'] });
    const b = makeCreature({ tier: 3, types: ['bloom', 'lumen'] });
    const result = mergedTypes(a, b);
    expect(result).toHaveLength(2);
    // Dominant parent on a tier tie is the one whose id sorts first (a here,
    // because helper ids are sequential) — so its types win.
    expect(result).toEqual(['crag', 'gale']);
  });

  it('removes duplicate types instead of listing them twice', () => {
    const a = makeCreature({ tier: 1, types: ['ember'] });
    const b = makeCreature({ tier: 1, types: ['ember'] });
    expect(mergedTypes(a, b)).toEqual(['ember']);
  });

  it('shared type plus one different type gives both, dominant first', () => {
    const high = makeCreature({ tier: 2, types: ['umbra', 'ember'] });
    const low = makeCreature({ tier: 1, types: ['ember', 'tide'] });
    expect(mergedTypes(high, low)).toEqual(['umbra', 'ember']);
  });
});

describe('merge: stat rule', () => {
  it('every stat lands within ±15% of (parent average × tier multiplier), across 200 seeds', () => {
    const a = makeCreature({ stats: { hp: 40, atk: 10, def: 12, spd: 16 } });
    const b = makeCreature({ stats: { hp: 60, atk: 20, def: 8, spd: 10 } });
    const tier = 1;
    const mult = tierMultiplier(tier);
    expect(balance.statRollVariance).toBe(0.15);

    const keys = ['hp', 'atk', 'def', 'spd'] as const;
    for (let seed = 1; seed <= 200; seed++) {
      const stats = mergedStats(a, b, tier, createRng(seed));
      for (const k of keys) {
        const base = ((a.stats[k] + b.stats[k]) / 2) * mult;
        const min = Math.max(1, Math.floor(base * (1 - balance.statRollVariance)));
        const max = Math.ceil(base * (1 + balance.statRollVariance));
        expect(stats[k], `${k} out of range for seed ${seed}`).toBeGreaterThanOrEqual(min);
        expect(stats[k], `${k} out of range for seed ${seed}`).toBeLessThanOrEqual(max);
        expect(Number.isInteger(stats[k]), `${k} must be a whole number`).toBe(true);
      }
    }
  });

  it('the random roll actually varies stats between seeds', () => {
    const a = makeCreature();
    const b = makeCreature();
    const results = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      results.add(mergedStats(a, b, 1, createRng(seed)).hp);
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('stats never drop below 1', () => {
    const a = makeCreature({ stats: { hp: 1, atk: 1, def: 1, spd: 1 } });
    const b = makeCreature({ stats: { hp: 1, atk: 1, def: 1, spd: 1 } });
    for (let seed = 1; seed <= 50; seed++) {
      const stats = mergedStats(a, b, 0, createRng(seed));
      expect(Math.min(stats.hp, stats.atk, stats.def, stats.spd)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('merge: species rule', () => {
  it('the result inherits the higher-tier parent’s species', () => {
    const high = makeCreature({ tier: 3, speciesId: 'zephyrl', name: 'Zephyrl' });
    const low = makeCreature({ tier: 1, speciesId: 'mossling', name: 'Mossling' });
    expect(merge(high, low, createRng(7)).speciesId).toBe('zephyrl');
    expect(merge(low, high, createRng(7)).speciesId).toBe('zephyrl');
  });

  it('a tier tie picks the same species every time (id sort, not chance)', () => {
    const a = makeCreature({ id: 'aaa', tier: 2, speciesId: 'puddlet', name: 'Puddlet' });
    const b = makeCreature({ id: 'zzz', tier: 2, speciesId: 'sparkit', name: 'Sparkit' });
    expect(dominantParent(a, b)).toBe(a);
    expect(dominantParent(b, a)).toBe(a);
    for (let seed = 1; seed <= 10; seed++) {
      expect(merge(a, b, createRng(seed)).speciesId).toBe('puddlet');
    }
  });
});

describe('merge: whole-result behaviour', () => {
  it('is fully deterministic: same parents + same seed = identical creature', () => {
    const a = makeCreature({ tier: 1, types: ['volt'] });
    const b = makeCreature({ tier: 1, types: ['crag'] });
    expect(merge(a, b, createRng(42))).toEqual(merge(a, b, createRng(42)));
  });

  it('does not care which parent is passed first', () => {
    const a = makeCreature({ tier: 2, types: ['gale'] });
    const b = makeCreature({ tier: 1, types: ['bloom'] });
    const ab = merge(a, b, createRng(9));
    const ba = merge(b, a, createRng(9));
    // parentIds is bookkeeping and simply records the arguments in the order
    // given — compare it as a set; everything else must match exactly.
    expect([...ab.parentIds].sort()).toEqual([...ba.parentIds].sort());
    expect({ ...ab, parentIds: [] }).toEqual({ ...ba, parentIds: [] });
  });

  it('records both parents’ ids on the result', () => {
    const a = makeCreature();
    const b = makeCreature();
    const result = merge(a, b, createRng(3));
    expect(result.parentIds).toHaveLength(2);
    expect(result.parentIds).toContain(a.id);
    expect(result.parentIds).toContain(b.id);
  });

  it('gives the result a brand-new id, different from both parents', () => {
    const a = makeCreature();
    const b = makeCreature();
    const result = merge(a, b, createRng(11));
    expect(result.id).not.toBe(a.id);
    expect(result.id).not.toBe(b.id);
  });
});
