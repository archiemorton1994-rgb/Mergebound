/**
 * Party battle resolution. Pure functions — no React, no UI imports.
 *
 * Two ways to play the same engine:
 *  - Auto: runBattle() simulates a whole battle instantly and returns a
 *    complete, deterministic event log to play back at any speed.
 *  - Manual: startBattle() + currentActor() + takeTurn()/takeAutoTurn() let
 *    a caller (the UI) drive one action at a time — the player picks the
 *    move/target for their own creatures' turns, enemy turns always resolve
 *    via the built-in AI. Both modes share every rule below; nothing is
 *    duplicated between them.
 *
 * AI (both sides use the same one):
 *  - If any living ally's HP is below EMERGENCY_HEAL_THRESHOLD and the actor
 *    knows a heal move, heal (a single-target heal move is preferred over a
 *    party heal when both are somehow available).
 *  - Otherwise attack: target the lowest-HP living enemy, and pick whichever
 *    damage/drain/hybrid move has the best type-effectiveness multiplier
 *    against it.
 * Turn order is every living combatant, both sides, fastest Speed first,
 * recomputed each round.
 */

import { cumulativeStatMultiplier, effectivenessForMove, movesForCreature } from './content';
import { balance } from './content';
import type { Creature, DamageMove, DrainMove, HealMove, HybridMove, MoveDef, Rng } from './models';

/** How low an ally's HP must drop (as a fraction of max) before the AI prioritises healing. */
const EMERGENCY_HEAL_THRESHOLD = balance.emergencyHealThreshold;
/** Safety valve against an endless stalemate (e.g. two healers with no way to finish each other). */
const MAX_ROUNDS = balance.maxBattleRounds;

export type Side = 'player' | 'enemy';

/** An attack-shaped move: deals damage, possibly with a side effect (drain) or dual typing (hybrid). */
export type AttackMove = DamageMove | DrainMove | HybridMove;

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

/** Mutable battle-in-progress state for manual, step-by-step play. */
export interface BattleState {
  combatants: Combatant[];
  round: number;
  /** Living combatants still to act this round, fastest first. Refilled when empty. */
  pendingTurnOrder: Combatant[];
  log: BattleLogEntry[];
}

function makeCombatant(creature: Creature, side: Side): Combatant {
  return { creature, currentHp: creature.stats.hp, side };
}

function hpRatio(c: Combatant): number {
  return c.currentHp / c.creature.stats.hp;
}

/**
 * Physical uses atk vs def; special uses spAtk vs spDef. Type effectiveness,
 * crit, and a small combat roll all apply.
 *
 * Note the cumulativeStatMultiplier(attacker.tier) term. Without it, damage does
 * not grow with tier at all: raw damage is power x (attack / defence), and in an
 * evenly matched fight both of those stats carry the same tier multiplier, so it
 * cancels — while HP keeps growing to ~2800x by tier 6. That is not a small
 * imbalance, it is a broken game: a tier-6 mirror match needed over 1500 hits
 * against a 50-round cap, so it could only ever end in a draw. Scaling damage by
 * the attacker's own cumulative multiplier restores the intent, and makes a fair
 * fight take a similar number of hits at every tier. A tier gap still decides a
 * fight decisively, which is the point of tiers.
 */
export function computeDamage(
  attacker: Creature,
  defender: Creature,
  move: AttackMove,
  rng: Rng,
): { damage: number; crit: boolean } {
  const atkStat = move.category === 'physical' ? attacker.stats.atk : attacker.stats.spAtk;
  const defStat = move.category === 'physical' ? defender.stats.def : defender.stats.spDef;
  const raw =
    move.power *
    balance.damagePowerScale *
    cumulativeStatMultiplier(attacker.tier) *
    (atkStat / defStat);
  const typeMult = effectivenessForMove(move, defender.types);
  const crit = rng() < attacker.stats.critChance / 100;
  const critMult = crit ? attacker.stats.critDamage / 100 : 1;
  const v = balance.combatDamageVariance;
  const varianceFactor = 1 + (rng() * 2 - 1) * v;
  const damage = Math.max(1, Math.round(raw * typeMult * critMult * varianceFactor));
  return { damage, crit };
}

/** Pick this actor's move (and target, where relevant) for one turn — the AI used for every non-manual turn. */
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

  const attackMoves = moves.filter((m): m is AttackMove => m.kind !== 'heal');
  const target = livingEnemies.reduce((weakest, e) => (e.currentHp < weakest.currentHp ? e : weakest));
  let bestMove = attackMoves[0];
  let bestMult = -1;
  for (const m of attackMoves) {
    const mult = effectivenessForMove(m, target.creature.types);
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

// --- Manual / step-by-step battle state machine -----------------------------

function sideAlive(state: BattleState, side: Side): boolean {
  return state.combatants.some((c) => c.side === side && c.currentHp > 0);
}

/** True once the battle has a decided (or forced) winner. */
export function isBattleOver(state: BattleState): boolean {
  if (!sideAlive(state, 'player') || !sideAlive(state, 'enemy')) return true;
  return state.round >= MAX_ROUNDS && state.pendingTurnOrder.length === 0;
}

/** The winning side. Only meaningful once isBattleOver(state) is true. */
export function getWinner(state: BattleState): Side {
  const playerAlive = sideAlive(state, 'player');
  const enemyAlive = sideAlive(state, 'enemy');
  if (playerAlive && !enemyAlive) return 'player';
  if (enemyAlive && !playerAlive) return 'enemy';
  // MAX_ROUNDS stalemate (or the practically-impossible simultaneous wipe):
  // whoever has more total HP left takes it.
  const totalHp = (side: Side) =>
    state.combatants.filter((c) => c.side === side).reduce((sum, c) => sum + Math.max(0, c.currentHp), 0);
  return totalHp('player') >= totalHp('enemy') ? 'player' : 'enemy';
}

/** Start a new battle. Call takeTurn/takeAutoTurn repeatedly until isBattleOver(state). */
export function startBattle(playerParty: Creature[], enemyParty: Creature[]): BattleState {
  return {
    combatants: [
      ...playerParty.map((c) => makeCombatant(c, 'player')),
      ...enemyParty.map((c) => makeCombatant(c, 'enemy')),
    ],
    round: 0,
    pendingTurnOrder: [],
    log: [],
  };
}

function beginRound(state: BattleState): void {
  state.round++;
  state.pendingTurnOrder = state.combatants
    .filter((c) => c.currentHp > 0)
    .sort((a, b) => b.creature.stats.spd - a.creature.stats.spd);
}

/**
 * Whoever should act next, or undefined once the battle is over.
 *
 * A round's turn order is fixed when the round begins, so a combatant killed
 * partway through the round is still sitting in the queue. Those are skipped —
 * and if skipping them empties the round, the next round starts here rather
 * than leaving the caller stuck. That last part is not a nicety: if every
 * remaining entry is dead while both sides still have someone alive, this used
 * to return undefined, which makes takeTurn/takeAutoTurn a no-op and never
 * advances the round — so runBattle's loop spun forever and the MAX_ROUNDS
 * safety valve could never fire. Two sides trading kills on each other's
 * not-yet-acted creature in the same round is enough to hit it.
 *
 * Terminates because every pass either returns an actor or advances the round,
 * and isBattleOver is true once the round cap is reached with an empty queue.
 */
export function currentActor(state: BattleState): Combatant | undefined {
  for (;;) {
    if (isBattleOver(state)) return undefined;
    if (state.pendingTurnOrder.length === 0) beginRound(state);
    const actor = state.pendingTurnOrder.find((c) => c.currentHp > 0);
    if (actor) return actor;
    state.pendingTurnOrder = [];
  }
}

/**
 * Resolve the current actor's turn with a specific move/target — this is
 * what manual play calls when the player chooses for one of their own
 * creatures. For heal moves targeting the whole party, pass target: undefined.
 */
export function takeTurn(state: BattleState, move: MoveDef, target: Combatant | undefined, rng: Rng): BattleState {
  const actor = currentActor(state);
  if (!actor) return state;
  state.pendingTurnOrder = state.pendingTurnOrder.filter((c) => c !== actor);

  const allies = state.combatants.filter((c) => c.side === actor.side);
  const enemies = state.combatants.filter((c) => c.side !== actor.side);
  if (enemies.every((e) => e.currentHp <= 0) || allies.every((a) => a.currentHp <= 0)) return state;

  state.log.push(resolveMove(actor, target, allies, move, rng, state.round));
  return state;
}

/** Resolve the current actor's turn automatically via the built-in AI — used for every enemy turn, and for player turns in auto-battle mode. */
export function takeAutoTurn(state: BattleState, rng: Rng): BattleState {
  const actor = currentActor(state);
  if (!actor) return state;
  const allies = state.combatants.filter((c) => c.side === actor.side);
  const enemies = state.combatants.filter((c) => c.side !== actor.side);
  const moves = movesForCreature(actor.creature);
  const { move, target } = chooseAction(actor, allies, enemies, moves);
  return takeTurn(state, move, target, rng);
}

/**
 * Simulate a full party battle to completion and return the winning side
 * plus a complete event log. Deterministic: the same two parties and the
 * same rng always produce the same result. This is startBattle() driven
 * entirely by takeAutoTurn() — the auto-battle path through the same engine
 * manual play uses.
 */
export function runBattle(playerParty: Creature[], enemyParty: Creature[], rng: Rng): BattleResult {
  const state = startBattle(playerParty, enemyParty);
  while (!isBattleOver(state)) {
    takeAutoTurn(state, rng);
  }
  return { winner: getWinner(state), log: state.log, rounds: state.round };
}
