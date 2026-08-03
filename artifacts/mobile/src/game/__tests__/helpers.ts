/**
 * Shared test helpers: hand-built creatures with sensible defaults,
 * so each test only states the fields it actually cares about.
 */

import type { Creature, Stats } from '../models';

export const defaultStats: Stats = {
  hp: 40,
  atk: 12,
  spAtk: 12,
  def: 10,
  spDef: 10,
  spd: 11,
  critChance: 5,
  critDamage: 150,
};

/** Neutral (50) roll on every stat — used when a test doesn't care about roll quality. */
export const defaultStatRolls: Stats = {
  hp: 50,
  atk: 50,
  spAtk: 50,
  def: 50,
  spDef: 50,
  spd: 50,
  critChance: 50,
  critDamage: 50,
};

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
    statRolls: { ...defaultStatRolls },
    parentIds: [],
    ...overrides,
  };
}
