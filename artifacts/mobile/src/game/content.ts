/**
 * Typed access to the JSON content files in src/data/.
 * Pure TypeScript — no React, no UI imports.
 * Logic and UI must read game values through these helpers,
 * never hardcode them.
 */

import balanceJson from '../data/balance.json';
import movesJson from '../data/moves.json';
import speciesJson from '../data/species.json';
import typesJson from '../data/types.json';
import type { Creature, MoveDef, SpeciesDef, TypeDef, TypeRarity } from './models';

export const allSpecies: SpeciesDef[] = speciesJson.species;
export const allTypes: TypeDef[] = typesJson.types as TypeDef[];
export const allMoves: MoveDef[] = movesJson.moves as MoveDef[];

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
};

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

/** Every move a type grants, in types.json move-authoring order. */
export function movesForType(typeId: string): MoveDef[] {
  return allMoves.filter((m) => m.typeId === typeId);
}

/** Every move available to a creature — the union of its 1-2 types' movepools. */
export function movesForCreature(creature: Creature): MoveDef[] {
  return creature.types.flatMap((t) => movesForType(t));
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
