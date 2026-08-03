/**
 * The only module that spends and earns currency. Pure TypeScript — no React,
 * no UI imports, no clock, no randomness. Every number comes from
 * src/data/economy.json via content.ts; there is not one balance figure below.
 *
 * Three things here are load-bearing rather than incidental:
 *
 * 1. `stoneCostByInputTier[0]` is 0, so a tier-0 merge is free FOREVER. Eggs
 *    are free and unlimited, so a player with an empty wallet can always make
 *    tier-1 creatures. That is the structural promise that nobody can be
 *    hard-walled out of the core loop, and it is why the cost table is indexed
 *    by the INPUT tier and not the result tier — a result-tier table cannot
 *    express "the first merge is free" at all.
 *
 * 2. `mergeAdvancesPity` exists because free merges must be invisible to the
 *    perfect-roll countdown. Without it a player farms free tier-0 merges to
 *    force a guaranteed perfect roll, and since gems buy gold and gold buys
 *    stones, real money would accelerate reaching it. That turns money into
 *    BETTER outcomes rather than faster ones — the one line DESIGN.md forbids
 *    crossing. merge.ts imports it; the edge merge → economy → content is
 *    acyclic and must stay that way.
 *
 * 3. Every stone that enters the game passes a daily cap — `buyMergeStones`
 *    for bought ones, `creditEarnedStones` for earned ones. Those two ceilings
 *    are the meter on the whole economy (see dailyCaps in economy.json). Money
 *    buys speed up to them and can never raise them, so a top-tier creature
 *    takes at least two real days for anybody. Any future stone faucet must
 *    route through one of these two functions or that guarantee quietly dies.
 */

import { cumulativeStatMultiplier, economy } from './content';
import type { Creature, EconomyState, Wallet } from './models';

/**
 * Every currency, listed once. Written as a `satisfies Wallet` object literal
 * rather than a hand-typed array so that adding a fourth currency to Wallet
 * fails to compile right here — a currency this module silently skipped would
 * be a currency you could spend without having.
 */
const WALLET_KEYS = Object.keys({
  gold: 0,
  mergeStones: 0,
  gems: 0,
} satisfies Wallet) as (keyof Wallet)[];

/** A partial wallet: the currencies a transaction touches, in whole units. */
export type CurrencyAmounts = Partial<Wallet>;

function amountOf(amounts: CurrencyAmounts, key: keyof Wallet): number {
  const value = amounts[key] ?? 0;
  // A negative amount would make `spend` hand out money and `earn` take it
  // away — the same two functions doing the opposite of their names, which is
  // exactly the kind of bug that only shows up as a player's balance drifting.
  // Refuse it loudly instead.
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Currency amount for ${key} must be a finite, non-negative number (got ${String(amounts[key])})`,
    );
  }
  return value;
}

// --- Merge costs ------------------------------------------------------------

/**
 * What one merge costs in merge stones, indexed by the tier of the STRONGER
 * parent. Index 0 is free forever (see the header). A cross-tier merge costs
 * `crossTierCostFraction` of that, rounded UP so the discount can never reach
 * zero and reopen the free-merge exploit at higher tiers: cross-tier merging
 * already pays in diluted stats (it gets no tier multiplier at all — see
 * mergedStats in merge.ts), and charging it full price would punish the
 * type-reroll tool twice. Rounding up means the discount vanishes entirely at
 * tier 1, where half a stone rounds back to a whole one — that is the correct
 * trade: a free cross-tier merge would be invisible to the pity countdown and
 * reopen the exploit `mergeAdvancesPity` exists to close.
 *
 * Tiers past the end of the table reuse the last entry, so raising the tier
 * ceiling never requires editing this file in lockstep with the JSON.
 */
export function mergeStoneCost(a: Creature, b: Creature): number {
  const table = economy.merge.stoneCostByInputTier;
  const strongerTier = Math.max(a.tier, b.tier);
  const index = Math.min(Math.max(0, Math.floor(strongerTier)), table.length - 1);
  const base = table[index] ?? 0;
  if (a.tier === b.tier) return base;
  return Math.ceil(base * economy.merge.crossTierCostFraction);
}

/**
 * Whether this merge is allowed to move the perfect-roll countdown. Defined as
 * "it cost stones" rather than "both parents are above tier 0" so the two can
 * never disagree: if the cost table ever makes another merge free, that merge
 * becomes invisible to pity automatically. See point 2 in the header for what
 * breaks otherwise.
 */
export function mergeAdvancesPity(a: Creature, b: Creature): boolean {
  return mergeStoneCost(a, b) > 0;
}

// --- Wallet arithmetic ------------------------------------------------------

/** True when the wallet holds at least every currency the cost asks for. */
export function canAfford(wallet: Wallet, cost: CurrencyAmounts): boolean {
  return WALLET_KEYS.every((key) => wallet[key] >= amountOf(cost, key));
}

/**
 * Pay a cost, returning a new wallet. Throws when the wallet cannot cover it —
 * deliberately, rather than clamping at zero. A silent clamp would hand out
 * whatever was being bought for less than its price, and the caller would
 * never know; every real caller checks `canAfford` (or uses `stonesAffordable`)
 * before it gets here, so a throw only ever means a genuine bug upstream.
 */
export function spend(wallet: Wallet, cost: CurrencyAmounts): Wallet {
  const next = { ...wallet };
  for (const key of WALLET_KEYS) {
    const amount = amountOf(cost, key);
    if (amount > wallet[key]) {
      throw new Error(`Cannot spend ${amount} ${key}: wallet holds ${wallet[key]}`);
    }
    next[key] = wallet[key] - amount;
  }
  return next;
}

/**
 * Bank a payout, returning a new wallet. Amounts are added exactly as given
 * and never rounded — rounding is the paying module's decision (see
 * rewards.ts / idle.ts), and quietly rounding here would hide a payout bug
 * behind a plausible-looking number.
 */
export function earn(wallet: Wallet, gain: CurrencyAmounts): Wallet {
  const next = { ...wallet };
  for (const key of WALLET_KEYS) {
    next[key] = wallet[key] + amountOf(gain, key);
  }
  return next;
}

// --- The gold → merge stone exchange ---------------------------------------

/**
 * The highest tier in a collection — the anchor for the stone price. An empty
 * collection anchors at 0, which is the cheapest possible stone: a player with
 * nothing must never face a price set for somebody who has everything.
 */
export function highestTier(collection: Creature[]): number {
  return collection.reduce((best, creature) => Math.max(best, creature.tier), 0);
}

/**
 * What the NEXT stone costs in gold today.
 *
 * Anchoring on the player's own highest tier is what makes the price
 * tier-invariant in battles-per-stone: the first stone of the day costs about
 * two battles and the thirtieth about nine, at tier 1 and at tier 6 alike. The
 * escalator is `purchasedToday`, which clock.ts resets when the monotonic day
 * rolls over — and that day never runs backwards, so the escalator cannot be
 * forged by winding a clock.
 *
 * Floored at 1 gold: a free stone would be an unmetered stone, and the daily
 * cap should not be the only thing standing between a player and infinity.
 */
export function stonePriceAt(highestTier: number, purchasedToday: number): number {
  const tier = Math.max(0, Math.floor(highestTier));
  const step = Math.max(0, Math.floor(purchasedToday));
  const raw =
    economy.exchange.baseGoldPerStone *
    cumulativeStatMultiplier(tier) *
    Math.pow(economy.exchange.priceGrowth, step);
  return Math.max(1, Math.round(raw));
}

interface PurchaseRun {
  bought: number;
  goldSpent: number;
}

/**
 * Walk the escalator one stone at a time. Prices only ever rise with each
 * stone bought, so buying greedily from the front is exactly optimal — there
 * is no cheaper subset to find, and a closed-form sum would drift from
 * `stonePriceAt` the moment either is rounded differently.
 *
 * A `null` budget means "price these, don't pay for them" — that is how
 * `stoneBundlePrice` quotes a bundle nobody has bought yet. It is spelled as
 * null rather than Infinity because an infinite budget is indistinguishable
 * from a corrupt gold value, and this function refuses those.
 *
 * `limit` gets the same treatment for the same reason, and it needs it more:
 * on the null-budget path `limit` is the ONLY thing that ends this loop, so a
 * non-finite one spins forever. On a phone an endless loop is a frozen game
 * rather than a wrong number, so a nonsensical count buys nothing instead.
 * The second guard is the other end of the same bound: the escalator overflows
 * to an infinite price long before a huge finite count runs out, and every
 * further step just adds infinity to infinity. Stopping there returns the
 * identical answer — a budget-bound run already breaks at that price, and an
 * unbudgeted one has already reached Infinity — without the wait.
 */
function purchaseRun(
  budget: number | null,
  tier: number,
  purchasedToday: number,
  limit: number,
): PurchaseRun {
  const gold = budget === null ? null : Number.isFinite(budget) ? Math.max(0, budget) : 0;
  const maxStones = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  let bought = 0;
  let goldSpent = 0;
  while (bought < maxStones) {
    const price = stonePriceAt(tier, purchasedToday + bought);
    if (gold !== null && goldSpent + price > gold) break;
    goldSpent += price;
    bought += 1;
    if (!Number.isFinite(goldSpent)) break;
  }
  return { bought, goldSpent };
}

/**
 * How many stones this much gold actually buys, given how many were already
 * bought today and how much of the daily cap is left. `remainingCap` is passed
 * in rather than read from state so the store can show "you can afford 4" and
 * "you have 7 left today" as two separate, honest sentences.
 */
export function stonesAffordable(
  gold: number,
  highestTier: number,
  purchasedToday: number,
  remainingCap: number,
): number {
  return purchaseRun(gold, highestTier, purchasedToday, remainingCap).bought;
}

/**
 * Total gold for the next `count` stones, ignoring the wallet and the cap —
 * what a "Buy 10" button must display. Computed by the same escalator walk the
 * real purchase uses, so the quoted price and the charged price cannot drift.
 */
export function stoneBundlePrice(count: number, highestTier: number, purchasedToday: number): number {
  return purchaseRun(null, highestTier, purchasedToday, count).goldSpent;
}

export interface StonePurchase {
  economy: EconomyState;
  wallet: Wallet;
  /** How many stones were actually bought — never more than asked for. */
  bought: number;
  goldSpent: number;
}

/**
 * Buy merge stones with gold, capped by `dailyCaps.stonesPurchased`.
 *
 * Asking for more than the cap or the wallet allows buys what it can and
 * reports it, rather than throwing. That is a UI decision as much as an
 * economic one: "you bought 7 of the 10 you asked for, that's today's limit"
 * is a sentence a player can act on, whereas a failed transaction on the
 * bottleneck currency reads as the game being broken. Callers must show
 * `bought` rather than assume they got what they asked for.
 *
 * The day's tally is read through a floor of zero rather than trusted. Nothing
 * in this module can drive it negative, but a hand-edited save can — save.ts
 * accepts any finite number there — and a negative tally would do two things at
 * once: enlarge the cap by however far below zero it went, and reset the price
 * escalator to its cheapest step for those extra stones. This cap is the meter
 * on the whole economy (see point 3 in the header), so it defends itself here
 * instead of relying on the save file being honest, exactly as dayIndex is a
 * monotonic high-water mark instead of trusting the device clock. The clamped
 * value is also what gets written back, so one purchase repairs the tally.
 */
export function buyMergeStones(
  economyState: EconomyState,
  wallet: Wallet,
  count: number,
  highestTier: number,
): StonePurchase {
  const boughtToday = Math.max(0, economyState.stonesPurchasedToday);
  const remainingCap = Math.max(0, economy.dailyCaps.stonesPurchased - boughtToday);
  const wanted = Math.min(Math.max(0, Math.floor(count)), remainingCap);
  const { bought, goldSpent } = purchaseRun(wallet.gold, highestTier, boughtToday, wanted);
  return {
    economy: { ...economyState, stonesPurchasedToday: boughtToday + bought },
    wallet: earn(spend(wallet, { gold: goldSpent }), { mergeStones: bought }),
    bought,
    goldSpent,
  };
}

export interface StoneCredit {
  economy: EconomyState;
  /** How much of the offered amount the daily cap allowed through. */
  credited: number;
}

/**
 * Meter stones EARNED through play against `dailyCaps.stonesEarned`.
 *
 * This deliberately does not touch the wallet: it answers "how many of these
 * are you allowed today", and the caller banks the answer with
 * `earn(wallet, { mergeStones: credited })`. Splitting it that way means a
 * reward screen can show the player what was withheld — an unexplained
 * shortfall on the currency the whole game meters would read as a bug.
 *
 * The day's tally is floored at zero before it is read, for the same reason
 * `buyMergeStones` does it: a negative tally in an edited save would hand the
 * player that much extra room on top of the cap. Both halves of the daily
 * ceiling have to defend themselves, or the one that doesn't becomes the way
 * around the one that does.
 */
export function creditEarnedStones(economyState: EconomyState, amount: number): StoneCredit {
  const earnedToday = Math.max(0, economyState.stonesEarnedToday);
  const room = Math.max(0, economy.dailyCaps.stonesEarned - earnedToday);
  const offered = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  const credited = Math.min(offered, room);
  return {
    economy: { ...economyState, stonesEarnedToday: earnedToday + credited },
    credited,
  };
}
