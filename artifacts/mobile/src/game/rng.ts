/**
 * Seeded random number generation (mulberry32).
 * Pure TypeScript — no React, no UI imports.
 *
 * Given the same seed, createRng always produces the same sequence,
 * which makes hatching and merging fully reproducible for tests.
 */

import type { Rng } from './models';

/** Create a deterministic RNG from an integer seed. Returns floats in [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one element from a non-empty array using the rng. */
export function pickOne<T>(rng: Rng, items: readonly T[]): T {
  const index = Math.floor(rng() * items.length);
  const item = items[Math.min(index, items.length - 1)];
  if (item === undefined) {
    throw new Error('pickOne called with an empty array');
  }
  return item;
}

/** Pick one element from a non-empty array, weighted by weightOf(item). */
export function pickWeighted<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  if (items.length === 0) {
    throw new Error('pickWeighted called with an empty array');
  }
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) {
    throw new Error('pickWeighted requires a positive total weight');
  }
  let roll = rng() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  // Floating-point rounding can leave roll >= 0 after the last item; fall
  // back to it rather than leaving a (rare) hole in the distribution.
  const last = items[items.length - 1];
  if (last === undefined) {
    throw new Error('pickWeighted called with an empty array');
  }
  return last;
}

/** Generate a unique-enough id from the rng (deterministic given the same rng state). */
export function makeId(rng: Rng): string {
  const part = () => Math.floor(rng() * 0xffffffff).toString(36);
  return `c-${part()}${part()}${part()}`;
}
