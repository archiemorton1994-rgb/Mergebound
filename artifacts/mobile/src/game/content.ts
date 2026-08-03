/**
 * Typed access to the JSON content files in src/data/.
 * Pure TypeScript — no React, no UI imports.
 * Logic and UI must read game values through these helpers,
 * never hardcode them.
 */

import balanceJson from '../data/balance.json';
import speciesJson from '../data/species.json';
import typesJson from '../data/types.json';
import type { SpeciesDef, TypeDef, TypeRarity } from './models';

export const allSpecies: SpeciesDef[] = speciesJson.species;
export const allTypes: TypeDef[] = typesJson.types as TypeDef[];

export const balance = {
  tierMultipliers: balanceJson.tierMultipliers as number[],
  statRollVariance: balanceJson.statRollVariance as number,
  eggsPerBatch: balanceJson.eggsPerBatch as number,
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
