/**
 * Shared test helpers: hand-built creatures with sensible defaults,
 * so each test only states the fields it actually cares about.
 */

import type { Creature, Stats } from '../models';

export const defaultStats: Stats = { hp: 40, atk: 12, def: 10, spd: 11 };

let counter = 0;

/** Build a creature for tests. Every field can be overridden. */
export function makeCreature(overrides: Partial<Creature> = {}): Creature {
  counter += 1;
  return {
    id: `test-${String(counter).padStart(4, '0')}`,
    speciesId: 'cindret',
    name: 'Cindret',
    tier: 0,
    types: ['ember'],
    stats: { ...defaultStats },
    parentIds: [],
    ...overrides,
  };
}
