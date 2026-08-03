/**
 * Tests for party battle resolution (src/game/battle.ts):
 *  - physical moves use atk/def, special moves use spAtk/spDef
 *  - type effectiveness, crit, and the combat damage roll all apply correctly
 *  - heal (single + party) and drain restore HP without ever overhealing
 *  - a miss deals no damage and heals nothing
 *  - the AI heals a critical ally when it can, and otherwise focuses the
 *    weakest enemy with its best-matchup move
 *  - a full battle is deterministic and ends with a sensible winner
 */

import { describe, expect, it } from 'vitest';
import { balance, movesForCreature } from '../content';
import {
  chooseAction,
  computeDamage,
  resolveMove,
  runBattle,
  type Combatant,
} from '../battle';
import type { DamageMove, DrainMove, HealMove } from '../models';
import { createRng } from '../rng';
import { makeCreature, sequenceRng } from './helpers';

const neutralPhysical: DamageMove = {
  id: 'test-phys',
  name: 'Test Physical',
  typeId: 'aether', // Aether has no effectiveness entries at all — guaranteed 1x, isolates the test.
  kind: 'damage',
  category: 'physical',
  power: 50,
  accuracy: 95,
};

const neutralSpecial: DamageMove = { ...neutralPhysical, id: 'test-spec', category: 'special' };

function combatant(overrides: Parameters<typeof makeCreature>[0] = {}, currentHp?: number): Combatant {
  const creature = makeCreature(overrides);
  return { creature, currentHp: currentHp ?? creature.stats.hp, side: 'player' };
}

describe('computeDamage: physical vs special stat usage', () => {
  it('a physical move scales off atk and def, ignoring spAtk/spDef', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 100, spAtk: 999, critChance: 0 } });
    const defender = makeCreature({ stats: { ...makeCreature().stats, def: 50, spDef: 999 } });
    // seq: [crit roll (fails, critChance=0), variance roll (0.5 = exact midpoint, factor 1)]
    const { damage, crit } = computeDamage(attacker, defender, neutralPhysical, sequenceRng([0, 0.5]));
    expect(crit).toBe(false);
    expect(damage).toBe(Math.round(50 * (100 / 50))); // power * atk/def = 100
  });

  it('a special move scales off spAtk and spDef, ignoring atk/def', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, spAtk: 100, atk: 999, critChance: 0 } });
    const defender = makeCreature({ stats: { ...makeCreature().stats, spDef: 50, def: 999 } });
    const { damage } = computeDamage(attacker, defender, neutralSpecial, sequenceRng([0, 0.5]));
    expect(damage).toBe(100);
  });
});

describe('computeDamage: type effectiveness', () => {
  it('a strong matchup roughly doubles damage', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 100, critChance: 0 } });
    const defender = makeCreature({ types: ['bloom'], stats: { ...makeCreature().stats, def: 100 } });
    const move: DamageMove = { ...neutralPhysical, typeId: 'ember' }; // ember -> bloom = 2x
    const { damage } = computeDamage(attacker, defender, move, sequenceRng([0, 0.5]));
    expect(damage).toBe(Math.round(50 * 1 * 2)); // power * (atk/def=1) * 2x
  });

  it('a weak matchup roughly halves damage', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 100, critChance: 0 } });
    const defender = makeCreature({ types: ['volt'], stats: { ...makeCreature().stats, def: 100 } });
    const move: DamageMove = { ...neutralPhysical, typeId: 'ember' }; // ember -> volt = 0.5x
    const { damage } = computeDamage(attacker, defender, move, sequenceRng([0, 0.5]));
    expect(damage).toBe(Math.round(50 * 0.5));
  });

  it('stacks against a dual-typed defender', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 100, critChance: 0 } });
    // ember -> bloom = 2x, ember -> volt = 0.5x, stacked = 1x
    const defender = makeCreature({ types: ['bloom', 'volt'], stats: { ...makeCreature().stats, def: 100 } });
    const move: DamageMove = { ...neutralPhysical, typeId: 'ember' };
    const { damage } = computeDamage(attacker, defender, move, sequenceRng([0, 0.5]));
    expect(damage).toBe(50);
  });
});

describe('computeDamage: crit', () => {
  it('a crit multiplies damage by critDamage/100', () => {
    const base = { ...makeCreature().stats, atk: 100, def: 100 };
    const critter = makeCreature({ stats: { ...base, critChance: 100, critDamage: 200 } });
    const nonCritter = makeCreature({ stats: { ...base, critChance: 0, critDamage: 200 } });
    const defender = makeCreature({ types: ['aether'], stats: { ...makeCreature().stats, def: 100 } });

    const critResult = computeDamage(critter, defender, neutralPhysical, sequenceRng([0, 0.5]));
    const noCritResult = computeDamage(nonCritter, defender, neutralPhysical, sequenceRng([0, 0.5]));

    expect(critResult.crit).toBe(true);
    expect(noCritResult.crit).toBe(false);
    expect(critResult.damage).toBe(noCritResult.damage * 2);
  });
});

describe('computeDamage: floor and variance', () => {
  it('never deals less than 1 damage, even against overwhelming defence', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 1, critChance: 0 } });
    const defender = makeCreature({ stats: { ...makeCreature().stats, def: 100000 } });
    const { damage } = computeDamage(attacker, defender, neutralPhysical, sequenceRng([0, 0.5]));
    expect(damage).toBe(1);
  });

  it('stays within the configured ±combatDamageVariance band across many seeds', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 100, critChance: 0 } });
    const defender = makeCreature({ stats: { ...makeCreature().stats, def: 100 } });
    const raw = 50; // power * atk/def * 1x type
    for (let seed = 1; seed <= 100; seed++) {
      const { damage } = computeDamage(attacker, defender, neutralPhysical, createRng(seed));
      const min = Math.max(1, Math.floor(raw * (1 - balance.combatDamageVariance)));
      const max = Math.ceil(raw * (1 + balance.combatDamageVariance));
      expect(damage, `seed ${seed}`).toBeGreaterThanOrEqual(min);
      expect(damage, `seed ${seed}`).toBeLessThanOrEqual(max);
    }
  });
});

describe('resolveMove: damage and misses', () => {
  it('reduces the target’s currentHp by the computed damage, never below 0', () => {
    const actor = combatant({ stats: { ...makeCreature().stats, atk: 999, critChance: 0 } });
    const target: Combatant = { creature: makeCreature({ stats: { ...makeCreature().stats, hp: 10, def: 1 } }), currentHp: 10, side: 'enemy' };
    const entry = resolveMove(actor, target, [actor], neutralPhysical, sequenceRng([0, 0, 0.5]), 1);
    expect(entry.hit).toBe(true);
    expect(target.currentHp).toBe(0);
    expect(entry.targetFainted).toBe(true);
  });

  it('a miss deals no damage and does not touch currentHp', () => {
    const actor = combatant();
    const target: Combatant = { creature: makeCreature(), currentHp: 40, side: 'enemy' };
    // rng*100 >= accuracy(95) -> miss
    const entry = resolveMove(actor, target, [actor], neutralPhysical, sequenceRng([0.99]), 1);
    expect(entry.hit).toBe(false);
    expect(entry.damage).toBe(0);
    expect(target.currentHp).toBe(40);
  });
});

describe('resolveMove: healing never overheals', () => {
  const healMove: HealMove = {
    id: 'test-heal',
    name: 'Test Heal',
    typeId: 'bloom',
    kind: 'heal',
    target: 'lowest-ally',
    healFraction: 0.3,
    accuracy: 100,
  };

  it('heals a single ally, capping exactly at max HP', () => {
    const creature = makeCreature({ stats: { ...makeCreature().stats, hp: 40 } });
    const healer = combatant();
    const nearFull: Combatant = { creature, currentHp: 38, side: 'player' }; // heal of 12 would overheal past 40
    const entry = resolveMove(healer, nearFull, [healer, nearFull], healMove, sequenceRng([0]), 1);
    expect(nearFull.currentHp).toBe(40);
    expect(entry.healed).toBe(2);
  });

  const partyHealMove: HealMove = { ...healMove, id: 'test-party-heal', target: 'party', healFraction: 0.2 };

  it('party heal restores every living ally and skips fainted ones', () => {
    const healer = combatant({}, 40);
    const hurtAlly: Combatant = { creature: makeCreature({ stats: { ...makeCreature().stats, hp: 40 } }), currentHp: 10, side: 'player' };
    const faintedAlly: Combatant = { creature: makeCreature({ stats: { ...makeCreature().stats, hp: 40 } }), currentHp: 0, side: 'player' };
    const allies = [healer, hurtAlly, faintedAlly];
    resolveMove(healer, undefined, allies, partyHealMove, sequenceRng([0]), 1);
    expect(hurtAlly.currentHp).toBe(10 + Math.round(40 * 0.2));
    expect(faintedAlly.currentHp).toBe(0); // stays fainted, no resurrection
    expect(healer.currentHp).toBeLessThanOrEqual(40); // healer heals itself too, capped at max
  });
});

describe('resolveMove: drain heals the user off the damage it deals', () => {
  const drainMove: DrainMove = {
    id: 'test-drain',
    name: 'Test Drain',
    typeId: 'umbra',
    kind: 'drain',
    category: 'special',
    power: 40,
    drainFraction: 0.5,
    accuracy: 100,
  };

  it('damages the target and heals the user for drainFraction of the damage dealt', () => {
    const actor: Combatant = {
      creature: makeCreature({ stats: { ...makeCreature().stats, hp: 40, spAtk: 100, critChance: 0 } }),
      currentHp: 20,
      side: 'player',
    };
    const target: Combatant = { creature: makeCreature({ stats: { ...makeCreature().stats, spDef: 100 } }), currentHp: 40, side: 'enemy' };
    const entry = resolveMove(actor, target, [actor], drainMove, sequenceRng([0, 0, 0.5]), 1);
    expect(entry.damage).toBeGreaterThan(0);
    expect(entry.healed).toBe(Math.round(entry.damage * 0.5));
    expect(actor.currentHp).toBe(20 + entry.healed);
  });

  it('drain healing still never overheals the user past its max', () => {
    const actor: Combatant = {
      creature: makeCreature({ stats: { ...makeCreature().stats, hp: 40, spAtk: 999, critChance: 0 } }),
      currentHp: 39,
      side: 'player',
    };
    const target: Combatant = { creature: makeCreature({ stats: { ...makeCreature().stats, spDef: 1 } }), currentHp: 999, side: 'enemy' };
    resolveMove(actor, target, [actor], drainMove, sequenceRng([0, 0, 0.5]), 1);
    expect(actor.currentHp).toBeLessThanOrEqual(40);
  });
});

describe('chooseAction: the AI heuristic', () => {
  it('heals the neediest living ally when someone is below the emergency threshold', () => {
    const bloomCreature = makeCreature({ types: ['bloom'] });
    const moves = movesForCreature(bloomCreature);
    const healer: Combatant = { creature: bloomCreature, currentHp: 40, side: 'player' };
    const criticalAlly: Combatant = { creature: makeCreature({ stats: { ...makeCreature().stats, hp: 40 } }), currentHp: 5, side: 'player' };
    const enemy: Combatant = { creature: makeCreature(), currentHp: 40, side: 'enemy' };

    const { move, target } = chooseAction(healer, [healer, criticalAlly], [enemy], moves);
    expect(move.kind).toBe('heal');
    expect(target).toBe(criticalAlly);
  });

  it('otherwise attacks the lowest-HP living enemy', () => {
    const attacker = makeCreature({ types: ['ember'] });
    const moves = movesForCreature(attacker);
    const self: Combatant = { creature: attacker, currentHp: 40, side: 'player' };
    const weakEnemy: Combatant = { creature: makeCreature(), currentHp: 5, side: 'enemy' };
    const strongEnemy: Combatant = { creature: makeCreature(), currentHp: 40, side: 'enemy' };

    const { move, target } = chooseAction(self, [self], [strongEnemy, weakEnemy], moves);
    expect(move.kind).not.toBe('heal');
    expect(target).toBe(weakEnemy);
  });

  it('among attack moves, prefers the one with the best type matchup against the target', () => {
    const attacker = makeCreature({ types: ['ember'] }); // Flame Fang (physical) + Cinder Burst (special), both ember
    const moves = movesForCreature(attacker);
    const self: Combatant = { creature: attacker, currentHp: 40, side: 'player' };
    // ember is strong (2x) against bloom — both ember moves tie in effectiveness here,
    // so this mainly proves a move typed for the matchup gets chosen over a mismatched one.
    const target: Combatant = { creature: makeCreature({ types: ['bloom'] }), currentHp: 40, side: 'enemy' };
    const { move } = chooseAction(self, [self], [target], moves);
    expect(move.typeId).toBe('ember');
  });
});

describe('runBattle: full simulation', () => {
  it('is deterministic: same parties + same seed = identical result', () => {
    const player = [makeCreature({ id: 'p1' }), makeCreature({ id: 'p2' })];
    const enemy = [makeCreature({ id: 'e1' }), makeCreature({ id: 'e2' })];
    const a = runBattle(player, enemy, createRng(5));
    const b = runBattle(player, enemy, createRng(5));
    expect(a).toEqual(b);
  });

  it('a vastly overpowered party wins', () => {
    const strongStats = { ...makeCreature().stats, hp: 500, atk: 200, spAtk: 200, def: 100, spDef: 100 };
    const weakStats = { ...makeCreature().stats, hp: 10, atk: 1, spAtk: 1, def: 1, spDef: 1 };
    const player = [makeCreature({ stats: strongStats })];
    const enemy = [makeCreature({ stats: weakStats })];
    const result = runBattle(player, enemy, createRng(1));
    expect(result.winner).toBe('player');
  });

  it('always finishes within the round cap', () => {
    const player = [makeCreature(), makeCreature(), makeCreature()];
    const enemy = [makeCreature(), makeCreature(), makeCreature()];
    const result = runBattle(player, enemy, createRng(3));
    expect(result.rounds).toBeLessThanOrEqual(50);
    expect(result.log.length).toBeGreaterThan(0);
  });

  it('every log entry belongs to a real side', () => {
    const player = [makeCreature()];
    const enemy = [makeCreature()];
    const result = runBattle(player, enemy, createRng(2));
    for (const entry of result.log) {
      expect(['player', 'enemy']).toContain(entry.actorSide);
    }
  });
});
