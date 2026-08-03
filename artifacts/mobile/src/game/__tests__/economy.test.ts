/**
 * Tests for the currency rules (src/game/economy.ts).
 *
 * Every expected number is read back out of economy.json through content.ts,
 * never typed in here — otherwise retuning a price would mean editing the
 * balance file AND hunting down the tests that had quietly copied it.
 *
 * The four promises these tests exist to protect:
 *   - a player with an empty wallet can always merge (tier 0 is free forever);
 *   - free merges cannot move the perfect-roll countdown, so nobody can farm
 *     their way to a guaranteed perfect roll and no purchase can accelerate it;
 *   - no amount of gold raises the daily merge stone ceiling;
 *   - a wallet can never go negative.
 */

import { describe, expect, it } from 'vitest';
import { advanceDay } from '../clock';
import { cumulativeStatMultiplier, economy } from '../content';
import {
  buyMergeStones,
  canAfford,
  creditEarnedStones,
  earn,
  highestTier,
  mergeAdvancesPity,
  mergeStoneCost,
  spend,
  stoneBundlePrice,
  stonePriceAt,
  stonesAffordable,
} from '../economy';
import type { EconomyState, Wallet } from '../models';
import { makeCreature } from './helpers';

const MS_PER_DAY = 86_400_000;

function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
  return { gold: 1000, mergeStones: 10, gems: 25, ...overrides };
}

function makeEconomyState(overrides: Partial<EconomyState> = {}): EconomyState {
  return {
    lastCollectedAt: 0,
    dayIndex: 100,
    stonesEarnedToday: 0,
    stonesPurchasedToday: 0,
    clockAnomalies: 0,
    ...overrides,
  };
}

/** Gold nobody could ever actually have — used to prove a cap is a cap, not a price. */
const UNLIMITED_GOLD = 1_000_000_000;

describe('economy: what a merge costs', () => {
  it('a brand-new player can always merge two starter creatures for free', () => {
    const a = makeCreature({ tier: 0 });
    const b = makeCreature({ tier: 0 });
    expect(mergeStoneCost(a, b)).toBe(0);
  });

  it('an empty wallet can still afford a merge between two starter creatures', () => {
    const brokeWallet = makeWallet({ gold: 0, mergeStones: 0, gems: 0 });
    const cost = mergeStoneCost(makeCreature({ tier: 0 }), makeCreature({ tier: 0 }));
    expect(canAfford(brokeWallet, { mergeStones: cost })).toBe(true);
  });

  it('a merge is priced by the tier of its stronger parent', () => {
    const table = economy.merge.stoneCostByInputTier;
    for (let tier = 0; tier < table.length; tier++) {
      const a = makeCreature({ tier });
      const b = makeCreature({ tier });
      expect(mergeStoneCost(a, b)).toBe(table[tier]);
    }
  });

  it('the price does not depend on which parent is named first', () => {
    const weak = makeCreature({ tier: 1 });
    const strong = makeCreature({ tier: 4 });
    expect(mergeStoneCost(weak, strong)).toBe(mergeStoneCost(strong, weak));
  });

  it('a cross-tier merge costs less than a same-tier merge, from tier two upward', () => {
    for (let tier = 2; tier < economy.merge.stoneCostByInputTier.length; tier++) {
      const strong = makeCreature({ tier });
      const weaker = makeCreature({ tier: tier - 1 });
      const sameTier = mergeStoneCost(strong, makeCreature({ tier }));
      expect(mergeStoneCost(strong, weaker), `tier ${tier}`).toBeLessThan(sameTier);
    }
  });

  it('a cross-tier merge never costs more than a same-tier merge at any tier', () => {
    // Tier 1 is the one place where the half-price discount disappears: half a
    // stone rounds back up to a whole one. That is on purpose — a free
    // cross-tier merge would slip past the perfect-roll countdown.
    for (let tier = 1; tier < economy.merge.stoneCostByInputTier.length; tier++) {
      const strong = makeCreature({ tier });
      const weaker = makeCreature({ tier: tier - 1 });
      const sameTier = mergeStoneCost(strong, makeCreature({ tier }));
      expect(mergeStoneCost(strong, weaker), `tier ${tier}`).toBeLessThanOrEqual(sameTier);
    }
  });

  it('a cross-tier merge is rounded up, so it never becomes accidentally free', () => {
    // Half of the tier-1 price rounds down to nothing; rounding up is what
    // stops a cheap cross-tier merge slipping past the pity rule as "free".
    const strong = makeCreature({ tier: 1 });
    const starter = makeCreature({ tier: 0 });
    expect(mergeStoneCost(strong, starter)).toBeGreaterThan(0);
  });

  it('merging above the top of the price table costs the same as the top of the table', () => {
    const table = economy.merge.stoneCostByInputTier;
    const topTier = table.length - 1;
    const topPrice = mergeStoneCost(makeCreature({ tier: topTier }), makeCreature({ tier: topTier }));
    const beyond = makeCreature({ tier: topTier + 3 });
    expect(mergeStoneCost(beyond, makeCreature({ tier: topTier + 3 }))).toBe(topPrice);
  });
});

describe('economy: which merges may move the perfect-roll countdown', () => {
  it('a free merge between two starter creatures does not move the countdown', () => {
    expect(mergeAdvancesPity(makeCreature({ tier: 0 }), makeCreature({ tier: 0 }))).toBe(false);
  });

  it('a merge that costs stones does move the countdown', () => {
    expect(mergeAdvancesPity(makeCreature({ tier: 1 }), makeCreature({ tier: 1 }))).toBe(true);
    expect(mergeAdvancesPity(makeCreature({ tier: 3 }), makeCreature({ tier: 1 }))).toBe(true);
  });

  it('a merge moves the countdown if and only if it was paid for, at every tier', () => {
    for (let left = 0; left <= 9; left++) {
      for (let right = 0; right <= 9; right++) {
        const a = makeCreature({ tier: left });
        const b = makeCreature({ tier: right });
        expect(mergeAdvancesPity(a, b)).toBe(mergeStoneCost(a, b) > 0);
      }
    }
  });

  it('the only merge in the whole game that is free is one between two starter creatures', () => {
    const free: string[] = [];
    for (let left = 0; left <= 9; left++) {
      for (let right = 0; right <= 9; right++) {
        if (mergeStoneCost(makeCreature({ tier: left }), makeCreature({ tier: right })) === 0) {
          free.push(`${left}+${right}`);
        }
      }
    }
    expect(free).toEqual(['0+0']);
  });
});

describe('economy: paying and being paid', () => {
  it('a wallet holding exactly the price can afford it', () => {
    const wallet = makeWallet({ gold: 300, mergeStones: 4 });
    expect(canAfford(wallet, { gold: 300, mergeStones: 4 })).toBe(true);
  });

  it('a wallet one coin short cannot afford it', () => {
    const wallet = makeWallet({ gold: 299 });
    expect(canAfford(wallet, { gold: 300 })).toBe(false);
  });

  it('a price that names no currency at all is always affordable', () => {
    expect(canAfford(makeWallet({ gold: 0, mergeStones: 0, gems: 0 }), {})).toBe(true);
  });

  it('spending more than you have is refused rather than going negative', () => {
    const wallet = makeWallet({ gold: 50 });
    expect(() => spend(wallet, { gold: 51 })).toThrow();
  });

  it('a refused payment leaves the original wallet exactly as it was', () => {
    const wallet = makeWallet({ gold: 50, mergeStones: 3, gems: 1 });
    expect(() => spend(wallet, { gold: 500 })).toThrow();
    expect(wallet).toEqual({ gold: 50, mergeStones: 3, gems: 1 });
  });

  it('paying takes only the currencies the price actually names', () => {
    const wallet = makeWallet({ gold: 500, mergeStones: 8, gems: 25 });
    expect(spend(wallet, { mergeStones: 3 })).toEqual({ gold: 500, mergeStones: 5, gems: 25 });
  });

  it('being paid adds to the wallet without touching the other currencies', () => {
    const wallet = makeWallet({ gold: 500, mergeStones: 8, gems: 25 });
    expect(earn(wallet, { gold: 120 })).toEqual({ gold: 620, mergeStones: 8, gems: 25 });
  });

  it('paying returns a new wallet instead of editing the one it was given', () => {
    const wallet = makeWallet({ gold: 500 });
    const after = spend(wallet, { gold: 100 });
    expect(wallet.gold).toBe(500);
    expect(after.gold).toBe(400);
  });

  it('money cannot be created by charging a negative price', () => {
    const wallet = makeWallet({ gold: 100 });
    expect(() => spend(wallet, { gold: -500 })).toThrow();
    expect(() => earn(wallet, { gold: -500 })).toThrow();
    expect(() => canAfford(wallet, { gold: -500 })).toThrow();
  });
});

describe('economy: how strong a collection counts as', () => {
  it('a player with no creatures counts as tier zero', () => {
    expect(highestTier([])).toBe(0);
  });

  it('the collection is judged by its best creature, not its newest', () => {
    const collection = [
      makeCreature({ tier: 4 }),
      makeCreature({ tier: 1 }),
      makeCreature({ tier: 0 }),
    ];
    expect(highestTier(collection)).toBe(4);
  });
});

describe('economy: the price of a merge stone', () => {
  it('the first merge stone of the day costs the base price to a brand-new player', () => {
    expect(stonePriceAt(0, 0)).toBe(Math.round(economy.exchange.baseGoldPerStone));
  });

  it('each merge stone bought today costs more than the one before it', () => {
    let previous = stonePriceAt(0, 0);
    for (let bought = 1; bought < economy.dailyCaps.stonesPurchased; bought++) {
      const price = stonePriceAt(0, bought);
      expect(price, `stone ${bought + 1} should cost more than stone ${bought}`).toBeGreaterThan(previous);
      previous = price;
    }
  });

  it('the price of a merge stone resets to the cheapest when a new day begins', () => {
    const midDay = makeEconomyState({ dayIndex: 100, stonesPurchasedToday: 12 });
    const pricedNow = stonePriceAt(0, midDay.stonesPurchasedToday);
    expect(pricedNow).toBeGreaterThan(stonePriceAt(0, 0));

    const tomorrow = advanceDay(midDay, 101 * MS_PER_DAY, 0);
    expect(tomorrow.newDay).toBe(true);
    expect(stonePriceAt(0, tomorrow.economy.stonesPurchasedToday)).toBe(stonePriceAt(0, 0));
  });

  it('a stronger collection pays more gold for the same merge stone', () => {
    expect(stonePriceAt(3, 0)).toBeGreaterThan(stonePriceAt(0, 0));
    expect(stonePriceAt(3, 0)).toBe(
      Math.round(economy.exchange.baseGoldPerStone * cumulativeStatMultiplier(3)),
    );
  });

  it('a merge stone always costs at least one gold', () => {
    expect(stonePriceAt(0, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('economy: how many stones gold will stretch to', () => {
  it('no gold buys no merge stones', () => {
    expect(stonesAffordable(0, 0, 0, economy.dailyCaps.stonesPurchased)).toBe(0);
  });

  it('gold covering exactly three stones buys three, and gold one short buys two', () => {
    const three = stonePriceAt(0, 0) + stonePriceAt(0, 1) + stonePriceAt(0, 2);
    expect(stonesAffordable(three, 0, 0, 10)).toBe(3);
    expect(stonesAffordable(three - 1, 0, 0, 10)).toBe(2);
  });

  it('a player who already bought today starts from the escalated price', () => {
    const firstTwoFresh = stonePriceAt(0, 0) + stonePriceAt(0, 1);
    // The same gold buys fewer stones later in the day, because the escalator
    // has already climbed — that is the whole point of it.
    expect(stonesAffordable(firstTwoFresh, 0, 0, 10)).toBe(2);
    expect(stonesAffordable(firstTwoFresh, 0, 20, 10)).toBeLessThan(2);
  });

  it('the daily allowance limits what gold can buy, however much gold there is', () => {
    expect(stonesAffordable(UNLIMITED_GOLD, 0, 0, 4)).toBe(4);
    expect(stonesAffordable(UNLIMITED_GOLD, 0, 0, 0)).toBe(0);
  });

  it('a bundle of stones is priced by the same escalator as buying them one at a time', () => {
    const oneAtATime = stonePriceAt(0, 0) + stonePriceAt(0, 1) + stonePriceAt(0, 2);
    expect(stoneBundlePrice(3, 0, 0)).toBe(oneAtATime);
    expect(stoneBundlePrice(0, 0, 0)).toBe(0);
  });
});

describe('economy: buying merge stones with gold', () => {
  it('buying merge stones moves gold out of the wallet and stones into it', () => {
    const wallet = makeWallet({ gold: 1000, mergeStones: 2 });
    const result = buyMergeStones(makeEconomyState(), wallet, 3, 0);
    expect(result.bought).toBe(3);
    expect(result.goldSpent).toBe(stonePriceAt(0, 0) + stonePriceAt(0, 1) + stonePriceAt(0, 2));
    expect(result.wallet.gold).toBe(1000 - result.goldSpent);
    expect(result.wallet.mergeStones).toBe(5);
    expect(result.economy.stonesPurchasedToday).toBe(3);
  });

  it('no amount of gold buys more than the daily cap of merge stones', () => {
    const wallet = makeWallet({ gold: UNLIMITED_GOLD });
    const result = buyMergeStones(makeEconomyState(), wallet, 999, 0);
    expect(result.bought).toBe(economy.dailyCaps.stonesPurchased);

    // And the cap holds against a second attempt in the same day.
    const again = buyMergeStones(result.economy, result.wallet, 999, 0);
    expect(again.bought).toBe(0);
    expect(again.goldSpent).toBe(0);
    expect(again.wallet).toEqual(result.wallet);
  });

  it('asking for more stones than today allows buys what it can and says how many', () => {
    const nearlyCapped = makeEconomyState({
      stonesPurchasedToday: economy.dailyCaps.stonesPurchased - 2,
    });
    const result = buyMergeStones(nearlyCapped, makeWallet({ gold: UNLIMITED_GOLD }), 10, 0);
    expect(result.bought).toBe(2);
    expect(result.economy.stonesPurchasedToday).toBe(economy.dailyCaps.stonesPurchased);
  });

  it('buying with too little gold buys as many stones as the gold covers, and no more', () => {
    const wallet = makeWallet({ gold: stonePriceAt(0, 0) + stonePriceAt(0, 1) });
    const result = buyMergeStones(makeEconomyState(), wallet, 5, 0);
    expect(result.bought).toBe(2);
    expect(result.wallet.gold).toBe(0);
    expect(result.wallet.gold).toBeGreaterThanOrEqual(0);
  });

  it('a purchase never leaves the wallet with less gold than nothing', () => {
    const wallet = makeWallet({ gold: 1 });
    const result = buyMergeStones(makeEconomyState(), wallet, 20, 6);
    expect(result.bought).toBe(0);
    expect(result.wallet.gold).toBe(1);
  });

  it('buying no stones at all changes nothing', () => {
    const state = makeEconomyState({ stonesPurchasedToday: 4 });
    const wallet = makeWallet();
    const result = buyMergeStones(state, wallet, 0, 2);
    expect(result.bought).toBe(0);
    expect(result.goldSpent).toBe(0);
    expect(result.wallet).toEqual(wallet);
    expect(result.economy).toEqual(state);
  });

  it('a purchase leaves the day counter and the anomaly count alone', () => {
    const state = makeEconomyState({ dayIndex: 77, clockAnomalies: 3, lastCollectedAt: 12345 });
    const result = buyMergeStones(state, makeWallet({ gold: UNLIMITED_GOLD }), 2, 0);
    expect(result.economy.dayIndex).toBe(77);
    expect(result.economy.clockAnomalies).toBe(3);
    expect(result.economy.lastCollectedAt).toBe(12345);
  });

  it('the gold charged is exactly the sum of each stone’s own price', () => {
    const state = makeEconomyState({ stonesPurchasedToday: 5 });
    const result = buyMergeStones(state, makeWallet({ gold: UNLIMITED_GOLD }), 4, 2);
    let expected = 0;
    for (let i = 0; i < 4; i++) expected += stonePriceAt(2, 5 + i);
    expect(result.goldSpent).toBe(expected);
  });
});

describe('economy: merge stones earned through play', () => {
  it('earned merge stones stop at the daily earning cap', () => {
    const state = makeEconomyState({ stonesEarnedToday: economy.dailyCaps.stonesEarned - 3 });
    const result = creditEarnedStones(state, 10);
    expect(result.credited).toBe(3);
    expect(result.economy.stonesEarnedToday).toBe(economy.dailyCaps.stonesEarned);
  });

  it('a reward offered after the cap is reached credits nothing', () => {
    const state = makeEconomyState({ stonesEarnedToday: economy.dailyCaps.stonesEarned });
    expect(creditEarnedStones(state, 5).credited).toBe(0);
  });

  it('a reward inside the cap is credited in full', () => {
    const result = creditEarnedStones(makeEconomyState(), 3);
    expect(result.credited).toBe(3);
    expect(result.economy.stonesEarnedToday).toBe(3);
  });

  it('what a player earns and what a player buys are counted separately', () => {
    const earned = creditEarnedStones(makeEconomyState(), 5);
    expect(earned.economy.stonesPurchasedToday).toBe(0);
    const bought = buyMergeStones(earned.economy, makeWallet({ gold: UNLIMITED_GOLD }), 5, 0);
    expect(bought.economy.stonesEarnedToday).toBe(5);
    expect(bought.economy.stonesPurchasedToday).toBe(5);
  });

  it('no single day can supply more merge stones than the earning cap plus the buying cap', () => {
    const earned = creditEarnedStones(makeEconomyState(), 10_000);
    const bought = buyMergeStones(earned.economy, makeWallet({ gold: UNLIMITED_GOLD }), 10_000, 0);
    expect(earned.credited + bought.bought).toBe(
      economy.dailyCaps.stonesEarned + economy.dailyCaps.stonesPurchased,
    );
  });
});

describe('economy: the daily merge stone limit defends itself against an edited save file', () => {
  // Nothing in economy.ts can make either day counter negative — a new day zeroes
  // them and both functions only ever add. A tampered save file can, though, and a
  // negative counter used to be read as EXTRA daily allowance on top of the cap,
  // sold at the cheapest price of the day. These tests are that door being shut.
  const TAMPERED_BELOW_ZERO = -20;

  it('a save file claiming fewer than zero merge stones bought today still cannot buy more than the daily limit', () => {
    const tampered = makeEconomyState({ stonesPurchasedToday: TAMPERED_BELOW_ZERO });
    const result = buyMergeStones(tampered, makeWallet({ gold: UNLIMITED_GOLD }), 999, 0);
    expect(result.bought).toBe(economy.dailyCaps.stonesPurchased);
  });

  it('a save file claiming fewer than zero merge stones bought today pays the same gold as an honest one', () => {
    const tampered = makeEconomyState({ stonesPurchasedToday: TAMPERED_BELOW_ZERO });
    const wallet = makeWallet({ gold: UNLIMITED_GOLD });
    const cheated = buyMergeStones(tampered, wallet, 999, 0);
    const honest = buyMergeStones(makeEconomyState(), wallet, 999, 0);
    expect(cheated.goldSpent).toBe(honest.goldSpent);
    expect(cheated.wallet).toEqual(honest.wallet);
  });

  it('a save file claiming fewer than zero merge stones earned today still cannot earn more than the daily limit', () => {
    const tampered = makeEconomyState({ stonesEarnedToday: TAMPERED_BELOW_ZERO });
    expect(creditEarnedStones(tampered, 1_000_000).credited).toBe(economy.dailyCaps.stonesEarned);
  });

  it('an edited save file cannot squeeze more merge stones out of one day than the caps allow', () => {
    const tampered = makeEconomyState({
      stonesEarnedToday: TAMPERED_BELOW_ZERO,
      stonesPurchasedToday: TAMPERED_BELOW_ZERO,
    });
    const earned = creditEarnedStones(tampered, 10_000);
    const bought = buyMergeStones(earned.economy, makeWallet({ gold: UNLIMITED_GOLD }), 10_000, 0);
    expect(earned.credited + bought.bought).toBe(
      economy.dailyCaps.stonesEarned + economy.dailyCaps.stonesPurchased,
    );
  });

  it('buying merge stones writes back a sensible day counter instead of leaving a nonsense one', () => {
    const tampered = makeEconomyState({ stonesPurchasedToday: TAMPERED_BELOW_ZERO });
    const result = buyMergeStones(tampered, makeWallet({ gold: UNLIMITED_GOLD }), 3, 0);
    expect(result.economy.stonesPurchasedToday).toBe(3);
  });

  it('crediting earned merge stones writes back a sensible day counter instead of leaving a nonsense one', () => {
    const tampered = makeEconomyState({ stonesEarnedToday: TAMPERED_BELOW_ZERO });
    expect(creditEarnedStones(tampered, 4).economy.stonesEarnedToday).toBe(4);
  });

  it('an honest day counter is left exactly as it was found', () => {
    const state = makeEconomyState({ stonesEarnedToday: 7, stonesPurchasedToday: 5 });
    expect(creditEarnedStones(state, 2).economy.stonesEarnedToday).toBe(9);
    const bought = buyMergeStones(state, makeWallet({ gold: UNLIMITED_GOLD }), 2, 0);
    expect(bought.economy.stonesPurchasedToday).toBe(7);
  });
});

describe('economy: asking the price of merge stones can never freeze the game', () => {
  // The price of a bundle is worked out by adding up one stone at a time, and the
  // number asked for is the only thing that ends that loop. A nonsensical number
  // used to mean it never ended — on a phone that is a frozen game, not a wrong
  // number, so a nonsensical request now simply prices at nothing.

  it('asking the price of an impossible number of merge stones answers instead of counting forever', () => {
    expect(stoneBundlePrice(Infinity, 0, 0)).toBe(0);
    expect(stoneBundlePrice(-Infinity, 0, 0)).toBe(0);
  });

  it('asking the price of a number that is not a number at all costs nothing', () => {
    expect(stoneBundlePrice(NaN, 0, 0)).toBe(0);
  });

  it('asking the price of an absurdly large pile of merge stones answers straight away', () => {
    // Beyond about twelve thousand stones the running total is already more gold
    // than a number can hold, so every further stone adds nothing but delay. Before
    // this was fixed a billion stones took minutes; the test would time out.
    expect(stoneBundlePrice(1_000_000_000, 0, 0)).toBe(Infinity);
  });

  it('a real bundle price is completely unaffected by those guards', () => {
    expect(stoneBundlePrice(3, 0, 0)).toBe(stonePriceAt(0, 0) + stonePriceAt(0, 1) + stonePriceAt(0, 2));
    expect(stoneBundlePrice(10, 4, 7)).toBe(
      Array.from({ length: 10 }, (_unused, i) => stonePriceAt(4, 7 + i)).reduce((a, b) => a + b, 0),
    );
  });

  it('asking to buy an impossible number of merge stones buys exactly the daily limit', () => {
    const result = buyMergeStones(makeEconomyState(), makeWallet({ gold: UNLIMITED_GOLD }), Infinity, 0);
    expect(result.bought).toBe(economy.dailyCaps.stonesPurchased);
  });

  it('asking how many merge stones an impossible allowance covers answers instead of counting forever', () => {
    expect(stonesAffordable(UNLIMITED_GOLD, 0, 0, Infinity)).toBe(0);
    expect(stonesAffordable(UNLIMITED_GOLD, 0, 0, NaN)).toBe(0);
  });
});
