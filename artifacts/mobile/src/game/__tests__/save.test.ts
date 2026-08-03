/**
 * Tests for save/load (src/game/save.ts): a collection must survive the
 * round trip to a string and back with no data loss, and corrupt data
 * must be rejected loudly instead of silently mangled.
 */

import { describe, expect, it } from 'vitest';
import { generateEggBatch } from '../hatch';
import { merge } from '../merge';
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

  it('rejects a save file from an unknown version', () => {
    const future = JSON.stringify({ version: 999, collection: [] });
    expect(() => deserializeCollection(future)).toThrow(/version/i);
  });

  it('rejects a creature missing its stats', () => {
    const bad = JSON.stringify({
      version: 1,
      collection: [{ ...makeCreature(), stats: undefined }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature with zero types', () => {
    const bad = JSON.stringify({
      version: 1,
      collection: [{ ...makeCreature(), types: [] }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature with three types (the two-type cap is enforced on load too)', () => {
    const bad = JSON.stringify({
      version: 1,
      collection: [{ ...makeCreature(), types: ['ember', 'tide', 'volt'] }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects a creature whose stats are not finite numbers', () => {
    const bad = JSON.stringify({
      version: 1,
      collection: [{ ...makeCreature(), stats: { hp: 'lots', atk: 1, def: 1, spd: 1 } }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });

  it('rejects the whole save if even one creature among many is invalid', () => {
    const bad = JSON.stringify({
      version: 1,
      collection: [makeCreature(), { broken: true }],
    });
    expect(() => deserializeCollection(bad)).toThrow(/invalid creature/i);
  });
});
