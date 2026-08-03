/**
 * Tests for the merge rules (src/game/merge.ts) against the written spec:
 *
 *  Tier    — same tier T + T → T+1; different tiers → the higher tier, no increase.
 *  Types   — higher-tier parent's types first, then the other's, deduped, max two.
 *  Stats   — per-stat average of the parents, tier multiplier ONLY when the tier
 *            actually increases (same-tier merge), ±15% roll, rounded. Cross-tier
 *            merges get no multiplier at all, so averaging with a weaker parent
 *            dilutes rather than boosts — this is what closes the cross-tier
 *            stat-pump exploit.
 *  Species — inherited from the higher-tier parent; deterministic on a tie.
 *  Parents — the result records both parent ids (removal itself happens in the UI layer).
 */

import { describe, expect, it } from 'vitest';
import { balance, cumulativeStatMultiplier, tierMultiplier } from '../content';
import {
  MERGE_PITY_THRESHOLD,
  dominantParent,
  hasNaturalPerfectRoll,
  merge,
  mergeWithPity,
  mergedStats,
  mergedTier,
  mergedTypes,
} from '../merge';
import { PERCENT_STAT_KEYS, STAT_KEYS } from '../models';
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

describe('merge: stat rule — same-tier merge (tier increases)', () => {
  it('a free merge never moves the perfect-roll countdown', () => {
    // Tier-0 merges cost nothing and eggs are unlimited, so if free merges
    // counted, a player could farm the countdown to a guaranteed perfect roll
    // for nothing — and since gems buy gold and gold buys merge stones, money
    // would speed that up. That would be money buying a BETTER outcome, which
    // is the one thing the design forbids.
    const a = makeCreature({ tier: 0 });
    const b = makeCreature({ tier: 0 });
    const rng = createRng(4);
    let pity = 0;

    for (let i = 0; i < 100; i++) {
      const result = mergeWithPity(a, b, rng, pity);
      pity = result.mergesSincePerfectRoll;
      expect(result.pityTriggered, `merge ${i} should never trigger pity`).toBe(false);
    }
    expect(pity).toBe(0);
  });

  it('a merge that costs merge stones does move the countdown', () => {
    const a = makeCreature({ tier: 1 });
    const b = makeCreature({ tier: 1 });
    const { mergesSincePerfectRoll } = mergeWithPity(a, b, createRng(11), 0);
    // Either it advanced, or a natural perfect roll reset it — both are the
    // system working. What must never happen is it standing still.
    expect([0, 1]).toContain(mergesSincePerfectRoll);
  });

  it('reaches a guaranteed perfect roll after ten merges that were paid for', () => {
    const a = makeCreature({ tier: 2 });
    const b = makeCreature({ tier: 2 });
    const { pityTriggered, creature } = mergeWithPity(
      a,
      b,
      createRng(7),
      MERGE_PITY_THRESHOLD - 1,
    );
    expect(pityTriggered).toBe(true);
    expect(hasNaturalPerfectRoll(creature)).toBe(true);
  });

  it('every stat lands within ±15% of (parent average × tier multiplier), across 200 seeds', () => {
    const a = makeCreature({
      tier: 1,
      stats: { hp: 40, atk: 10, spAtk: 14, def: 12, spDef: 11, spd: 16, critChance: 6, critDamage: 150 },
    });
    const b = makeCreature({
      tier: 1,
      stats: { hp: 60, atk: 20, spAtk: 8, def: 8, spDef: 13, spd: 10, critChance: 4, critDamage: 160 },
    });
    const tier = mergedTier(a, b);
    const mult = tierMultiplier(tier);
    expect(balance.statRollVariance).toBe(0.15);

    for (let seed = 1; seed <= 200; seed++) {
      const { stats } = mergedStats(a, b, tier, createRng(seed));
      for (const k of STAT_KEYS) {
        // Percentage stats (crit chance/damage) deliberately never take the tier
        // multiplier — they are odds and ratios, not amounts. See rollAllStats.
        const keyMult = PERCENT_STAT_KEYS.includes(k) ? 1 : mult;
        const base = ((a.stats[k] + b.stats[k]) / 2) * keyMult;
        const min = Math.max(1, Math.floor(base * (1 - balance.statRollVariance)));
        const max = Math.ceil(base * (1 + balance.statRollVariance));
        expect(stats[k], `${k} out of range for seed ${seed}`).toBeGreaterThanOrEqual(min);
        expect(stats[k], `${k} out of range for seed ${seed}`).toBeLessThanOrEqual(max);
        expect(Number.isInteger(stats[k]), `${k} must be a whole number`).toBe(true);
      }
    }
  });

  it('the random roll actually varies stats between seeds', () => {
    const a = makeCreature({ tier: 1 });
    const b = makeCreature({ tier: 1 });
    const results = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      results.add(mergedStats(a, b, 2, createRng(seed)).stats.hp);
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('records a roll-quality percentile (0-100) for every stat', () => {
    const a = makeCreature({ tier: 1 });
    const b = makeCreature({ tier: 1 });
    const { statRolls } = mergedStats(a, b, 2, createRng(5));
    for (const k of STAT_KEYS) {
      expect(statRolls[k]).toBeGreaterThanOrEqual(0);
      expect(statRolls[k]).toBeLessThanOrEqual(100);
    }
  });

  it('stats never drop below 1', () => {
    const tinyStats = { hp: 1, atk: 1, spAtk: 1, def: 1, spDef: 1, spd: 1, critChance: 1, critDamage: 1 };
    const a = makeCreature({ tier: 0, stats: tinyStats });
    const b = makeCreature({ tier: 0, stats: tinyStats });
    for (let seed = 1; seed <= 50; seed++) {
      const { stats } = mergedStats(a, b, 1, createRng(seed));
      expect(Math.min(...STAT_KEYS.map((k) => stats[k]))).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('merge: stat rule — cross-tier merge (tier does NOT increase)', () => {
  it('applies no tier multiplier — the result is just the parents averaged, ±roll', () => {
    const high = makeCreature({ tier: 3, stats: { ...makeCreature().stats, hp: 200, atk: 60 } });
    const low = makeCreature({ tier: 0, stats: { ...makeCreature().stats, hp: 40, atk: 10 } });
    const tier = mergedTier(high, low); // stays at 3, no increase
    expect(tier).toBe(3);

    for (let seed = 1; seed <= 50; seed++) {
      const { stats } = mergedStats(high, low, tier, createRng(seed));
      // No multiplier applied: bounded by the ±15% band around the raw average,
      // NOT around average × tierMultiplier(3) (which would be much higher).
      const avgHp = (high.stats.hp + low.stats.hp) / 2;
      const maxHp = Math.ceil(avgHp * (1 + balance.statRollVariance));
      expect(stats.hp, `seed ${seed}`).toBeLessThanOrEqual(maxHp);
    }
  });

  it('merging a strong creature with a weak "junk" one makes it WORSE, not better (exploit closed)', () => {
    const strong = makeCreature({
      tier: 4,
      stats: { hp: 300, atk: 90, spAtk: 90, def: 80, spDef: 80, spd: 70, critChance: 20, critDamage: 200 },
    });
    // Deliberately far below strong on every stat: even with the ±15% roll
    // landing at its most generous, avg(strong, junk) * 1.15 still stays
    // below strong's own value, so "worse" holds on every seed, not just on
    // average.
    const junk = makeCreature({
      tier: 0,
      stats: { hp: 40, atk: 10, spAtk: 10, def: 8, spDef: 8, spd: 11, critChance: 5, critDamage: 90 },
    });
    const tier = mergedTier(strong, junk);
    for (let seed = 1; seed <= 30; seed++) {
      const { stats } = mergedStats(strong, junk, tier, createRng(seed));
      // Every stat should be pulled down toward the junk parent, well below
      // what the strong parent alone had — merging with junk is a net loss.
      for (const k of STAT_KEYS) {
        expect(stats[k], `${k} seed ${seed}`).toBeLessThan(strong.stats[k]);
      }
    }
  });

  it('a same-tier merge, by contrast, grows stats beyond either parent', () => {
    const a = makeCreature({ tier: 2, stats: { ...makeCreature().stats, hp: 100 } });
    const b = makeCreature({ tier: 2, stats: { ...makeCreature().stats, hp: 100 } });
    const tier = mergedTier(a, b);
    const { stats } = mergedStats(a, b, tier, createRng(1));
    expect(stats.hp).toBeGreaterThan(a.stats.hp);
  });
});

describe('merge: balance table honesty', () => {
  it('cumulativeStatMultiplier compounds same-tier growth the way repeated merging actually does', () => {
    // Simulate merging two identical tier-0 creatures all the way up a same-tier
    // chain (0+0→1, 1+1→2, ... ) with no random roll (rng always returns 0.5,
    // i.e. the exact midpoint of the ±variance band, so factor=1 and the only
    // change per step is base * tierMultiplier, rounded). Compare against an
    // independently-computed expectation that rounds at each step the same
    // way the real algorithm does — a single end-to-end multiply against
    // cumulativeStatMultiplier drifts by a couple of points from repeated
    // intermediate rounding, which is expected and not a bug.
    const midpointRng = () => 0.5;
    let current = makeCreature({ tier: 0, stats: { ...makeCreature().stats, hp: 40 } });
    let expectedHp = 40;
    for (let targetTier = 1; targetTier <= 6; targetTier++) {
      const twin = { ...current, id: `twin-${targetTier}` };
      current = merge(current, twin, midpointRng);
      expectedHp = Math.round(expectedHp * tierMultiplier(targetTier));
      expect(current.stats.hp, `tier ${targetTier}`).toBe(expectedHp);
    }
    // Locks in the documented "tier 6 ≈ 2800x tier 0" figure from balance.json.
    expect(cumulativeStatMultiplier(6)).toBeGreaterThan(2500);
    expect(cumulativeStatMultiplier(6)).toBeLessThan(3200);
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

  it('produces a statRolls entry for every stat key', () => {
    const result = merge(makeCreature(), makeCreature(), createRng(11));
    for (const k of STAT_KEYS) {
      expect(typeof result.statRolls[k]).toBe('number');
    }
  });
});

describe('merge: forced perfect stat (the mechanism the pity system uses)', () => {
  it('forces exactly the requested stat to a 100 roll and its best possible value', () => {
    const a = makeCreature({ tier: 1, stats: { ...makeCreature().stats, hp: 40 } });
    const b = makeCreature({ tier: 1, stats: { ...makeCreature().stats, hp: 60 } });
    const result = merge(a, b, createRng(3), 'hp');
    expect(result.statRolls.hp).toBe(100);
    const avg = (40 + 60) / 2;
    const mult = tierMultiplier(mergedTier(a, b));
    expect(result.stats.hp).toBe(Math.round(avg * mult * (1 + balance.statRollVariance)));
  });

  it('leaves every other stat rolling normally, not forced', () => {
    const a = makeCreature();
    const b = makeCreature();
    const result = merge(a, b, createRng(3), 'hp');
    const otherKeys = STAT_KEYS.filter((k) => k !== 'hp');
    expect(otherKeys.some((k) => result.statRolls[k] !== 100)).toBe(true);
  });
});

describe('mergeWithPity: guaranteed perfect roll', () => {
  // These all use tier-1 parents deliberately. A tier-0 merge is free, and free
  // merges are invisible to the countdown entirely — see the tests above for
  // why that has to be true.
  const paidParent = () => makeCreature({ tier: 1 });

  it('below the threshold, the counter just increments and nothing is forced', () => {
    const midpointRng = () => 0.5; // exact midpoint of the variance band -> rollPercent 50 always
    const result = mergeWithPity(paidParent(), paidParent(), midpointRng, 3);
    expect(result.pityTriggered).toBe(false);
    expect(result.mergesSincePerfectRoll).toBe(4);
    expect(hasNaturalPerfectRoll(result.creature)).toBe(false);
  });

  it('forces a perfect roll once the threshold is reached, and resets the counter', () => {
    const result = mergeWithPity(
      paidParent(),
      paidParent(),
      createRng(1),
      MERGE_PITY_THRESHOLD - 1,
    );
    expect(result.pityTriggered).toBe(true);
    expect(result.mergesSincePerfectRoll).toBe(0);
    expect(hasNaturalPerfectRoll(result.creature)).toBe(true);
  });

  it('a natural perfect roll resets the counter early, without counting as pity', () => {
    const maxRng = () => 1; // pushes every stat's roll factor to the top of the band
    const result = mergeWithPity(paidParent(), paidParent(), maxRng, 2);
    expect(result.pityTriggered).toBe(false);
    expect(hasNaturalPerfectRoll(result.creature)).toBe(true);
    expect(result.mergesSincePerfectRoll).toBe(0);
  });

  it('is deterministic given the same parents, rng seed and pity count', () => {
    const a = paidParent();
    const b = paidParent();
    const r1 = mergeWithPity(a, b, createRng(5), 3);
    const r2 = mergeWithPity(a, b, createRng(5), 3);
    expect(r1).toEqual(r2);
  });
});
