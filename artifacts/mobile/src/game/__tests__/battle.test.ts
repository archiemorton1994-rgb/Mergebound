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
import { balance, cumulativeStatMultiplier, movesForCreature } from '../content';
import {
  chooseAction,
  computeDamage,
  currentActor,
  getWinner,
  isBattleOver,
  resolveMove,
  runBattle,
  startBattle,
  takeAutoTurn,
  takeTurn,
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

/**
 * The raw damage the documented formula should produce, before type
 * effectiveness, crit and the variance roll. Stated in terms of the balance
 * constants rather than a pinned number, so retuning damagePowerScale retunes
 * the game instead of breaking the test suite. The stat ratios below are chosen
 * to land on whole numbers so that rounding never hides a real error.
 */
function rawDamage(power: number, atkStat: number, defStat: number, tier = 0): number {
  return power * balance.damagePowerScale * cumulativeStatMultiplier(tier) * (atkStat / defStat);
}

describe('computeDamage: physical vs special stat usage', () => {
  it('a physical move scales off atk and def, ignoring spAtk/spDef', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 800, spAtk: 999, critChance: 0 } });
    const defender = makeCreature({ stats: { ...makeCreature().stats, def: 100, spDef: 999 } });
    // seq: [crit roll (fails, critChance=0), variance roll (0.5 = exact midpoint, factor 1)]
    const { damage, crit } = computeDamage(attacker, defender, neutralPhysical, sequenceRng([0, 0.5]));
    expect(crit).toBe(false);
    expect(damage).toBe(Math.round(rawDamage(50, 800, 100)));
  });

  it('a special move scales off spAtk and spDef, ignoring atk/def', () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, spAtk: 800, atk: 999, critChance: 0 } });
    const defender = makeCreature({ stats: { ...makeCreature().stats, spDef: 100, def: 999 } });
    const { damage } = computeDamage(attacker, defender, neutralSpecial, sequenceRng([0, 0.5]));
    expect(damage).toBe(Math.round(rawDamage(50, 800, 100)));
  });
});

describe('computeDamage: type effectiveness', () => {
  // Stated as multiples of an identical neutral-matchup hit rather than as raw
  // numbers: the claim under test is "strong is double, weak is half", and a
  // ratio says that directly and survives any retune of the damage constants.
  const neutralHit = () => {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 800, critChance: 0 } });
    const defender = makeCreature({ types: ['aether'], stats: { ...makeCreature().stats, def: 100 } });
    const move: DamageMove = { ...neutralPhysical, typeId: 'ember' };
    return computeDamage(attacker, defender, move, sequenceRng([0, 0.5])).damage;
  };

  function hitAgainst(defenderTypes: string[]): number {
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 800, critChance: 0 } });
    const defender = makeCreature({ types: defenderTypes, stats: { ...makeCreature().stats, def: 100 } });
    const move: DamageMove = { ...neutralPhysical, typeId: 'ember' };
    return computeDamage(attacker, defender, move, sequenceRng([0, 0.5])).damage;
  }

  it('a strong matchup roughly doubles damage', () => {
    expect(hitAgainst(['bloom'])).toBe(neutralHit() * 2); // ember -> bloom = 2x
  });

  it('a weak matchup roughly halves damage', () => {
    expect(hitAgainst(['volt'])).toBe(neutralHit() / 2); // ember -> volt = 0.5x
  });

  it('stacks against a dual-typed defender', () => {
    // ember -> bloom = 2x, ember -> volt = 0.5x, stacked = 1x
    expect(hitAgainst(['bloom', 'volt'])).toBe(neutralHit());
  });
});

describe('computeDamage: crit', () => {
  it('a crit multiplies damage by critDamage/100', () => {
    const base = { ...makeCreature().stats, atk: 800, def: 100 };
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

describe('computeDamage: tier scaling', () => {
  it('a higher-tier attacker hits harder than a lower-tier one with the same stats', () => {
    // Without this, damage does not grow with tier at all: raw damage is
    // attack/defence, and in an even fight both carry the same tier multiplier
    // so it cancels — while HP keeps growing. Tier-6 fights then need over a
    // thousand hits against a 50-round cap and can only ever end in a draw.
    const stats = { ...makeCreature().stats, atk: 800, critChance: 0 };
    const defender = makeCreature({ types: ['aether'], stats: { ...makeCreature().stats, def: 100 } });

    const lowTier = computeDamage(
      makeCreature({ tier: 0, stats }), defender, neutralPhysical, sequenceRng([0, 0.5]),
    ).damage;
    const highTier = computeDamage(
      makeCreature({ tier: 3, stats }), defender, neutralPhysical, sequenceRng([0, 0.5]),
    ).damage;

    expect(highTier).toBeGreaterThan(lowTier);
    expect(highTier).toBe(Math.round(rawDamage(50, 800, 100, 3)));
  });

  it('an evenly matched fight takes a similar number of rounds at every tier', () => {
    // The real point of the tier term: a fair fight should feel the same at
    // tier 0 and tier 6, because both sides grew together. Before this, the
    // same fight went from 1 hit to over 1500.
    const roundsAt = (tier: number) => {
      const totals: number[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const mult = cumulativeStatMultiplier(tier);
        const scaled = (s: number) => Math.max(1, Math.round(s * mult));
        const stats = {
          ...makeCreature().stats,
          hp: scaled(40), atk: scaled(12), spAtk: scaled(12),
          def: scaled(10), spDef: scaled(10), spd: scaled(11),
        };
        totals.push(runBattle(
          [makeCreature({ tier, stats })],
          [makeCreature({ tier, stats })],
          createRng(seed),
        ).rounds);
      }
      return totals.reduce((a, b) => a + b, 0) / totals.length;
    };

    const low = roundsAt(0);
    const high = roundsAt(6);
    expect(low).toBeLessThan(balance.maxBattleRounds);
    expect(high).toBeLessThan(balance.maxBattleRounds);
    // Within 2x of each other rather than the ~1500x the bug produced.
    expect(Math.max(low, high) / Math.min(low, high)).toBeLessThan(2);
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
    const attacker = makeCreature({ stats: { ...makeCreature().stats, atk: 800, critChance: 0 } });
    const defender = makeCreature({ types: ['aether'], stats: { ...makeCreature().stats, def: 100 } });
    const raw = rawDamage(50, 800, 100);
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
    if (move.kind === 'hybrid') throw new Error('single-typed creature should never pick a hybrid move');
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

describe('manual battle state machine (startBattle/currentActor/takeTurn)', () => {
  it('driving takeAutoTurn to completion produces the exact same result as runBattle', () => {
    const player = [makeCreature({ id: 'p1' }), makeCreature({ id: 'p2' })];
    const enemy = [makeCreature({ id: 'e1' }), makeCreature({ id: 'e2' })];

    const auto = runBattle(player, enemy, createRng(7));

    const state = startBattle(player, enemy);
    const rng = createRng(7);
    while (!isBattleOver(state)) {
      takeAutoTurn(state, rng);
    }
    expect({ winner: getWinner(state), log: state.log, rounds: state.round }).toEqual(auto);
  });

  it('lets a caller override the AI for one turn (manual control)', () => {
    const player = [makeCreature({ id: 'p1', stats: { ...makeCreature().stats, spd: 999 } })];
    const enemy = [makeCreature({ id: 'e1', stats: { ...makeCreature().stats, hp: 40, def: 999, spDef: 999 } })];
    const state = startBattle(player, enemy);

    const actor = currentActor(state);
    expect(actor?.creature.id).toBe('p1'); // fastest goes first

    const moves = movesForCreature(actor!.creature);
    const chosenMove = moves.find((m) => m.kind === 'damage' && m.category === 'physical');
    if (!chosenMove) throw new Error('expected a physical move');
    const enemyCombatant = state.combatants.find((c) => c.creature.id === 'e1');
    takeTurn(state, chosenMove, enemyCombatant, sequenceRng([0, 0, 0.5]));

    expect(state.log).toHaveLength(1);
    expect(state.log[0]?.moveName).toBe(chosenMove.name);
    expect(enemyCombatant?.currentHp).toBeLessThan(40);
  });

  it('always finishes, whatever the party sizes and whatever the luck', () => {
    // This is the guard against a freeze, not a balance check. A round's turn
    // order is fixed when the round starts, so creatures can die while still
    // queued. If every remaining entry is dead while both sides still have
    // someone alive, the engine used to stop producing an actor without ever
    // advancing the round — runBattle then span forever and the round cap could
    // never fire. Two sides trading kills in one round is enough to cause it,
    // which on a real device is a frozen game, not a wrong number.
    for (let size = 1; size <= 3; size++) {
      for (let seed = 1; seed <= 60; seed++) {
        const player = Array.from({ length: size }, (_, i) => makeCreature({ id: `p${i}` }));
        const enemy = Array.from({ length: size }, (_, i) => makeCreature({ id: `e${i}` }));
        const result = runBattle(player, enemy, createRng(seed));
        expect(result.rounds, `size ${size} seed ${seed}`).toBeLessThanOrEqual(balance.maxBattleRounds);
        expect(['player', 'enemy']).toContain(result.winner);
      }
    }
  });

  it('keeps going when everyone still queued this round is already dead', () => {
    // The exact shape of the freeze: two evenly matched sides where the pair
    // acting second both die before their turn comes round.
    const glass = { ...makeCreature().stats, hp: 1, atk: 400, spAtk: 400, def: 1, spDef: 1 };
    const player = [
      makeCreature({ id: 'p-fast', stats: { ...glass, spd: 100 } }),
      makeCreature({ id: 'p-slow', stats: { ...glass, spd: 1 } }),
    ];
    const enemy = [
      makeCreature({ id: 'e-fast', stats: { ...glass, spd: 99 } }),
      makeCreature({ id: 'e-slow', stats: { ...glass, spd: 2 } }),
    ];
    const result = runBattle(player, enemy, createRng(3));
    expect(result.rounds).toBeLessThanOrEqual(balance.maxBattleRounds);
    expect(['player', 'enemy']).toContain(result.winner);
  });

  it('isBattleOver / getWinner agree with a battle actually being finished', () => {
    const player = [makeCreature({ stats: { ...makeCreature().stats, atk: 500, spAtk: 500 } })];
    const enemy = [makeCreature({ stats: { ...makeCreature().stats, hp: 5, def: 1, spDef: 1 } })];
    const state = startBattle(player, enemy);
    expect(isBattleOver(state)).toBe(false);
    const rng = createRng(1);
    let guard = 0;
    while (!isBattleOver(state) && guard < 200) {
      takeAutoTurn(state, rng);
      guard++;
    }
    expect(isBattleOver(state)).toBe(true);
    expect(getWinner(state)).toBe('player');
  });
});
