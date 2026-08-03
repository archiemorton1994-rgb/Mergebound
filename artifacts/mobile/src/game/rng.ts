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

/** Generate a unique-enough id from the rng (deterministic given the same rng state). */
export function makeId(rng: Rng): string {
  const part = () => Math.floor(rng() * 0xffffffff).toString(36);
  return `c-${part()}${part()}${part()}`;
}
