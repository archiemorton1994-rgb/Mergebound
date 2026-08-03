/**
 * Typed access to the JSON content files in src/data/.
 * Pure TypeScript — no React, no UI imports.
 * Logic and UI must read game values through these helpers,
 * never hardcode them.
 */

import balanceJson from '../data/balance.json';
import binderJson from '../data/binder.json';
import economyJson from '../data/economy.json';
import hybridMovesJson from '../data/hybridMoves.json';
import movesJson from '../data/moves.json';
import speciesJson from '../data/species.json';
import typesJson from '../data/types.json';
import { STAT_KEYS } from './models';
import type {
  BinderAppearance,
  Creature,
  DamageMove,
  DrainMove,
  HealMove,
  HybridMove,
  MoveDef,
  SpeciesDef,
  StatKey,
  TypeDef,
  TypeRarity,
} from './models';

/** A move granted by exactly one type (everything except hybrid moves). */
export type SingleTypeMove = DamageMove | HealMove | DrainMove;

export const allSpecies: SpeciesDef[] = speciesJson.species;
export const allTypes: TypeDef[] = typesJson.types as TypeDef[];
export const allMoves: SingleTypeMove[] = movesJson.moves as SingleTypeMove[];
export const allHybridMoves: HybridMove[] = hybridMovesJson.hybridMoves as HybridMove[];

interface EffectivenessEntry {
  attacker: string;
  defender: string;
  multiplier: number;
}

const allEffectiveness: EffectivenessEntry[] = typesJson.effectiveness;

export const balance = {
  tierMultipliers: balanceJson.tierMultipliers as number[],
  statRollVariance: balanceJson.statRollVariance as number,
  eggsPerBatch: balanceJson.eggsPerBatch as number,
  combatDamageVariance: balanceJson.combatDamageVariance as number,
  typeRarityWeights: balanceJson.typeRarityWeights as unknown as Record<TypeRarity, number>,
  /** How many creatures a side fields in one battle. */
  partySize: balanceJson.partySize as number,
  /** Stalemate safety valve — a battle reaching this many rounds is a draw. */
  maxBattleRounds: balanceJson.maxBattleRounds as number,
  /** HP fraction below which the battle AI prioritises healing. */
  emergencyHealThreshold: balanceJson.emergencyHealThreshold as number,
  /** Flat multiplier on every move's power — see computeDamage in battle.ts. */
  damagePowerScale: balanceJson.damagePowerScale as number,
  /** Merges without a natural perfect roll before one is forced. */
  mergePityThreshold: balanceJson.pity.mergeThreshold as number,
  /** First-run flow numbers — see onboarding.ts. */
  tutorial: {
    /** How many eggs the tutorial lays out for the player's first choice. */
    eggCount: balanceJson.tutorial.eggCount as number,
  },
  /** Roll-quality thresholds shared by the art, the stat colours and the reveal. */
  reveal: {
    near: balanceJson.reveal.nearThreshold as number,
    gold: balanceJson.reveal.goldThreshold as number,
    perfect: balanceJson.reveal.perfectThreshold as number,
  },
  /** Display/sort weighting only — never a game rule. */
  powerWeights: balanceJson.powerWeights as unknown as Record<StatKey, number>,
};

/**
 * Every currency number. See src/data/economy.json for what each one means and
 * why it is set where it is — the reasoning lives with the numbers, not here.
 */
export const economy = {
  startingWallet: {
    gold: economyJson.startingWallet.gold as number,
    mergeStones: economyJson.startingWallet.mergeStones as number,
    gems: economyJson.startingWallet.gems as number,
  },
  merge: {
    stoneCostByInputTier: economyJson.merge.stoneCostByInputTier as number[],
    crossTierCostFraction: economyJson.merge.crossTierCostFraction as number,
  },
  battleRewards: {
    goldPerEnemyPerPowerUnit: economyJson.battleRewards.goldPerEnemyPerPowerUnit as number,
    starGoldMultipliers: economyJson.battleRewards.starGoldMultipliers as number[],
    starMergeStones: economyJson.battleRewards.starMergeStones as number[],
    minStonesPerWin: economyJson.battleRewards.minStonesPerWin as number,
    firstClearGoldMultiplier: economyJson.battleRewards.firstClearGoldMultiplier as number,
    repeatDecayPerAttempt: economyJson.battleRewards.repeatDecayPerAttempt as number,
    repeatRewardFloor: economyJson.battleRewards.repeatRewardFloor as number,
  },
  dailyCaps: {
    stonesEarned: economyJson.dailyCaps.stonesEarned as number,
    stonesPurchased: economyJson.dailyCaps.stonesPurchased as number,
  },
  idle: {
    rosterSize: economyJson.idle.rosterSize as number,
    goldPerHourPerPowerUnit: economyJson.idle.goldPerHourPerPowerUnit as number,
    offlineCapHours: economyJson.idle.offlineCapHours as number,
    minCollectMinutes: economyJson.idle.minCollectMinutes as number,
  },
  exchange: {
    baseGoldPerStone: economyJson.exchange.baseGoldPerStone as number,
    priceGrowth: economyJson.exchange.priceGrowth as number,
  },
  gemSources: {
    stageFirstClearThreeStars: economyJson.gemSources.stageFirstClearThreeStars as number,
    bossFirstClear: economyJson.gemSources.bossFirstClear as number,
    regionFullyMastered: economyJson.gemSources.regionFullyMastered as number,
  },
  gemSinks: {
    goldPerGem: economyJson.gemSinks.goldPerGem as number,
    cosmeticPriceBands: economyJson.gemSinks.cosmeticPriceBands as Record<string, number>,
  },
};

/** The Binder's appearance option lists — see src/data/binder.json. */
export const binderContent = {
  builds: binderJson.builds,
  skinTones: binderJson.skinTones,
  hairStyles: binderJson.hairStyles,
  hairColors: binderJson.hairColors,
  outfits: binderJson.outfits,
  outfitTones: binderJson.outfitTones,
  marks: binderJson.marks,
  nameParts: binderJson.nameParts,
  /** Character limit on a Binder's name after tidying — see sanitizeBinderName. */
  nameMaxLength: binderJson.nameMaxLength as number,
};

/**
 * The Binder a brand-new save starts with. Returns a fresh object every call —
 * never a shared constant, or every migrated save would alias one mutable
 * record and editing one player's Binder would edit them all.
 */
export function defaultBinderAppearance(): BinderAppearance {
  const d = binderJson.defaults;
  return {
    buildId: d.buildId,
    skinToneId: d.skinToneId,
    hairStyleId: d.hairStyleId,
    hairColorId: d.hairColorId,
    outfitId: d.outfitId,
    outfitToneId: d.outfitToneId,
    accentTypeId: d.accentTypeId,
    markId: d.markId,
  };
}

/**
 * A single number summarising how strong a creature is, for SORTING AND DISPLAY
 * only. Never read this in battle — battle resolves from the real stats. Crit
 * stats are weighted 0 because they are percentages, not magnitudes, so a big
 * critDamage number must not drown out everything else in the sort order.
 */
export function creaturePower(creature: Creature): number {
  return Math.round(
    STAT_KEYS.reduce((sum, key) => sum + creature.stats[key] * balance.powerWeights[key], 0),
  );
}

export function getSpecies(speciesId: string): SpeciesDef {
  const found = allSpecies.find((s) => s.id === speciesId);
  if (!found) throw new Error(`Unknown species: ${speciesId}`);
  return found;
}

export function getType(typeId: string): TypeDef {
  const found = allTypes.find((t) => t.id === typeId);
  if (!found) throw new Error(`Unknown type: ${typeId}`);
  return found;
}

/** Hatch weight for a type, driven by its rarity (see balance.json typeRarityWeights). */
export function typeWeight(type: TypeDef): number {
  return balance.typeRarityWeights[type.rarity];
}

/** Every move a type grants, in moves.json authoring order. */
export function movesForType(typeId: string): SingleTypeMove[] {
  return allMoves.filter((m) => m.typeId === typeId);
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('+');
}

const hybridMoveByPair = new Map<string, HybridMove>(
  allHybridMoves.map((m) => [pairKey(m.typeIds[0], m.typeIds[1]), m]),
);

/** The signature move for a pair of types, if one is authored — order doesn't matter. */
export function hybridMoveFor(typeA: string, typeB: string): HybridMove | undefined {
  return hybridMoveByPair.get(pairKey(typeA, typeB));
}

/**
 * Every move available to a creature: the union of its 1-2 types' movepools,
 * plus — for a creature with exactly two types — the signature hybrid move
 * for that combination, if one exists. This is the actual "perk" of merging
 * into a specific dual type: a move neither parent type had on its own.
 */
export function movesForCreature(creature: Creature): MoveDef[] {
  const base: MoveDef[] = creature.types.flatMap((t) => movesForType(t));
  const [a, b] = creature.types;
  const hybrid = creature.types.length === 2 && a && b ? hybridMoveFor(a, b) : undefined;
  return hybrid ? [...base, hybrid] : base;
}

/**
 * The damage multiplier for one attacking type against one defending type:
 * 2 = strong, 0.5 = weak, 1 = neutral (no entry either way).
 */
function singleTypeEffectiveness(attackerTypeId: string, defenderTypeId: string): number {
  const entry = allEffectiveness.find(
    (e) => e.attacker === attackerTypeId && e.defender === defenderTypeId,
  );
  return entry?.multiplier ?? 1;
}

/**
 * The full damage multiplier for a move's type against a (possibly dual-typed)
 * defender: each of the defender's types is checked independently and the
 * multipliers stack, same as the classic dual-type formula this table is
 * modelled on.
 */
export function typeEffectiveness(attackerTypeId: string, defenderTypeIds: string[]): number {
  return defenderTypeIds.reduce(
    (mult, defenderTypeId) => mult * singleTypeEffectiveness(attackerTypeId, defenderTypeId),
    1,
  );
}

/**
 * The effectiveness multiplier for any move (including hybrids) against a
 * defender. A hybrid move averages its two component types' multipliers
 * instead of stacking them — that keeps it reliably decent rather than a
 * coin flip between a 4x blowout and a 0.25x dud.
 */
export function effectivenessForMove(move: MoveDef, defenderTypeIds: string[]): number {
  if (move.kind === 'hybrid') {
    const [t1, t2] = move.typeIds;
    return (typeEffectiveness(t1, defenderTypeIds) + typeEffectiveness(t2, defenderTypeIds)) / 2;
  }
  if (move.kind === 'heal') return 1;
  return typeEffectiveness(move.typeId, defenderTypeIds);
}

/**
 * Per-merge growth multiplier for a tier — NOT cumulative from tier 0.
 * See mergedStats in merge.ts for how this is actually applied.
 * Tiers beyond the table reuse the last entry.
 */
export function tierMultiplier(tier: number): number {
  const table = balance.tierMultipliers;
  const last = table[table.length - 1] ?? 1;
  return table[Math.min(tier, table.length - 1)] ?? last;
}

/**
 * The TRUE cumulative stat multiplier at a tier, assuming every merge up to
 * that tier was a same-tier merge (the only path that grows stats — cross-tier
 * merges apply no multiplier at all). Use this instead of reading
 * tierMultipliers directly whenever you need a tier's actual relative power,
 * e.g. tuning enemy scaling.
 */
export function cumulativeStatMultiplier(tier: number): number {
  let result = 1;
  for (let t = 1; t <= tier; t++) {
    result *= tierMultiplier(t);
  }
  return result;
}
