/**
 * Tests for save/load (src/game/save.ts): a collection must survive the
 * round trip to a string and back with no data loss, corrupt data must be
 * rejected loudly instead of silently mangled, and old (v1) saves must be
 * migrated forward instead of wiping the player's collection.
 */

import { describe, expect, it } from 'vitest';
import { generateEggBatch } from '../hatch';
import { merge } from '../merge';
import { STAT_KEYS } from '../models';
import { createRng } from '../rng';
import { deserializeCollection, serializeCollection } from '../save';
import { makeCreature } from './helpers';

describe('save and load round trip', () => {
  it('an empty collection survives the round trip', () => {
    expect(deserializeCollection(serializeCollection([]))).toEqual([]);
  });

  it('hatched creatures survive the round trip with every field intact', () => {
    const collection = generateEggBatch(createRng(21));
    expect(deserializeCollection(serializeCollection(collection))).toEqual(collection);
  });

  it('a merged creature (with parent ids and two types) survives the round trip', () => {
    const rng = createRng(8);
    const a = makeCreature({ tier: 1, types: ['ember', 'tide'] });
    const b = makeCreature({ tier: 1, types: ['volt'] });
    const collection = [merge(a, b, rng)];
    expect(deserializeCollection(serializeCollection(collection))).toEqual(collection);
  });

  it('a large mixed collection survives the round trip', () => {
    const rng = createRng(99);
    const eggs = [...generateEggBatch(rng), ...generateEggBatch(rng)];
    const first = eggs[0];
    const second = eggs[1];
    if (!first || !second) throw new Error('expected at least two eggs');
    const collection = [...eggs, merge(first, second, rng)];
    expect(deserializeCollection(serializeCollection(collection))).toEqual(collection);
  });

  it('always writes the current save version', () => {
    const saved = JSON.parse(serializeCollection([makeCreature()])) as { version: number };
    expect(saved.version).toBe(2);
  });
});

describe('migrating a v1 save (pre special-stats, no statRolls)', () => {
  function v1Save(creatures: unknown[]): string {
    return JSON.stringify({ version: 1, collection: creatures });
  }

  it('upgrades an old creature instead of rejecting it', () => {
    const old = {
      id: 'legacy-1',
      speciesId: 'cindret',
      name: 'Cindret',
      tier: 2,
      types: ['ember'],
      stats: { hp: 88, atk: 30, def: 20, spd: 25 },
      parentIds: ['p1', 'p2'],
    };
    const [migrated] = deserializeCollection(v1Save([old]));
    if (!migrated) throw new Error('expected one migrated creature');

    expect(migrated.id).toBe('legacy-1');
    expect(migrated.tier).toBe(2);
    expect(migrated.types).toEqual(['ember']);
    expect(migrated.parentIds).toEqual(['p1', 'p2']);
    // Physical stats carry over exactly.
    expect(migrated.stats.hp).toBe(88);
    expect(migrated.stats.atk).toBe(30);
    expect(migrated.stats.def).toBe(20);
    expect(migrated.stats.spd).toBe(25);
  });

  it('fills in every new stat so the migrated creature is a fully valid v2 creature', () => {
    const old = {
      id: 'legacy-2',
      speciesId: 'mossling',
      name: 'Mossling',
      tier: 0,
      types: ['bloom'],
      stats: { hp: 50, atk: 9, def: 13, spd: 8 },
      parentIds: [],
    };
    const [migrated] = deserializeCollection(v1Save([old]));
    if (!migrated) throw new Error('expected one migrated creature');
    for (const k of STAT_KEYS) {
      expect(typeof migrated.stats[k]).toBe('number');
      expect(typeof migrated.statRolls[k]).toBe('number');
    }
  });

  it('a migrated collection re-saves as v2 and round-trips cleanly from then on', () => {
    const old = {
      id: 'legacy-3',
      speciesId: 'puddlet',
      name: 'Puddlet',
      tier: 1,
      types: ['tide'],
      stats: { hp: 60, atk: 14, def: 15, spd: 12 },
      parentIds: [],
    };
    const migrated = deserializeCollection(v1Save([old]));
    const resaved = serializeCollection(migrated);
    expect(deserializeCollection(resaved)).toEqual(migrated);
  });

  it('still rejects a v1 save with a genuinely broken creature', () => {
    expect(() => deserializeCollection(v1Save([{ broken: true }]))).toThrow(/invalid creature/i);
  });
});

describe('rejecting corrupt save data', () => {
  it('rejects text that is not JSON at all', () => {
    expect(() => deserializeCollection('definitely not json')).toThrow(/not valid JSON/);
  });

  it('rejects JSON that is not a save file shape', () => {
    expect(() => deserializeCollection('42')).toThrow();
    expect(() => deserializeCollection('null')).toThrow();
    expect(() => deserializeCollection('[]')).toThrow();
  });

  it('rejects a save file from an unrecognised version', () => {
    const future = JSON.stringify({ version: 999, collection: [] });
    expect(() => deserializeCollection(future)).toThrow(/version/i);
  });

  it('rejects a creature missing its stats', () => {
    const bad = JSON.stringify({
      version: 2,
      collection: [{ ...makeCreature(), stats: undefined }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature missing its statRolls', () => {
    const bad = JSON.stringify({
      version: 2,
      collection: [{ ...makeCreature(), statRolls: undefined }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature with zero types', () => {
    const bad = JSON.stringify({
      version: 2,
      collection: [{ ...makeCreature(), types: [] }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature with three types (the two-type cap is enforced on load too)', () => {
    const bad = JSON.stringify({
      version: 2,
      collection: [{ ...makeCreature(), types: ['ember', 'tide', 'volt'] }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature whose stats are not finite numbers', () => {
    const bad = JSON.stringify({
      version: 2,
      collection: [{ ...makeCreature(), stats: { ...makeCreature().stats, hp: 'lots' } }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects the whole save if even one creature among many is invalid', () => {
    const bad = JSON.stringify({
      version: 2,
      collection: [makeCreature(), { broken: true }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });
});
