/**
 * Tests for the collection tools (src/game/collection.ts) — the searching,
 * filtering, sorting and locking a player leans on once the grid stops fitting
 * on one screen.
 *
 * The locking tests are the important ones. A merge consumes BOTH parents, so
 * a padlock that fails to hold costs somebody their best creature permanently,
 * with no undo.
 */

import { describe, expect, it } from 'vitest';
import {
  applyAutoLocks,
  bestRoll,
  canMerge,
  creaturePower,
  defaultSortDirection,
  filterCollection,
  isLocked,
  pruneLocks,
  shouldAutoLock,
  sortCollection,
  suggestMergePartners,
  toggleLock,
} from '../collection';
import { creaturePower as creaturePowerFromContent } from '../content';
import { defaultStatRolls, defaultStats, makeCreature } from './helpers';

/** A creature that rolled the best possible value on one stat. */
const perfectRolls = { ...defaultStatRolls, critChance: 100 };

describe('collection: how strong is it', () => {
  it('the collection screen scores a creature’s power exactly the way the rest of the game does', () => {
    // Re-exported rather than reimplemented, so a change to the weighting can
    // never leave the grid sorting by one definition of "stronger" while the
    // rest of the game uses another.
    expect(creaturePower).toBe(creaturePowerFromContent);
  });

  it('a creature is judged by its single best stat roll, not by its average one', () => {
    const spiky = makeCreature({
      statRolls: { ...defaultStatRolls, hp: 3, critChance: 97 },
    });
    const consistent = makeCreature({
      statRolls: {
        hp: 60,
        atk: 60,
        spAtk: 60,
        def: 60,
        spDef: 60,
        spd: 60,
        critChance: 60,
        critDamage: 60,
      },
    });
    expect(bestRoll(spiky)).toBe(97);
    expect(bestRoll(consistent)).toBe(60);
    expect(bestRoll(spiky)).toBeGreaterThan(bestRoll(consistent));
  });
});

describe('collection: protecting creatures from being merged away', () => {
  it('a creature with a perfect roll protects itself automatically', () => {
    const perfect = makeCreature({ statRolls: perfectRolls });
    expect(shouldAutoLock(perfect)).toBe(true);
  });

  it('an ordinary creature is not protected until the player says so', () => {
    expect(shouldAutoLock(makeCreature())).toBe(false);
  });

  it('every perfect creature a player already owns is protected without them lifting a finger', () => {
    const perfect = makeCreature({ statRolls: perfectRolls });
    const ordinary = makeCreature();
    const locked = applyAutoLocks([], [perfect, ordinary]);
    expect(locked).toContain(perfect.id);
    expect(locked).not.toContain(ordinary.id);
  });

  it('a lock pointing at a creature that no longer exists is quietly forgotten', () => {
    const kept = makeCreature();
    const mergedAway = makeCreature();
    expect(pruneLocks([kept.id, mergedAway.id], [kept])).toEqual([kept.id]);
  });

  it('tapping the padlock protects a creature, and tapping it again releases it', () => {
    const creature = makeCreature();
    const afterLock = toggleLock([], creature.id);
    expect(isLocked(afterLock, creature.id)).toBe(true);

    const afterUnlock = toggleLock(afterLock, creature.id);
    expect(isLocked(afterUnlock, creature.id)).toBe(false);
  });

  it('locking one creature leaves every other lock exactly where it was', () => {
    const other = makeCreature();
    const creature = makeCreature();
    const result = toggleLock([other.id], creature.id);
    expect(result).toContain(other.id);
    expect(result).toContain(creature.id);
  });

  it('changing a lock never edits the list the caller handed in', () => {
    const creature = makeCreature();
    const original = [creature.id];
    const result = toggleLock(original, creature.id);
    expect(original).toEqual([creature.id]);
    expect(result).not.toBe(original);
  });
});

describe('collection: choosing a merge partner', () => {
  it('a locked creature is never offered as a merge partner', () => {
    const chosen = makeCreature({ tier: 1 });
    const treasured = makeCreature({ tier: 1 });
    const spare = makeCreature({ tier: 1 });

    const partners = suggestMergePartners(chosen, [treasured, spare], [treasured.id]);

    expect(partners.map((c) => c.id)).toEqual([spare.id]);
  });

  it('only creatures of the same tier are offered, because only those raise the tier', () => {
    const chosen = makeCreature({ tier: 2 });
    const sameTier = makeCreature({ tier: 2 });
    const weaker = makeCreature({ tier: 1 });
    const stronger = makeCreature({ tier: 3 });

    const partners = suggestMergePartners(chosen, [weaker, sameTier, stronger]);

    expect(partners.map((c) => c.id)).toEqual([sameTier.id]);
  });

  it('a creature is never offered as its own merge partner', () => {
    const chosen = makeCreature({ tier: 1 });
    expect(suggestMergePartners(chosen, [chosen])).toEqual([]);
  });

  it('the strongest available partner is offered first', () => {
    const chosen = makeCreature({ tier: 1 });
    const weak = makeCreature({ tier: 1, stats: { ...defaultStats, atk: 5 } });
    const strong = makeCreature({ tier: 1, stats: { ...defaultStats, atk: 90 } });
    const middling = makeCreature({ tier: 1, stats: { ...defaultStats, atk: 40 } });

    const partners = suggestMergePartners(chosen, [weak, strong, middling]);

    expect(partners.map((c) => c.id)).toEqual([strong.id, middling.id, weak.id]);
  });

  it('asking for merge partners never changes the caller’s own list', () => {
    const chosen = makeCreature({ tier: 1 });
    const collection = [makeCreature({ tier: 1 }), makeCreature({ tier: 0 })];
    const snapshot = [...collection];

    suggestMergePartners(chosen, collection);

    expect(collection).toEqual(snapshot);
  });
});

describe('collection: whether two creatures may merge', () => {
  it('two ordinary unlocked creatures are allowed to merge', () => {
    expect(canMerge(makeCreature(), makeCreature())).toEqual({ ok: true });
  });

  it('a creature cannot be merged with itself', () => {
    const creature = makeCreature();
    const result = canMerge(creature, creature);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Pick two different creatures.');
  });

  it('a locked creature refuses to merge, and says so in plain English', () => {
    const locked = makeCreature();
    const spare = makeCreature();

    const first = canMerge(locked, spare, [locked.id]);
    expect(first.ok).toBe(false);
    expect(first.reason).toBe('This one is locked. Unlock it to merge it.');

    // Which side the locked creature is on must not change the answer.
    const second = canMerge(spare, locked, [locked.id]);
    expect(second).toEqual(first);
  });

  it('when both creatures are locked the game asks the player to unlock one', () => {
    const a = makeCreature();
    const b = makeCreature();
    const result = canMerge(a, b, [a.id, b.id]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Both of these are locked. Unlock one to merge it.');
  });

  it('merging across tiers is allowed, because changing a creature’s types is a real reason to do it', () => {
    const low = makeCreature({ tier: 0 });
    const high = makeCreature({ tier: 3 });
    expect(canMerge(low, high).ok).toBe(true);
  });
});

describe('collection: sorting', () => {
  it('sorting by power puts the strongest first and never changes the caller’s own list', () => {
    const weak = makeCreature({ stats: { ...defaultStats, atk: 5 } });
    const strong = makeCreature({ stats: { ...defaultStats, atk: 90 } });
    const middling = makeCreature({ stats: { ...defaultStats, atk: 40 } });
    const collection = [weak, strong, middling];
    const snapshot = [...collection];

    const sorted = sortCollection(collection, 'power');

    expect(sorted.map((c) => c.id)).toEqual([strong.id, middling.id, weak.id]);
    expect(collection).toEqual(snapshot);
    expect(sorted).not.toBe(collection);
  });

  it('sorting by tier puts the highest tier first', () => {
    const t0 = makeCreature({ tier: 0 });
    const t4 = makeCreature({ tier: 4 });
    const t2 = makeCreature({ tier: 2 });
    expect(sortCollection([t0, t4, t2], 'tier').map((c) => c.tier)).toEqual([4, 2, 0]);
  });

  it('sorting by best roll puts the creature closest to a perfect roll first', () => {
    const ordinary = makeCreature();
    const nearlyPerfect = makeCreature({ statRolls: { ...defaultStatRolls, spd: 99 } });
    const promising = makeCreature({ statRolls: { ...defaultStatRolls, spd: 80 } });

    const sorted = sortCollection([ordinary, nearlyPerfect, promising], 'bestRoll');

    expect(sorted.map((c) => c.id)).toEqual([nearlyPerfect.id, promising.id, ordinary.id]);
  });

  it('the newest creature is the one most recently added to the collection', () => {
    const first = makeCreature();
    const second = makeCreature();
    const third = makeCreature();

    const sorted = sortCollection([first, second, third], 'newest');

    expect(sorted.map((c) => c.id)).toEqual([third.id, second.id, first.id]);
  });

  it('sorting by name runs A to Z, and the other sorts run best-first', () => {
    const zephyrl = makeCreature({ name: 'Zephyrl' });
    const cindret = makeCreature({ name: 'Cindret' });
    const mossling = makeCreature({ name: 'Mossling' });

    const sorted = sortCollection([zephyrl, cindret, mossling], 'name');

    expect(sorted.map((c) => c.name)).toEqual(['Cindret', 'Mossling', 'Zephyrl']);
    expect(defaultSortDirection('name')).toBe('asc');
    expect(defaultSortDirection('power')).toBe('desc');
  });

  it('the sort can be turned around, and the weakest comes first when it is', () => {
    const weak = makeCreature({ stats: { ...defaultStats, atk: 5 } });
    const strong = makeCreature({ stats: { ...defaultStats, atk: 90 } });

    const sorted = sortCollection([strong, weak], 'power', 'asc');

    expect(sorted.map((c) => c.id)).toEqual([weak.id, strong.id]);
  });

  it('creatures that tie keep the order they were already in, whichever way the sort runs', () => {
    // Turning the direction arrow around must not reshuffle creatures whose
    // sort value did not change — that reads as the app losing track of things.
    const firstOfPair = makeCreature({ tier: 1 });
    const secondOfPair = makeCreature({ tier: 1 });
    const lower = makeCreature({ tier: 0 });
    const collection = [firstOfPair, secondOfPair, lower];

    const descending = sortCollection(collection, 'tier', 'desc');
    const ascending = sortCollection(collection, 'tier', 'asc');

    expect(descending.map((c) => c.id)).toEqual([firstOfPair.id, secondOfPair.id, lower.id]);
    expect(ascending.map((c) => c.id)).toEqual([lower.id, firstOfPair.id, secondOfPair.id]);
  });

  it('sorting the same collection twice gives exactly the same order', () => {
    const collection = [
      makeCreature({ tier: 2 }),
      makeCreature({ tier: 2 }),
      makeCreature({ tier: 1 }),
      makeCreature({ tier: 2 }),
    ];
    const once = sortCollection(collection, 'tier');
    const twice = sortCollection(collection, 'tier');
    expect(once.map((c) => c.id)).toEqual(twice.map((c) => c.id));
  });
});

describe('collection: filtering and searching', () => {
  it('searching matches a creature by its name', () => {
    const mossling = makeCreature({ name: 'Mossling' });
    const cindret = makeCreature({ name: 'Cindret' });

    const found = filterCollection([mossling, cindret], { search: 'moss' });

    expect(found.map((c) => c.id)).toEqual([mossling.id]);
  });

  it('searching matches a creature by its type', () => {
    const emberOne = makeCreature({ name: 'Cindret', types: ['ember'] });
    const tideOne = makeCreature({ name: 'Cindret', types: ['tide'] });

    const found = filterCollection([emberOne, tideOne], { search: 'tide' });

    expect(found.map((c) => c.id)).toEqual([tideOne.id]);
  });

  it('searching ignores capital letters and stray spaces', () => {
    const mossling = makeCreature({ name: 'Mossling', types: ['bloom'] });
    const collection = [mossling];

    expect(filterCollection(collection, { search: '  MOSSling ' })).toHaveLength(1);
    expect(filterCollection(collection, { search: 'BLOOM' })).toHaveLength(1);
  });

  it('an empty search shows the whole collection', () => {
    const collection = [makeCreature(), makeCreature()];
    expect(filterCollection(collection, { search: '   ' })).toHaveLength(2);
    expect(filterCollection(collection, {})).toHaveLength(2);
  });

  it('filtering by type shows creatures holding any of the chosen types', () => {
    const ember = makeCreature({ types: ['ember'] });
    const tide = makeCreature({ types: ['tide'] });
    const bloom = makeCreature({ types: ['bloom'] });

    const found = filterCollection([ember, tide, bloom], { typeIds: ['ember', 'tide'] });

    expect(found.map((c) => c.id)).toEqual([ember.id, tide.id]);
  });

  it('clearing every type chip shows the whole collection again, not an empty grid', () => {
    const collection = [makeCreature({ types: ['ember'] }), makeCreature({ types: ['tide'] })];
    expect(filterCollection(collection, { typeIds: [] })).toHaveLength(2);
  });

  it('the tier range includes both of its ends', () => {
    const t0 = makeCreature({ tier: 0 });
    const t1 = makeCreature({ tier: 1 });
    const t2 = makeCreature({ tier: 2 });
    const t3 = makeCreature({ tier: 3 });

    const found = filterCollection([t0, t1, t2, t3], { minTier: 1, maxTier: 2 });

    expect(found.map((c) => c.tier)).toEqual([1, 2]);
  });

  it('the locked-only filter shows exactly the creatures the player has protected', () => {
    const treasured = makeCreature();
    const spare = makeCreature();

    const found = filterCollection([treasured, spare], { lockedOnly: true }, [treasured.id]);

    expect(found.map((c) => c.id)).toEqual([treasured.id]);
  });

  it('the dual-type filter hides single-typed creatures', () => {
    const single = makeCreature({ types: ['ember'] });
    const dual = makeCreature({ types: ['ember', 'tide'] });

    const found = filterCollection([single, dual], { dualTypeOnly: true });

    expect(found.map((c) => c.id)).toEqual([dual.id]);
  });

  it('several filters at once narrow the collection down together', () => {
    const wanted = makeCreature({ name: 'Mossling', tier: 2, types: ['bloom', 'tide'] });
    const wrongTier = makeCreature({ name: 'Mossling', tier: 0, types: ['bloom', 'tide'] });
    const wrongType = makeCreature({ name: 'Mossling', tier: 2, types: ['ember', 'volt'] });
    const singleTyped = makeCreature({ name: 'Mossling', tier: 2, types: ['bloom'] });

    const found = filterCollection([wanted, wrongTier, wrongType, singleTyped], {
      search: 'moss',
      typeIds: ['bloom'],
      minTier: 1,
      dualTypeOnly: true,
    });

    expect(found.map((c) => c.id)).toEqual([wanted.id]);
  });

  it('a creature whose type no longer exists still shows up instead of breaking the screen', () => {
    // Types are pure data and can be renamed between builds. A filter that
    // threw would blank the player's whole collection over one odd row.
    const orphan = makeCreature({ name: 'Cindret', types: ['a-type-that-was-removed'] });

    expect(filterCollection([orphan], {})).toHaveLength(1);
    expect(filterCollection([orphan], { search: 'removed' })).toHaveLength(1);
  });

  it('filtering never changes the caller’s own list', () => {
    const collection = [makeCreature({ tier: 0 }), makeCreature({ tier: 3 })];
    const snapshot = [...collection];

    const found = filterCollection(collection, { minTier: 1 });

    expect(collection).toEqual(snapshot);
    expect(found).not.toBe(collection);
  });
});
