/**
 * Idle income — the gold that accrues while the app is closed.
 *
 * Pure functions. `now` is always a parameter and is never read from the device
 * in here, so every rule below is testable without mocking a clock (same house
 * style as clock.ts, which owns the actual time arithmetic).
 *
 * Two rules do all the work here, and neither of them is a detail:
 *
 * 1. Idle pays GOLD and nothing else — never merge stones, gems or eggs. This is
 *    the entire reason a tampered clock is harmless (see the header of clock.ts):
 *    the worst a cheat can produce is a big gold number, and gold's only route to
 *    merge stones runs through the daily purchase cap that money cannot raise. If
 *    idle ever paid stones, winding a clock forward would buy a guaranteed
 *    outcome, which DESIGN.md forbids outright. Do not relax this.
 * 2. Only the strongest `economy.idle.rosterSize` creatures earn. Hoarding weak
 *    creatures is therefore worth exactly nothing, and merging two earners into
 *    one stronger creature raises income — that pull back into the merge loop is
 *    the reason idle income exists at all, not a side effect of it.
 */

import { payableIdleMs } from './clock';
import { creaturePower, economy } from './content';
import type { Creature, EconomyState, Wallet } from './models';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * The creatures actually earning right now: the strongest `rosterSize`, best
 * first. Everything below the cut earns nothing.
 *
 * Ranked by creaturePower — the display/sort number — because this list is shown
 * to the player as "these six are earning", and it must agree with the order the
 * collection screen already sorts by. It does NOT decide the payout; see
 * idleGoldPerHour for why those are two different numbers.
 */
export function idleRoster(collection: Creature[]): Creature[] {
  const ranked = collection.map((creature) => ({ creature, power: creaturePower(creature) }));
  ranked.sort((a, b) => {
    if (a.power !== b.power) return b.power - a.power;
    // Ties break on id, deterministically. Identical creatures are the normal
    // case, not an edge case — a batch of eggs of one species at one tier rolls
    // near-identical power all the time. Without a fixed tie-break the "earning
    // six" would depend on how the sort happened to handle equal elements, so
    // the roster could visibly reshuffle between two renders with nothing having
    // changed, and a player would reasonably read that as a bug.
    return a.creature.id < b.creature.id ? -1 : a.creature.id > b.creature.id ? 1 : 0;
  });
  return ranked.slice(0, economy.idle.rosterSize).map((entry) => entry.creature);
}

/**
 * Gold per hour, at this exact collection.
 *
 * Paid on cumulativeStatMultiplier — the honest from-tier-0 power of each
 * earner's TIER — not on creaturePower. That is deliberate and load-bearing:
 * every gold payout in the game scales on the same number (see economy.json's
 * rule 1), so battle gold, idle gold and enemy strength stay in lockstep
 * forever. Paying on creaturePower instead would make income swing on species
 * base stats and roll luck, so two players at the same tier would earn visibly
 * different amounts for a reason neither of them could act on.
 *
 * Left unrounded on purpose — the rounding happens exactly once, on the gold
 * actually handed over (see previewIdle), so a partial hour is not rounded twice.
 */
export function idleGoldPerHour(collection: Creature[]): number {
  const powerUnits = idleRoster(collection).reduce(
    (sum, creature) => sum + tierEarning(creature.tier),
    0,
  );
  return economy.idle.goldPerHourPerPowerUnit * powerUnits;
}

/**
 * What one earner at a given tier is worth per hour, in power units.
 *
 * This is `tierEarningBase ^ tier` and NOT cumulativeStatMultiplier, which is
 * what every other gold payout in the game uses. The exception is deliberate and
 * load-bearing: merging two creatures into one must always RAISE income, because
 * being pulled back into the merge loop is the entire reason idle income exists.
 * Two earners at tier T pay 2 x base^T and the tier T+1 they become pays
 * base^(T+1), so the base has to be greater than 2 or a merge costs the player
 * income. cumulativeStatMultiplier fails that at the very first step —
 * tierMultipliers[1] is 1.5, so two tier-0s were worth more than the tier-1 they
 * made, and a new player with six or fewer creatures watched their income DROP
 * for doing the one thing the game is about.
 *
 * A negative or non-finite tier (only reachable from a hand-edited save) earns
 * the tier-0 rate rather than something nonsensical.
 */
export function tierEarning(tier: number): number {
  if (!Number.isFinite(tier) || tier <= 0) return 1;
  return economy.idle.tierEarningBase ** tier;
}

export interface IdlePreview {
  /** Gold waiting to be collected. Always a whole number, and never negative. */
  goldReady: number;
  /** True once the banked time has hit the offline ceiling — further time away earns nothing. */
  cappedOut: boolean;
  /** The idle time being paid for: elapsed, floored at 0 and clamped to the cap. */
  msElapsed: number;
  /** How much longer until the ceiling is reached. 0 once cappedOut. */
  msUntilCap: number;
}

/**
 * What is waiting, without taking it. Read-only — nothing here changes state, so
 * a screen can call it on every frame.
 */
export function previewIdle(
  state: EconomyState,
  collection: Creature[],
  now: number,
): IdlePreview {
  const capMs = economy.idle.offlineCapHours * MS_PER_HOUR;

  // lastCollectedAt of 0 means "never stamped". Left to payableIdleMs that reads
  // as "away since 1970" and pays out the full cap the first time the save is
  // opened — inventing money for a player who was never away. save.ts's
  // stampFreshSave normally fills this in at load; this is a second lock on the
  // same door, because that failure would be silent and would look like income.
  const banked =
    state.lastCollectedAt > 0
      ? payableIdleMs(state.lastCollectedAt, now, economy.idle.offlineCapHours)
      : 0;

  // Below the minimum, report nothing at all, so the UI never offers a collect
  // that would hand over a coin or two and reset the timer for the trouble.
  const worthCollecting = banked >= economy.idle.minCollectMinutes * MS_PER_MINUTE;

  return {
    goldReady: worthCollecting
      ? Math.floor((idleGoldPerHour(collection) * banked) / MS_PER_HOUR)
      : 0,
    cappedOut: banked >= capMs,
    msElapsed: banked,
    msUntilCap: Math.max(0, capMs - banked),
  };
}

export interface IdleCollectResult {
  economy: EconomyState;
  wallet: Wallet;
  goldCollected: number;
}

/**
 * Bank whatever is waiting. Returns new objects; nothing is mutated in place.
 */
export function collectIdle(
  state: EconomyState,
  wallet: Wallet,
  collection: Creature[],
  now: number,
): IdleCollectResult {
  // The clock reports a moment before the last collection. Rather than freeze
  // the player out until real time catches up, re-anchor to now and pay nothing.
  // What breaks without this: a device whose clock was set years ahead and is
  // then corrected earns zero idle income until that future timestamp genuinely
  // passes — silently, with no error and nothing the player can do. A cheat
  // gains nothing from it, because winding a clock FORWARD already grants a
  // capped payout and this grants at most the same capped payout.
  if (state.lastCollectedAt > 0 && now < state.lastCollectedAt) {
    return { economy: { ...state, lastCollectedAt: now }, wallet, goldCollected: 0 };
  }

  const { goldReady } = previewIdle(state, collection, now);

  // Nothing to pay: leave the banked time exactly where it is. Moving
  // lastCollectedAt forward on an empty collect would quietly delete the minutes
  // accrued so far, so a screen that calls this on mount would reset the timer
  // every time it opened and the player would never earn anything at all.
  if (goldReady <= 0) return { economy: state, wallet, goldCollected: 0 };

  return {
    // The clock restarts from `now`, not from cap-hours ago: time past the
    // ceiling is forfeited, not banked. Carrying the overflow over would turn
    // the offline cap into a delay rather than a ceiling, and the ceiling is
    // what bounds a wound-forward clock.
    economy: { ...state, lastCollectedAt: now },
    // GOLD ONLY. Spreading the existing wallet rather than rebuilding it is what
    // guarantees merge stones and gems are untouched by a clock-derived payout.
    wallet: { ...wallet, gold: wallet.gold + goldReady },
    goldCollected: goldReady,
  };
}
