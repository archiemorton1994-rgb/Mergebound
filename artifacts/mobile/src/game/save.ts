/**
 * Save/load serialisation. Pure functions — they turn a collection into a
 * string and back, with validation. Actual storage (AsyncStorage) happens
 * in the UI layer (src/screens/CollectionContext.tsx).
 * No React, no UI imports.
 */

import type { Creature, Stats } from './models';

const SAVE_VERSION = 1;

interface SaveFile {
  version: number;
  collection: Creature[];
}

export function serializeCollection(collection: Creature[]): string {
  const file: SaveFile = { version: SAVE_VERSION, collection };
  return JSON.stringify(file);
}

function isStats(value: unknown): value is Stats {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (['hp', 'atk', 'def', 'spd'] as const).every(
    (k) => typeof s[k] === 'number' && Number.isFinite(s[k]),
  );
}

function isCreature(value: unknown): value is Creature {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c['id'] === 'string' &&
    typeof c['speciesId'] === 'string' &&
    typeof c['name'] === 'string' &&
    typeof c['tier'] === 'number' &&
    Number.isInteger(c['tier']) &&
    Array.isArray(c['types']) &&
    c['types'].length >= 1 &&
    c['types'].length <= 2 &&
    c['types'].every((t) => typeof t === 'string') &&
    isStats(c['stats']) &&
    Array.isArray(c['parentIds']) &&
    c['parentIds'].every((p) => typeof p === 'string')
  );
}

/**
 * Parse a saved string back into a collection.
 * Throws with a clear message if the data is corrupt — callers decide
 * how to surface that. Never silently returns partial data.
 */
export function deserializeCollection(raw: string): Creature[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Save data is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Save data has an unexpected shape');
  }
  const file = parsed as Record<string, unknown>;
  if (file['version'] !== SAVE_VERSION) {
    throw new Error(`Unsupported save version: ${String(file['version'])}`);
  }
  if (!Array.isArray(file['collection']) || !file['collection'].every(isCreature)) {
    throw new Error('Save data contains an invalid creature');
  }
  return file['collection'];
}
