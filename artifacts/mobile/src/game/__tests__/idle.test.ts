/**
 * Tests for idle income (src/game/idle.ts).
 *
 * Two things these are really guarding. First, that only the strongest few
 * creatures earn, so hoarding is worthless and merging pays — that is the whole
 * reason idle income exists. Second, that a tampered clock can never produce
 * anything but gold, and never a negative wallet.
 */

import { describe, expect, it } from 'vitest';
import { cumulativeStatMultiplier, economy } from '../content';
import { collectIdle, idleGoldPerHour, idleRoster, previewIdle } from '../idle';
import { merge } from '../merge';
import { STAT_KEYS, type Creature, type EconomyState, type Stats, type Wallet } from '../models';
import { createRng } from '../rng';
import { defaultStats, makeCreature } from './helpers';

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** An arbitrary fixed moment. Every test below is expressed relative to it. */
const T0 = 1_760_000_000_000;

function economyAt(lastCollectedAt: number): EconomyState {
  // Non-zero daily counters on purpose, so a test can prove idle never touches them.
  return {
    lastCollectedAt,
    dayIndex: 20_370,
    stonesEarnedToday: 12,
    stonesPurchasedToday: 5,
    clockAnomalies: 0,
  };
}

function freshWallet(): Wallet {
  return { gold: 1000, mergeStones: 7, gems: 3 };
}

/**
 * A creature the way a real one at this tier would be: base stats scaled by the
 * tier's true cumulative multiplier. Needed because the roster ranks on stats
 * while the payout scales on tier — a hand-built "tier 2" creature with tier-0
 * stats would rank like a tier-0 and make these tests prove nothing.
 */
function creatureAtTier(id: string, tier: number): Creature {
  const mult = cumulativeStatMultiplier(tier);
  const stats: Stats = { ...defaultStats };
  for (const key of STAT_KEYS) {
    stats[key] = Math.max(1, Math.round(defaultStats[key] * mult));
  }
  return makeCreature({ id, tier, stats });
}

function creatureWithAtk(id: string, atk: number): Creature {
  return makeCreature({ id, stats: { ...defaultStats, atk } });
}

/** goldPerHourPerPowerUnit x the sum of every earner's true tier power. */
function expectedGoldPerHour(tiers: number[]): number {
  return (
    economy.idle.goldPerHourPerPowerUnit *
    tiers.reduce((sum, tier) => sum + cumulativeStatMultiplier(tier), 0)
  );
}

describe('who earns idle income', () => {
  it('only the six strongest creatures earn idle income', () => {
    const collection = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
      creatureWithAtk(`c${n}`, 10 + n),
    );

    const roster = idleRoster(collection);

    expect(roster).toHaveLength(economy.idle.rosterSize);
    expect(roster.map((c) => c.id)).toEqual(['c10', 'c9', 'c8', 'c7', 'c6', 'c5']);
  });

  it('a collection smaller than the roster puts every creature to work', () => {
    const collection = [creatureAtTier('a', 0), creatureAtTier('b', 0), creatureAtTier('c', 0)];
    expect(idleRoster(collection).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('a player with no creatures has nobody earning', () => {
    expect(idleRoster([])).toEqual([]);
  });

  it('creatures of identical strength always earn in the same order, so the roster never flickers', () => {
    const ids = ['f', 'c', 'j', 'a', 'h', 'b', 'g', 'd', 'i', 'e'];
    const collection = ids.map((id) => creatureAtTier(id, 0));

    const roster = idleRoster(collection).map((c) => c.id);

    // Every one of these is exactly as strong as every other, so the tie-break
    // alone decides — and it must give the same answer every single time.
    expect(roster).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(idleRoster(collection).map((c) => c.id)).toEqual(roster);
    expect(idleRoster([...collection].reverse()).map((c) => c.id)).toEqual(roster);
  });

  it('working out who is earning never reorders the player collection', () => {
    const collection = [5, 1, 4, 2, 3].map((n) => creatureWithAtk(`c${n}`, 10 + n));
    const before = collection.map((c) => c.id);

    idleRoster(collection);

    expect(collection.map((c) => c.id)).toEqual(before);
  });
});

describe('how much idle income a collection earns per hour', () => {
  it('a player with no creatures earns nothing', () => {
    expect(idleGoldPerHour([])).toBe(0);
  });

  it('six tier-one creatures earn a hundred and eight gold an hour, exactly as economy.json promises', () => {
    const collection = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => creatureAtTier(id, 1));
    expect(idleGoldPerHour(collection)).toBeCloseTo(108, 9);
  });

  it('a hoard of weak creatures adds nothing to hourly income', () => {
    const earners = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => creatureAtTier(id, 2));
    const hoard = Array.from({ length: 20 }, (_, i) => creatureAtTier(`weak-${i}`, 0));

    expect(idleGoldPerHour([...earners, ...hoard])).toBeCloseTo(idleGoldPerHour(earners), 9);
  });

  it('merging two creatures into a stronger one raises hourly income', () => {
    const collection = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => creatureAtTier(id, 1));
    const before = idleGoldPerHour(collection);

    const [first, second, ...rest] = collection;
    if (!first || !second) throw new Error('expected two creatures to merge');
    const merged = merge(first, second, createRng(7));
    const after = idleGoldPerHour([merged, ...rest]);

    expect(merged.tier).toBe(2);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(expectedGoldPerHour([2, 1, 1, 1, 1]), 9);
  });

  it('merging raises hourly income even when it promotes a spare creature off the bench', () => {
    const collection = Array.from({ length: 8 }, (_, i) => creatureAtTier(`c${i}`, 0));
    const before = idleGoldPerHour(collection);

    const [first, second, ...rest] = collection;
    if (!first || !second) throw new Error('expected two creatures to merge');
    const merged = merge(first, second, createRng(11));
    const after = idleGoldPerHour([merged, ...rest]);

    expect(after).toBeGreaterThan(before);
    // The new tier-1 earns, and the seventh creature that was earning nothing
    // before now fills the slot the merge freed up.
    expect(after).toBeCloseTo(expectedGoldPerHour([1, 0, 0, 0, 0, 0]), 9);
  });
});

describe('previewing what is waiting to be collected', () => {
  const collection = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => creatureAtTier(id, 1));
  const capMs = economy.idle.offlineCapHours * HOUR;

  it('two hours away banks two hours of gold', () => {
    const preview = previewIdle(economyAt(T0), collection, T0 + 2 * HOUR);

    expect(preview.goldReady).toBe(Math.floor(idleGoldPerHour(collection) * 2));
    expect(preview.msElapsed).toBe(2 * HOUR);
    expect(preview.cappedOut).toBe(false);
  });

  it('being away longer than the cap pays exactly the cap and no more', () => {
    const atCap = previewIdle(economyAt(T0), collection, T0 + capMs);
    const wayPastCap = previewIdle(economyAt(T0), collection, T0 + 40 * HOUR);

    expect(atCap.goldReady).toBe(
      Math.floor(idleGoldPerHour(collection) * economy.idle.offlineCapHours),
    );
    expect(wayPastCap.goldReady).toBe(atCap.goldReady);
    expect(wayPastCap.msElapsed).toBe(capMs);
    expect(wayPastCap.cappedOut).toBe(true);
    expect(wayPastCap.msUntilCap).toBe(0);
  });

  it('the wait until the cap shrinks by exactly the time that passes', () => {
    const preview = previewIdle(economyAt(T0), collection, T0 + 3 * HOUR);
    expect(preview.msUntilCap).toBe(capMs - 3 * HOUR);
  });

  it('a few seconds away is not worth collecting, so the game offers nothing', () => {
    const preview = previewIdle(economyAt(T0), collection, T0 + 30_000);

    expect(preview.goldReady).toBe(0);
    // The time is still counted — it is only the offer that is withheld.
    expect(preview.msElapsed).toBe(30_000);
  });

  it('one full minute away is worth collecting', () => {
    const preview = previewIdle(
      economyAt(T0),
      collection,
      T0 + economy.idle.minCollectMinutes * MINUTE,
    );
    expect(preview.goldReady).toBeGreaterThan(0);
  });

  it('setting the clock backwards offers nothing', () => {
    const preview = previewIdle(economyAt(T0), collection, T0 - 5 * HOUR);

    expect(preview.goldReady).toBe(0);
    expect(preview.msElapsed).toBe(0);
  });

  it('a save that has never recorded a collection time offers nothing', () => {
    const neverStamped = { ...economyAt(0) };
    const preview = previewIdle(neverStamped, collection, T0);

    expect(preview.goldReady).toBe(0);
    expect(preview.msElapsed).toBe(0);
  });

  it('a player with no creatures is offered nothing however long they were away', () => {
    expect(previewIdle(economyAt(T0), [], T0 + 40 * HOUR).goldReady).toBe(0);
  });

  it('looking at what is waiting never changes anything', () => {
    const state = economyAt(T0);
    const snapshot = { ...state };

    previewIdle(state, collection, T0 + 4 * HOUR);

    expect(state).toEqual(snapshot);
  });
});

describe('collecting idle income', () => {
  const collection = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => creatureAtTier(id, 1));

  it('collecting hands over exactly the gold the preview promised', () => {
    const state = economyAt(T0);
    const wallet = freshWallet();
    const promised = previewIdle(state, collection, T0 + 2 * HOUR).goldReady;

    const result = collectIdle(state, wallet, collection, T0 + 2 * HOUR);

    expect(result.goldCollected).toBe(promised);
    expect(result.wallet.gold).toBe(wallet.gold + promised);
    expect(result.economy.lastCollectedAt).toBe(T0 + 2 * HOUR);
  });

  it('collecting twice in a row pays nothing the second time', () => {
    const first = collectIdle(economyAt(T0), freshWallet(), collection, T0 + 5 * HOUR);
    const second = collectIdle(first.economy, first.wallet, collection, T0 + 5 * HOUR);

    expect(first.goldCollected).toBeGreaterThan(0);
    expect(second.goldCollected).toBe(0);
    expect(second.wallet).toEqual(first.wallet);
  });

  it('idle income never pays merge stones or gems', () => {
    const wallet = freshWallet();
    const result = collectIdle(economyAt(T0), wallet, collection, T0 + 40 * HOUR);

    expect(result.goldCollected).toBeGreaterThan(0);
    expect(result.wallet.mergeStones).toBe(wallet.mergeStones);
    expect(result.wallet.gems).toBe(wallet.gems);
  });

  it('collecting never touches the day counter or the daily merge stone allowances', () => {
    const state = economyAt(T0);
    const result = collectIdle(state, freshWallet(), collection, T0 + 3 * HOUR);

    expect(result.economy.dayIndex).toBe(state.dayIndex);
    expect(result.economy.stonesEarnedToday).toBe(state.stonesEarnedToday);
    expect(result.economy.stonesPurchasedToday).toBe(state.stonesPurchasedToday);
  });

  it('setting the clock backwards pays nothing and never reduces the wallet', () => {
    const wallet = freshWallet();
    const result = collectIdle(economyAt(T0), wallet, collection, T0 - 100 * HOUR);

    expect(result.goldCollected).toBe(0);
    expect(result.wallet).toEqual(wallet);
    expect(result.wallet.gold).toBeGreaterThanOrEqual(wallet.gold);
  });

  it('a clock corrected backwards starts earning again instead of locking the player out', () => {
    const wallet = freshWallet();
    const wound = collectIdle(economyAt(T0), wallet, collection, T0 - 100 * HOUR);

    // Nothing was paid, but the clock is re-anchored to the corrected time, so
    // an hour later the player earns an hour's worth rather than nothing.
    expect(wound.economy.lastCollectedAt).toBe(T0 - 100 * HOUR);
    const later = collectIdle(wound.economy, wound.wallet, collection, T0 - 99 * HOUR);
    expect(later.goldCollected).toBe(Math.floor(idleGoldPerHour(collection)));
  });

  it('a wait too short to be worth collecting does not throw away the time already banked', () => {
    const state = economyAt(T0);
    const wallet = freshWallet();

    const tooSoon = collectIdle(state, wallet, collection, T0 + 30_000);
    expect(tooSoon.goldCollected).toBe(0);
    expect(tooSoon.economy.lastCollectedAt).toBe(T0);

    // The full hour is still there to be collected afterwards.
    const later = collectIdle(tooSoon.economy, tooSoon.wallet, collection, T0 + HOUR);
    expect(later.goldCollected).toBe(Math.floor(idleGoldPerHour(collection)));
  });

  it('time past the cap is forfeited rather than banked for later', () => {
    const capped = collectIdle(economyAt(T0), freshWallet(), collection, T0 + 40 * HOUR);
    const anHourLater = collectIdle(capped.economy, capped.wallet, collection, T0 + 41 * HOUR);

    expect(capped.goldCollected).toBe(
      Math.floor(idleGoldPerHour(collection) * economy.idle.offlineCapHours),
    );
    expect(anHourLater.goldCollected).toBe(Math.floor(idleGoldPerHour(collection)));
  });

  it('a player with no creatures collects nothing however long they were away', () => {
    const wallet = freshWallet();
    const result = collectIdle(economyAt(T0), wallet, [], T0 + 40 * HOUR);

    expect(result.goldCollected).toBe(0);
    expect(result.wallet).toEqual(wallet);
  });
});
