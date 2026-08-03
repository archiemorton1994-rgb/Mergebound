/**
 * Typed access to the JSON content files in src/data/.
 * Pure TypeScript — no React, no UI imports.
 * Logic and UI must read game values through these helpers,
 * never hardcode them.
 */

import balanceJson from '../data/balance.json';
import speciesJson from '../data/species.json';
import typesJson from '../data/types.json';
import type { SpeciesDef, TypeDef } from './models';

export const allSpecies: SpeciesDef[] = speciesJson.species;
export const allTypes: TypeDef[] = typesJson.types;

export const balance = {
  tierMultipliers: balanceJson.tierMultipliers as number[],
  statRollVariance: balanceJson.statRollVariance as number,
  eggsPerBatch: balanceJson.eggsPerBatch as number,
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

/** Tier multiplier for a tier; tiers beyond the table reuse the last entry. */
export function tierMultiplier(tier: number): number {
  const table = balance.tierMultipliers;
  const last = table[table.length - 1] ?? 1;
  return table[Math.min(tier, table.length - 1)] ?? last;
}
