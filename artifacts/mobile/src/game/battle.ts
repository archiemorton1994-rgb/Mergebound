/**
 * Party battle resolution. Pure functions — no React, no UI imports.
 * A whole battle is simulated instantly given a seed: runBattle() returns
 * a complete, deterministic event log rather than requiring turn-by-turn
 * input, so the UI can play the log back at any speed (or none) — this is
 * what "auto-battle friendly" means for the party format Archie chose.
 *
 * AI (both sides use the same one, v1 keeps it simple):
 *  - If any living ally's HP is below EMERGENCY_HEAL_THRESHOLD and the actor
 *    knows a heal move, heal (a single-target heal move is preferred over a
 *    party heal when both are somehow available).
 *  - Otherwise attack: target the lowest-HP living enemy, and pick whichever
 *    damage/drain move has the best type-effectiveness multiplier against it.
 * Turn order is every living combatant, both sides, fastest Speed first,
 * recomputed each round.
 */

import { movesForCreature, typeEffectiveness } from './content';
import { balance } from './content';
import type { Creature, DamageMove, DrainMove, HealMove, MoveDef, Rng } from './models';

/** How low an ally's HP must drop (as a fraction of max) before the AI prioritises healing. */
const EMERGENCY_HEAL_THRESHOLD = 0.5;
/** Safety valve against an endless stalemate (e.g. two healers with no way to finish each other). */
const MAX_ROUNDS = 50;

export type Side = 'player' | 'enemy';

/** A creature as it exists mid-battle: the source Creature is never mutated. */
export interface Combatant {
  creature: Creature;
  currentHp: number;
  side: Side;
}

export interface BattleLogEntry {
  round: number;
  actorId: string;
  actorName: string;
  actorSide: Side;
  moveName: string;
  moveKind: MoveDef['kind'];
  targetName: string;
  hit: boolean;
  damage: number;
  healed: number;
  crit: boolean;
  targetFainted: boolean;
}

export interface BattleResult {
  winner: Side;
  log: BattleLogEntry[];
  rounds: number;
}

function makeCombatant(creature: Creature, side: Side): Combatant {
  return { creature, currentHp: creature.stats.hp, side };
}

function hpRatio(c: Combatant): number {
  return c.currentHp / c.creature.stats.hp;
}

/** Physical uses atk vs def; special uses spAtk vs spDef. Type effectiveness, crit, and a small combat roll all apply. */
export function computeDamage(
  attacker: Creature,
  defender: Creature,
  move: DamageMove | DrainMove,
  rng: Rng,
): { damage: number; crit: boolean } {
  const atkStat = move.category === 'physical' ? attacker.stats.atk : attacker.stats.spAtk;
  const defStat = move.category === 'physical' ? defender.stats.def : defender.stats.spDef;
  const raw = move.power * (atkStat / defStat);
  const typeMult = typeEffectiveness(move.typeId, defender.types);
  const crit = rng() < attacker.stats.critChance / 100;
  const critMult = crit ? attacker.stats.critDamage / 100 : 1;
  const v = balance.combatDamageVariance;
  const varianceFactor = 1 + (rng() * 2 - 1) * v;
  const damage = Math.max(1, Math.round(raw * typeMult * critMult * varianceFactor));
  return { damage, crit };
}

/** Pick this actor's move (and target, where relevant) for one turn. */
export function chooseAction(
  actor: Combatant,
  allies: Combatant[],
  enemies: Combatant[],
  moves: MoveDef[],
): { move: MoveDef; target: Combatant | undefined } {
  const livingAllies = allies.filter((a) => a.currentHp > 0);
  const livingEnemies = enemies.filter((e) => e.currentHp > 0);
  const healMoves = moves.filter((m): m is HealMove => m.kind === 'heal');

  if (healMoves.length > 0 && livingAllies.length > 0) {
    const neediest = livingAllies.reduce((worst, a) => (hpRatio(a) < hpRatio(worst) ? a : worst));
    if (hpRatio(neediest) < EMERGENCY_HEAL_THRESHOLD) {
      const singleHeal = healMoves.find((m) => m.target === 'lowest-ally');
      const partyHeal = healMoves.find((m) => m.target === 'party');
      const move = singleHeal ?? partyHeal;
      if (move) {
        return { move, target: move.target === 'party' ? undefined : neediest };
      }
    }
  }

  const attackMoves = moves.filter((m): m is DamageMove | DrainMove => m.kind !== 'heal');
  const target = livingEnemies.reduce((weakest, e) => (e.currentHp < weakest.currentHp ? e : weakest));
  let bestMove = attackMoves[0];
  let bestMult = -1;
  for (const m of attackMoves) {
    const mult = typeEffectiveness(m.typeId, target.creature.types);
    if (mult > bestMult) {
      bestMult = mult;
      bestMove = m;
    }
  }
  if (!bestMove) {
    throw new Error(`${actor.creature.name} has no usable moves`);
  }
  return { move: bestMove, target };
}

/** Resolve one actor's chosen move, mutating currentHp on whichever Combatants it affects. */
export function resolveMove(
  actor: Combatant,
  target: Combatant | undefined,
  allies: Combatant[],
  move: MoveDef,
  rng: Rng,
  round: number,
): BattleLogEntry {
  const base = {
    round,
    actorId: actor.creature.id,
    actorName: actor.creature.name,
    actorSide: actor.side,
    moveName: move.name,
    moveKind: move.kind,
  };

  const isPartyHeal = move.kind === 'heal' && move.target === 'party';
  const targetName = isPartyHeal ? 'the party' : (target?.creature.name ?? 'unknown target');

  // Accuracy applies uniformly to every move kind, heals included — a heal
  // move with accuracy < 100 (none currently) can whiff just like an attack.
  const hit = rng() * 100 < move.accuracy;
  if (!hit) {
    return { ...base, targetName, hit: false, damage: 0, healed: 0, crit: false, targetFainted: false };
  }

  if (move.kind === 'heal') {
    if (move.target === 'party') {
      let totalHealed = 0;
      for (const ally of allies.filter((a) => a.currentHp > 0)) {
        const maxHp = ally.creature.stats.hp;
        const before = ally.currentHp;
        ally.currentHp = Math.min(maxHp, ally.currentHp + Math.round(maxHp * move.healFraction));
        totalHealed += ally.currentHp - before;
      }
      return { ...base, targetName, hit: true, damage: 0, healed: totalHealed, crit: false, targetFainted: false };
    }
    if (!target) throw new Error(`${move.name} needs a target`);
    const maxHp = target.creature.stats.hp;
    const before = target.currentHp;
    target.currentHp = Math.min(maxHp, target.currentHp + Math.round(maxHp * move.healFraction));
    return {
      ...base,
      targetName,
      hit: true,
      damage: 0,
      healed: target.currentHp - before,
      crit: false,
      targetFainted: false,
    };
  }

  if (!target) throw new Error(`${move.name} needs a target`);
  const { damage, crit } = computeDamage(actor.creature, target.creature, move, rng);
  target.currentHp = Math.max(0, target.currentHp - damage);

  let healed = 0;
  if (move.kind === 'drain') {
    const maxHp = actor.creature.stats.hp;
    const before = actor.currentHp;
    actor.currentHp = Math.min(maxHp, actor.currentHp + Math.round(damage * move.drainFraction));
    healed = actor.currentHp - before;
  }

  return {
    ...base,
    targetName,
    hit: true,
    damage,
    healed,
    crit,
    targetFainted: target.currentHp <= 0,
  };
}

/**
 * Simulate a full party battle to completion and return the winning side
 * plus a complete event log. Deterministic: the same two parties and the
 * same rng always produce the same result.
 */
export function runBattle(playerParty: Creature[], enemyParty: Creature[], rng: Rng): BattleResult {
  const combatants: Combatant[] = [
    ...playerParty.map((c) => makeCombatant(c, 'player')),
    ...enemyParty.map((c) => makeCombatant(c, 'enemy')),
  ];
  const log: BattleLogEntry[] = [];

  let round = 0;
  while (round < MAX_ROUNDS) {
    round++;
    const turnOrder = combatants
      .filter((c) => c.currentHp > 0)
      .sort((a, b) => b.creature.stats.spd - a.creature.stats.spd);

    for (const actor of turnOrder) {
      if (actor.currentHp <= 0) continue; // fainted earlier this round
      const allies = combatants.filter((c) => c.side === actor.side);
      const enemies = combatants.filter((c) => c.side !== actor.side);
      if (enemies.every((e) => e.currentHp <= 0) || allies.every((a) => a.currentHp <= 0)) break;

      const moves = movesForCreature(actor.creature);
      const { move, target } = chooseAction(actor, allies, enemies, moves);
      log.push(resolveMove(actor, target, allies, move, rng, round));
    }

    const playerAlive = combatants.some((c) => c.side === 'player' && c.currentHp > 0);
    const enemyAlive = combatants.some((c) => c.side === 'enemy' && c.currentHp > 0);
    if (!playerAlive || !enemyAlive) break;
  }

  const playerAlive = combatants.some((c) => c.side === 'player' && c.currentHp > 0);
  const enemyAlive = combatants.some((c) => c.side === 'enemy' && c.currentHp > 0);
  let winner: Side;
  if (playerAlive && !enemyAlive) {
    winner = 'player';
  } else if (enemyAlive && !playerAlive) {
    winner = 'enemy';
  } else {
    // MAX_ROUNDS stalemate (or the practically-impossible simultaneous wipe):
    // whoever has more total HP left takes it.
    const totalHp = (side: Side) =>
      combatants.filter((c) => c.side === side).reduce((sum, c) => sum + Math.max(0, c.currentHp), 0);
    winner = totalHp('player') >= totalHp('enemy') ? 'player' : 'enemy';
  }

  return { winner, log, rounds: round };
}
