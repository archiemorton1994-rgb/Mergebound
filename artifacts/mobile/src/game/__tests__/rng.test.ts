/**
 * Tests for the seeded random number generator (src/game/rng.ts).
 * Determinism here is what makes every other test in this folder possible.
 */

import { describe, expect, it } from 'vitest';
import { createRng, makeId, pickOne, pickWeighted } from '../rng';

describe('the seeded rng', () => {
  it('produces the exact same sequence for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 20 }, () => a() === b());
    expect(same.every(Boolean)).toBe(false);
  });

  it('only returns numbers from 0 up to (but never including) 1', () => {
    const rng = createRng(777);
    for (let i = 0; i < 1000; i++) {
      const n = rng();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('pickOne', () => {
  it('always picks an element that is actually in the list', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const rng = createRng(55);
    for (let i = 0; i < 200; i++) {
      expect(items).toContain(pickOne(rng, items));
    }
  });

  it('eventually picks every element (no dead entries)', () => {
    const items = ['a', 'b', 'c', 'd'];
    const rng = createRng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickOne(rng, items));
    }
    expect([...seen].sort()).toEqual(items);
  });

  it('refuses an empty list instead of returning undefined', () => {
    expect(() => pickOne(createRng(1), [])).toThrow(/empty/);
  });
});

describe('pickWeighted', () => {
  it('always picks an element that is actually in the list', () => {
    const items = [
      { id: 'a', w: 10 },
      { id: 'b', w: 1 },
      { id: 'c', w: 1 },
    ];
    const rng = createRng(20);
    for (let i = 0; i < 200; i++) {
      expect(items.map((i) => i.id)).toContain(pickWeighted(rng, items, (i) => i.w).id);
    }
  });

  it('a much heavier weight is picked far more often than a much lighter one', () => {
    const items = [
      { id: 'heavy', w: 1000 },
      { id: 'light', w: 1 },
    ];
    const rng = createRng(4);
    let heavyCount = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i++) {
      if (pickWeighted(rng, items, (i) => i.w).id === 'heavy') heavyCount++;
    }
    expect(heavyCount / samples).toBeGreaterThan(0.9);
  });

  it('a zero-weight item is never picked', () => {
    const items = [
      { id: 'never', w: 0 },
      { id: 'always', w: 1 },
    ];
    const rng = createRng(6);
    for (let i = 0; i < 200; i++) {
      expect(pickWeighted(rng, items, (i) => i.w).id).toBe('always');
    }
  });

  it('refuses an empty list instead of returning undefined', () => {
    expect(() => pickWeighted(createRng(1), [], () => 1)).toThrow(/empty/);
  });

  it('refuses a list whose weights are all zero', () => {
    expect(() => pickWeighted(createRng(1), [1, 2, 3], () => 0)).toThrow(/positive total weight/);
  });
});

describe('makeId', () => {
  it('is deterministic for the same rng state', () => {
    expect(makeId(createRng(42))).toBe(makeId(createRng(42)));
  });

  it('produces distinct ids as the rng advances', () => {
    const rng = createRng(42);
    const ids = new Set(Array.from({ length: 100 }, () => makeId(rng)));
    expect(ids.size).toBe(100);
  });
});
