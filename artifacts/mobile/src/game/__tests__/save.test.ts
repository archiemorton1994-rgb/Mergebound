/**
 * Tests for save/load (src/game/save.ts): a collection (and the merge pity
 * counter) must survive the round trip to a string and back with no data
 * loss, corrupt data must be rejected loudly instead of silently mangled,
 * and old (v1, v2) saves must be migrated forward instead of wiping the
 * player's collection.
 */

import { describe, expect, it } from 'vitest';
import { generateEggBatch } from '../hatch';
import { merge } from '../merge';
import { STAT_KEYS } from '../models';
import { createRng } from '../rng';
import { deserializeCollection, serializeCollection, type SaveData } from '../save';
import { makeCreature } from './helpers';

describe('save and load round trip', () => {
  it('an empty collection with zero pity survives the round trip', () => {
    const data: SaveData = { collection: [], mergePity: 0 };
    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });

  it('hatched creatures survive the round trip with every field intact', () => {
    const data: SaveData = { collection: generateEggBatch(createRng(21)), mergePity: 0 };
    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });

  it('a merged creature (with parent ids and two types) survives the round trip', () => {
    const rng = createRng(8);
    const a = makeCreature({ tier: 1, types: ['ember', 'tide'] });
    const b = makeCreature({ tier: 1, types: ['volt'] });
    const data: SaveData = { collection: [merge(a, b, rng)], mergePity: 3 };
    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });

  it('the merge pity counter survives the round trip at any value', () => {
    for (const mergePity of [0, 1, 9, 10, 500]) {
      const data: SaveData = { collection: [], mergePity };
      expect(deserializeCollection(serializeCollection(data)).mergePity).toBe(mergePity);
    }
  });

  it('a large mixed collection survives the round trip', () => {
    const rng = createRng(99);
    const eggs = [...generateEggBatch(rng), ...generateEggBatch(rng)];
    const first = eggs[0];
    const second = eggs[1];
    if (!first || !second) throw new Error('expected at least two eggs');
    const data: SaveData = { collection: [...eggs, merge(first, second, rng)], mergePity: 5 };
    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });

  it('always writes the current save version', () => {
    const saved = JSON.parse(serializeCollection({ collection: [], mergePity: 0 })) as { version: number };
    expect(saved.version).toBe(3);
  });
});

describe('migrating a v1 save (pre special-stats, no statRolls, no pity)', () => {
  function v1Save(creatures: unknown[]): string {
    return JSON.stringify({ version: 1, collection: creatures });
  }

  it('upgrades an old creature instead of rejecting it, and starts pity at 0', () => {
    const old = {
      id: 'legacy-1',
      speciesId: 'cindret',
      name: 'Cindret',
      tier: 2,
      types: ['ember'],
      stats: { hp: 88, atk: 30, def: 20, spd: 25 },
      parentIds: ['p1', 'p2'],
    };
    const migrated = deserializeCollection(v1Save([old]));
    expect(migrated.mergePity).toBe(0);
    const [creature] = migrated.collection;
    if (!creature) throw new Error('expected one migrated creature');

    expect(creature.id).toBe('legacy-1');
    expect(creature.tier).toBe(2);
    expect(creature.types).toEqual(['ember']);
    expect(creature.parentIds).toEqual(['p1', 'p2']);
    expect(creature.stats.hp).toBe(88);
    expect(creature.stats.atk).toBe(30);
    expect(creature.stats.def).toBe(20);
    expect(creature.stats.spd).toBe(25);
  });

  it('fills in every new stat so the migrated creature is a fully valid current creature', () => {
    const old = {
      id: 'legacy-2',
      speciesId: 'mossling',
      name: 'Mossling',
      tier: 0,
      types: ['bloom'],
      stats: { hp: 50, atk: 9, def: 13, spd: 8 },
      parentIds: [],
    };
    const migrated = deserializeCollection(v1Save([old]));
    const [creature] = migrated.collection;
    if (!creature) throw new Error('expected one migrated creature');
    for (const k of STAT_KEYS) {
      expect(typeof creature.stats[k]).toBe('number');
      expect(typeof creature.statRolls[k]).toBe('number');
    }
  });

  it('a migrated collection re-saves at the current version and round-trips cleanly from then on', () => {
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

describe('migrating a v2 save (current creature shape, no pity counter yet)', () => {
  it('upgrades a v2 collection, defaulting mergePity to 0', () => {
    const collection = generateEggBatch(createRng(4));
    const v2 = JSON.stringify({ version: 2, collection });
    const migrated = deserializeCollection(v2);
    expect(migrated.mergePity).toBe(0);
    expect(migrated.collection).toEqual(collection);
  });

  it('still rejects a v2 save with an invalid creature', () => {
    const v2 = JSON.stringify({ version: 2, collection: [{ broken: true }] });
    expect(() => deserializeCollection(v2)).toThrow(/invalid creature/i);
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
      version: 3,
      collection: [{ ...makeCreature(), stats: undefined }],
      mergePity: 0,
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature missing its statRolls', () => {
    const bad = JSON.stringify({
      version: 3,
      collection: [{ ...makeCreature(), statRolls: undefined }],
      mergePity: 0,
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature with zero types', () => {
    const bad = JSON.stringify({ version: 3, collection: [{ ...makeCreature(), types: [] }], mergePity: 0 });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature with three types (the two-type cap is enforced on load too)', () => {
    const bad = JSON.stringify({
      version: 3,
      collection: [{ ...makeCreature(), types: ['ember', 'tide', 'volt'] }],
      mergePity: 0,
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature whose stats are not finite numbers', () => {
    const bad = JSON.stringify({
      version: 3,
      collection: [{ ...makeCreature(), stats: { ...makeCreature().stats, hp: 'lots' } }],
      mergePity: 0,
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects the whole save if even one creature among many is invalid', () => {
    const bad = JSON.stringify({ version: 3, collection: [makeCreature(), { broken: true }], mergePity: 0 });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a missing mergePity on an otherwise-valid current save', () => {
    const bad = JSON.stringify({ version: 3, collection: [makeCreature()] });
    expect(() => deserializeCollection(bad)).toThrow(/mergePity/i);
  });

  it('rejects a negative or non-integer mergePity', () => {
    const negative = JSON.stringify({ version: 3, collection: [], mergePity: -1 });
    const fractional = JSON.stringify({ version: 3, collection: [], mergePity: 2.5 });
    expect(() => deserializeCollection(negative)).toThrow(/mergePity/i);
    expect(() => deserializeCollection(fractional)).toThrow(/mergePity/i);
  });
});
