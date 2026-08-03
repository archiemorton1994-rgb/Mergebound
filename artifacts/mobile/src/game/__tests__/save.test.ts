/**
 * Tests for save/load (src/game/save.ts): a collection (and the merge pity
 * counter) must survive the round trip to a string and back with no data
 * loss, corrupt data must be rejected loudly instead of silently mangled,
 * and old (v1, v2) saves must be migrated forward instead of wiping the
 * player's collection.
 */

import { describe, expect, it } from 'vitest';
import { economy } from '../content';
import { generateEggBatch } from '../hatch';
import { merge } from '../merge';
import { STAT_KEYS, type Creature } from '../models';
import { createRng } from '../rng';
import {
  deserializeCollection,
  serializeCollection,
  stampFreshSave,
  withDefaults,
  type SaveData,
} from '../save';
import { makeCreature } from './helpers';

/** A complete save holding just these creatures — every other field at its default. */
function saveOf(collection: Creature[], mergePity = 0): SaveData {
  return withDefaults({ collection, mergePity });
}

describe('save and load round trip', () => {
  it('an empty collection with zero pity survives the round trip', () => {
    const data = saveOf([]);
    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });

  it('hatched creatures survive the round trip with every field intact', () => {
    const data = saveOf(generateEggBatch(createRng(21)));
    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });

  it('a merged creature (with parent ids and two types) survives the round trip', () => {
    const rng = createRng(8);
    const a = makeCreature({ tier: 1, types: ['ember', 'tide'] });
    const b = makeCreature({ tier: 1, types: ['volt'] });
    const data = saveOf([merge(a, b, rng)], 3);
    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });

  it('the merge pity counter survives the round trip at any value', () => {
    for (const mergePity of [0, 1, 9, 10, 500]) {
      const data = saveOf([], mergePity);
      expect(deserializeCollection(serializeCollection(data)).mergePity).toBe(mergePity);
    }
  });

  it('a large mixed collection survives the round trip', () => {
    const rng = createRng(99);
    const eggs = [...generateEggBatch(rng), ...generateEggBatch(rng)];
    const first = eggs[0];
    const second = eggs[1];
    if (!first || !second) throw new Error('expected at least two eggs');
    const data = saveOf([...eggs, merge(first, second, rng)], 5);
    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });

  it('always writes the current save version', () => {
    const saved = JSON.parse(serializeCollection(saveOf([]))) as { version: number };
    expect(saved.version).toBe(4);
  });

  it('the wallet, campaign, Binder and onboarding all survive the round trip', () => {
    const data = saveOf(generateEggBatch(createRng(5)), 2);
    data.wallet = { gold: 1234, mergeStones: 56, gems: 7 };
    data.campaign.stages['cinderreach-1'] = {
      bestStars: 2, bestRounds: 4, clears: 3, attemptsToday: 1, attemptsDay: 20000,
    };
    data.campaign.claimedChests.push('cinderreach-boss');
    data.binder = { ...data.binder, name: 'Wren Ashford' };
    data.onboarding = { step: 'complete', seed: 42, seenTips: ['merge-basics'] };
    data.shop.ownedCosmeticIds.push('cloak-of-embers');

    expect(deserializeCollection(serializeCollection(data))).toEqual(data);
  });
});

describe('migrating a v3 save (collection and pity, but no currencies yet)', () => {
  function v3Save(collection: Creature[], mergePity = 0): string {
    return JSON.stringify({ version: 3, collection, mergePity });
  }

  it('keeps every creature and the pity counter exactly as they were', () => {
    const collection = generateEggBatch(createRng(12));
    const migrated = deserializeCollection(v3Save(collection, 7));
    expect(migrated.collection).toEqual(collection);
    expect(migrated.mergePity).toBe(7);
  });

  it('opens with the starting wallet', () => {
    const migrated = deserializeCollection(v3Save(generateEggBatch(createRng(2))));
    expect(migrated.wallet).toEqual(economy.startingWallet);
  });

  it('has no pending idle income — an old save never earned any', () => {
    const migrated = deserializeCollection(v3Save(generateEggBatch(createRng(2))));
    expect(migrated.economy.lastCollectedAt).toBe(0);
    expect(migrated.economy.dayIndex).toBe(-1);
    const stamped = stampFreshSave(migrated, 1_700_000_000_000, 19675);
    expect(stamped.economy.lastCollectedAt).toBe(1_700_000_000_000);
  });

  it('never sends an existing player back to the egg tutorial', () => {
    const migrated = deserializeCollection(v3Save(generateEggBatch(createRng(3))));
    expect(migrated.onboarding.step).toBe('complete');
  });

  it('still gives the tutorial to someone who installed but never hatched', () => {
    const migrated = deserializeCollection(v3Save([]));
    expect(migrated.onboarding.step).toBe('first-egg');
  });

  it('arrives with the player’s perfect-rolled creatures already protected', () => {
    const ordinary = makeCreature({ id: 'ordinary' });
    const perfect = makeCreature({
      id: 'perfect',
      statRolls: { ...makeCreature().statRolls, critChance: 100 },
    });
    const migrated = deserializeCollection(v3Save([ordinary, perfect]));
    expect(migrated.lockedIds).toContain('perfect');
    expect(migrated.lockedIds).not.toContain('ordinary');
  });

  it('gives every migrated save its own campaign record, not a shared one', () => {
    const a = deserializeCollection(v3Save([]));
    const b = deserializeCollection(v3Save([]));
    a.campaign.stages['cinderreach-1'] = {
      bestStars: 3, bestRounds: 2, clears: 1, attemptsToday: 1, attemptsDay: 1,
    };
    expect(Object.keys(b.campaign.stages)).toHaveLength(0);
  });
});

describe('repairing the critical-hit inflation on old saves', () => {
  it('brings an impossibly high critical-hit chance back to what it should have been', () => {
    // What a tier-4 creature actually looked like before the fix: the tier
    // multiplier had been applied to a percentage, so it critted every hit.
    const broken = makeCreature({
      tier: 4,
      speciesId: 'cindret',
      stats: { ...makeCreature().stats, critChance: 291, critDamage: 7529 },
      statRolls: { ...makeCreature().statRolls, critChance: 50, critDamage: 50 },
    });
    const loaded = deserializeCollection(JSON.stringify({
      version: 3, collection: [broken], mergePity: 0,
    }));
    const [fixed] = loaded.collection;
    if (!fixed) throw new Error('expected the creature to survive the repair');

    expect(fixed.stats.critChance).toBeLessThan(100);
    expect(fixed.stats.critChance).toBe(6); // cindret base, neutral roll
    expect(fixed.stats.critDamage).toBe(155);
    // Nothing else about the creature is touched.
    expect(fixed.id).toBe(broken.id);
    expect(fixed.tier).toBe(4);
    expect(fixed.stats.hp).toBe(broken.stats.hp);
    expect(fixed.statRolls).toEqual(broken.statRolls);
  });

  it('leaves a healthy creature completely alone', () => {
    const healthy = generateEggBatch(createRng(31));
    const loaded = deserializeCollection(JSON.stringify({
      version: 3, collection: healthy, mergePity: 0,
    }));
    expect(loaded.collection).toEqual(healthy);
  });

  it('still loads a creature whose species no longer exists', () => {
    const orphan = makeCreature({
      speciesId: 'no-such-species',
      stats: { ...makeCreature().stats, critChance: 9999, critDamage: 99999 },
    });
    const loaded = deserializeCollection(JSON.stringify({
      version: 3, collection: [orphan], mergePity: 0,
    }));
    const [fixed] = loaded.collection;
    if (!fixed) throw new Error('expected the creature to survive');
    expect(fixed.stats.critChance).toBeLessThanOrEqual(100);
    expect(fixed.stats.critDamage).toBeLessThanOrEqual(400);
  });
});

describe('tolerating damage to the parts that are not the collection', () => {
  function v4With(extra: Record<string, unknown>): string {
    const base = withDefaults({ collection: [makeCreature({ id: 'keeper' })], mergePity: 0 });
    return JSON.stringify({ version: 4, ...base, ...extra });
  }

  it('rebuilds a corrupt wallet rather than losing the collection', () => {
    const loaded = deserializeCollection(v4With({ wallet: { gold: 'lots' } }));
    expect(loaded.collection.map((c) => c.id)).toEqual(['keeper']);
    expect(loaded.wallet).toEqual(economy.startingWallet);
  });

  it('rebuilds corrupt onboarding, campaign, Binder and shop state', () => {
    const loaded = deserializeCollection(v4With({
      onboarding: { step: 'not-a-real-step' },
      campaign: 'nonsense',
      binder: { name: 5 },
      shop: 42,
    }));
    expect(loaded.collection.map((c) => c.id)).toEqual(['keeper']);
    expect(loaded.onboarding.step).toBe('complete'); // it has a creature
    expect(loaded.campaign.stages).toEqual({});
    expect(loaded.binder.name).toBe('');
    expect(loaded.shop.ownedCosmeticIds).toEqual([]);
  });

  it('drops a lock pointing at a creature that no longer exists', () => {
    const loaded = deserializeCollection(v4With({ lockedIds: ['keeper', 'long-gone'] }));
    expect(loaded.lockedIds).toEqual(['keeper']);
  });

  it('ignores a campaign stage id this build does not recognise', () => {
    const loaded = deserializeCollection(v4With({
      campaign: {
        stages: {
          'cinderreach-1': { bestStars: 3, bestRounds: 2, clears: 1, attemptsToday: 0, attemptsDay: 1 },
          'stage-from-the-future': { nonsense: true },
        },
        claimedChests: [],
      },
    }));
    expect(Object.keys(loaded.campaign.stages)).toEqual(['cinderreach-1']);
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
