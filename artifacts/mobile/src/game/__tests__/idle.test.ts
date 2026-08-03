/**
 * Tests for idle income (src/game/idle.ts).
 *
 * Two things these are really guarding. First, that only the strongest few
 * creatures earn, so hoarding is worthless and merging pays — that is the whole
 * reason idle income exists. Second, that a tampered clock can never produce
 * anything but gold, and never a negative wallet.
 */

import { describe, expect, it } from 'vitest';
import { balance, creaturePower, cumulativeStatMultiplier, economy } from '../content';
import { stonePriceAt } from '../economy';
import { hatchEgg } from '../hatch';
import { collectIdle, idleGoldPerHour, idleRoster, previewIdle, tierEarning } from '../idle';
import { merge } from '../merge';
import { STAT_KEYS, type Creature, type EconomyState, type Stats, type Wallet } from '../models';
import { createRng } from '../rng';
import { defaultStats, makeCreature } from './helpers';

describe('merging always raises idle income', () => {
  // This is the property idle income exists to create. It was broken once:
  // payouts scaled on cumulativeStatMultiplier, whose first step is 1.5, so two
  // tier-0 creatures (1.0 + 1.0) were worth more than the tier-1 they merged
  // into. A brand-new player with six or fewer creatures watched their income
  // fall for doing the one thing the game is about.
  it('one creature always earns more than the two it was merged from', () => {
    for (let tier = 0; tier <= 8; tier++) {
      const twoBelow = tierEarning(tier) * 2;
      const oneAbove = tierEarning(tier + 1);
      expect(oneAbove, `merging two tier-${tier} creatures must not lose income`).toBeGreaterThan(
        twoBelow,
      );
    }
  });

  it('a creature from a hand-edited save with a nonsense tier still earns something sane', () => {
    for (const tier of [-1, -100, NaN, Infinity, -Infinity]) {
      expect(tierEarning(tier), `tier ${tier}`).toBe(1);
    }
  });

  it('merging never lowers income, at every tier and every collection size', () => {
    // The two older merge tests each happened to sit in the one region where
    // the old arithmetic did not fail: one used six tier-1s, the other eight
    // tier-0s where a benched creature covered the loss. This walks the whole
    // grid — every collection size from a bare pair up to comfortably past the
    // roster, at every tier a player can realistically reach — using the real
    // merge() rather than hand-built creatures.
    for (let tier = 0; tier <= 5; tier++) {
      for (let size = 2; size <= 10; size++) {
        const collection = Array.from({ length: size }, (_, i) =>
          creatureAtTier(`t${tier}-${i}`, tier),
        );
        const before = idleGoldPerHour(collection);

        const [first, second, ...rest] = collection;
        if (!first || !second) throw new Error('expected two creatures to merge');
        const merged = merge(first, second, createRng(3));
        const after = idleGoldPerHour([merged, ...rest]);

        expect(merged.tier).toBe(tier + 1);
        expect(after, `tier ${tier}, collection of ${size}`).toBeGreaterThan(before);
      }
    }
  });

  it('the very first merge a brand-new player makes raises their income', () => {
    // Exactly what a new player is holding: the tutorial creature plus one
    // batch of eggs. This is the collection size the old arithmetic hurt most.
    const collection = Array.from({ length: 1 + balance.eggsPerBatch }, (_, i) =>
      creatureAtTier(`starter-${i}`, 0),
    );
    const before = idleGoldPerHour(collection);

    const [first, second, ...rest] = collection;
    if (!first || !second) throw new Error('expected two creatures to merge');
    const after = idleGoldPerHour([merge(first, second, createRng(3)), ...rest]);

    expect(after).toBeGreaterThan(before);
  });

  it('eight hours offline is worth a similar pile of merge stones at every tier', () => {
    // Idle income has to keep pace with the thing gold actually buys. Stone
    // prices scale on the honest stat curve, so an idle curve that grows slower
    // would quietly make idle income worthless at high tier — eight hours would
    // go from about nine stones at tier 0 to less than one at tier 6. This is
    // the promise economy.json's idle comment makes, and it is the reason the
    // earning curve is a FLOOR over cumulativeStatMultiplier rather than a
    // replacement for it.
    for (let tier = 0; tier <= 6; tier++) {
      const collection = Array.from({ length: economy.idle.rosterSize }, (_, i) =>
        creatureAtTier(`t${tier}-${i}`, tier),
      );
      const goldFromEightHours = idleGoldPerHour(collection) * economy.idle.offlineCapHours;

      let stones = 0;
      let spent = 0;
      while (spent + stonePriceAt(tier, stones) <= goldFromEightHours) {
        spent += stonePriceAt(tier, stones);
        stones += 1;
      }

      expect(stones, `tier ${tier} banked ${stones} stones`).toBeGreaterThanOrEqual(7);
      expect(stones, `tier ${tier} banked ${stones} stones`).toBeLessThanOrEqual(11);
    }
  });
});

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

/**
 * A tier-1 creature straight out of the real hatch/merge pipeline whose display
 * power lands BELOW a well-rolled tier-0's. Nothing here is hand-built: hatch
 * honestly, merge two tier-0s into a tier-1, then cross-tier merge that with a
 * third tier-0 — the type-reroll move the design explicitly endorses. A
 * cross-tier merge gets no tier multiplier, so averaging with the weaker parent
 * drags the result's stats down into tier-0 territory while its TIER, and
 * therefore its earning rate, stays at 1.
 */
function weakTier1FromRealMerges(): Creature {
  const rng = createRng(12345);
  const pool = Array.from({ length: 300 }, () => hatchEgg(rng));
  let weakest: Creature | undefined;
  for (let i = 0; i + 2 < pool.length; i += 3) {
    const a = pool[i];
    const b = pool[i + 1];
    const c = pool[i + 2];
    if (!a || !b || !c) continue;
    const rerolled = merge(merge(a, b, rng), c, rng);
    if (!weakest || creaturePower(rerolled) < creaturePower(weakest)) weakest = rerolled;
  }
  if (!weakest) throw new Error('expected the merge pipeline to produce a tier-1');
  return weakest;
}

/** The best-rolled tier-0s out of a big batch of honest hatches. */
function luckyTier0s(count: number): Creature[] {
  const rng = createRng(777);
  return Array.from({ length: 300 }, () => hatchEgg(rng))
    .sort((a, b) => creaturePower(b) - creaturePower(a))
    .slice(0, count);
}

/**
 * goldPerHourPerPowerUnit x the sum of every earner's tier earning rate.
 *
 * Idle deliberately uses its own curve rather than cumulativeStatMultiplier —
 * see tierEarning and economy.json for why merging would otherwise LOSE a new
 * player income.
 */
function expectedGoldPerHour(tiers: number[]): number {
  return (
    economy.idle.goldPerHourPerPowerUnit * tiers.reduce((sum, tier) => sum + tierEarning(tier), 0)
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

  it('a higher-tier creature always earns before a lower-tier one, however badly its stats rolled', () => {
    // A tier-1 that was cross-tier merged to change its types — a move the
    // design explicitly endorses — comes out with diluted stats and can score
    // BELOW a lucky tier-0 on the display power number. It still earns more
    // than twice as much, so it must never be the one left on the bench.
    const weak = weakTier1FromRealMerges();
    const lucky = luckyTier0s(economy.idle.rosterSize);
    const strongestTier0 = lucky[0];
    if (!strongestTier0) throw new Error('expected some hatched creatures');

    expect(creaturePower(weak)).toBeLessThan(creaturePower(strongestTier0));

    const roster = idleRoster([...lucky, weak]);
    expect(roster[0]).toBe(weak);
  });

  it('hatching another creature can never lower idle income', () => {
    // The roster used to be chosen by one number and paid by another, so a free
    // egg could push the player's biggest earner off the roster and cost them
    // gold per hour. Adding a creature must be weakly good news, always.
    const weak = weakTier1FromRealMerges();
    const collection: Creature[] = [weak, ...luckyTier0s(economy.idle.rosterSize - 1)];

    let income = idleGoldPerHour(collection);
    const rng = createRng(4242);
    for (let i = 0; i < 40; i++) {
      collection.push(hatchEgg(rng));
      const next = idleGoldPerHour(collection);
      expect(next, `after hatching creature ${i + 1}`).toBeGreaterThanOrEqual(income);
      income = next;
    }
  });
});

describe('how much idle income a collection earns per hour', () => {
  it('a player with no creatures earns nothing', () => {
    expect(idleGoldPerHour([])).toBe(0);
  });

  it('six tier-one creatures earn what economy.json promises they will', () => {
    const collection = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => creatureAtTier(id, 1));
    // 6 earners x 2.2 (tierEarningBase^1) x 12 gold per power unit.
    expect(idleGoldPerHour(collection)).toBeCloseTo(158.4, 9);
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
    // The timer restarts from now, give or take the fraction of a single gold
    // coin that could not be handed over yet — that scrap of time stays banked
    // rather than being thrown away. See the collect-often test below.
    const oneGoldOfTime = HOUR / idleGoldPerHour(collection);
    expect(result.economy.lastCollectedAt).toBeLessThanOrEqual(T0 + 2 * HOUR);
    expect(result.economy.lastCollectedAt).toBeGreaterThan(T0 + 2 * HOUR - oneGoldOfTime);
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

  it('collecting every minute for an hour pays the same as collecting once at the end', () => {
    // Gold is handed over in whole coins, and the leftover fraction used to be
    // thrown away on every single collect. Sixty one-minute collects across an
    // hour paid 60 gold where one collect paid 158 — a 62% penalty for the
    // crime of opening the app often. A player should never have to think about
    // when to tap the button.
    const once = collectIdle(economyAt(T0), freshWallet(), collection, T0 + HOUR);

    let state = economyAt(T0);
    let wallet = freshWallet();
    let dribbled = 0;
    for (let minute = 1; minute <= 60; minute++) {
      const step = collectIdle(state, wallet, collection, T0 + minute * MINUTE);
      state = step.economy;
      wallet = step.wallet;
      dribbled += step.goldCollected;
    }

    expect(once.goldCollected).toBeGreaterThan(0);
    expect(dribbled).toBe(once.goldCollected);
  });

  it('collecting constantly never pays more than simply waiting', () => {
    // The other direction of the same rule: carrying the leftover forward must
    // not become a way to mint gold out of frequent taps.
    const once = collectIdle(economyAt(T0), freshWallet(), collection, T0 + 4 * HOUR);

    let state = economyAt(T0);
    let wallet = freshWallet();
    let dribbled = 0;
    for (let second = 1; second <= 4 * 3600; second++) {
      const step = collectIdle(state, wallet, collection, T0 + second * 1000);
      state = step.economy;
      wallet = step.wallet;
      dribbled += step.goldCollected;
    }

    expect(dribbled).toBeLessThanOrEqual(once.goldCollected);
  });

  it('the scrap of time a collect could not pay for is kept, not thrown away', () => {
    const first = collectIdle(economyAt(T0), freshWallet(), collection, T0 + 90 * MINUTE);
    const second = collectIdle(first.economy, first.wallet, collection, T0 + 3 * HOUR);

    // Three hours of income, paid across two collects, with nothing lost in
    // between beyond the part-coin still owed at the end.
    const wholeStretch = Math.floor(idleGoldPerHour(collection) * 3);
    expect(first.goldCollected + second.goldCollected).toBe(wholeStretch);
  });
});

