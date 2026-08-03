/**
 * Idle income — the gold that accrues while the app is closed.
 *
 * Pure functions. `now` is always a parameter and is never read from the device
 * in here, so every rule below is testable without mocking a clock (same house
 * style as clock.ts, which owns the actual time arithmetic).
 *
 * Three rules do all the work here, and none of them is a detail:
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
 *    the reason idle income exists at all, not a side effect of it. See
 *    tierEarning for the arithmetic that keeps the second half of that true.
 * 3. Who earns and what they are paid are decided by ONE number (tierEarning).
 *    They used to be two: the roster was picked by creaturePower and then paid by
 *    tier. Those can disagree, and when they did, a free egg could push the
 *    player's best earner off the roster and LOWER their income. Any ranking here
 *    must stay keyed on the same quantity the payout uses.
 */

import { payableIdleMs } from './clock';
import { creaturePower, cumulativeStatMultiplier, economy } from './content';
import type { Creature, EconomyState, Wallet } from './models';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * What one earner at a given tier is worth per hour, in power units.
 *
 * This is cumulativeStatMultiplier — the honest from-tier-0 power of the tier,
 * which every other gold payout in the game scales on — RAISED TO A FLOOR: each
 * tier must earn at least `tierEarningBase` times the tier below it.
 *
 * The floor exists because idle is the only payout whose number of PAYEES
 * changes when the player acts. A same-tier merge puts two earners in and takes
 * one out, so tier T+1 has to be worth more than DOUBLE tier T or merging costs
 * the player income — and being pulled back into the merge loop is the entire
 * reason idle income exists. The honest curve fails that at the bottom of the
 * ladder: tierMultipliers[1] is 1.5, so two tier-0s (1.0 + 1.0) were worth more
 * than the tier-1 they became, and a new player (one tutorial creature plus a
 * batch of eggs) sat exactly in the range where their very first merge cut their
 * income by 10%.
 *
 * It is a FLOOR and not a replacement, and that distinction is load-bearing. A
 * plain `tierEarningBase ^ tier` curve also clears the merge bar, but it grows
 * far slower than the stat curve everything else is priced against — merge stone
 * prices scale on cumulativeStatMultiplier (2841x at tier 6) while 2.2^6 is only
 * 113x, so eight hours offline would drop from roughly nine merge stones' worth
 * of gold at tier 0 to less than half of one at tier 6, and idle income would
 * quietly become worthless exactly where the game is trying to hold on to
 * players. Taking the maximum keeps the merge guarantee at the bottom, where the
 * honest curve is too shallow, and hands the honest curve back from tier 4 up,
 * where it is already steeper than the floor. Idle, battle gold and the stone
 * exchange therefore stay in lockstep everywhere they ever did.
 *
 * Written as a rule rather than a hand-written table on purpose: retuning
 * balance.json's tierMultipliers can never silently reintroduce the bug, and a
 * tier beyond the end of that table is covered too.
 *
 * A negative or non-finite tier (only reachable from a hand-edited save) earns
 * the tier-0 rate rather than something nonsensical.
 */
export function tierEarning(tier: number): number {
  if (!Number.isFinite(tier) || tier <= 0) return 1;
  let earning = 1;
  for (let t = 1; t <= Math.floor(tier); t++) {
    earning = Math.max(earning * economy.idle.tierEarningBase, cumulativeStatMultiplier(t));
  }
  return earning;
}

/**
 * The creatures actually earning right now: the strongest `rosterSize`, best
 * first. Everything below the cut earns nothing.
 *
 * Ranked by tierEarning — the same number idleGoldPerHour pays them — so the
 * list shown to the player as "these six are earning" can never disagree with
 * the payout. Ranking by creaturePower instead was a real bug, not a cosmetic
 * one: a tier-1 that had been cross-tier merged for a type reroll can score
 * BELOW a lucky tier-0 on power while being worth over twice as much in income,
 * so hatching one more free egg could bench the player's biggest earner and drop
 * their gold per hour. Keying both on tierEarning makes "getting a creature can
 * never lower your income" true by construction rather than by luck.
 *
 * creaturePower stays as the second key, so among creatures that earn the same
 * (i.e. share a tier) the order still matches how the collection screen sorts.
 */
export function idleRoster(collection: Creature[]): Creature[] {
  const ranked = collection.map((creature) => ({
    creature,
    earning: tierEarning(creature.tier),
    power: creaturePower(creature),
  }));
  ranked.sort((a, b) => {
    if (a.earning !== b.earning) return b.earning - a.earning;
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
 * Paid on each earner's TIER (see tierEarning), never on creaturePower. Paying
 * on creaturePower would make income swing on species base stats and roll luck,
 * so two players at the same tier would earn visibly different amounts for a
 * reason neither of them could act on.
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

  // Below the minimum, offer nothing, so the UI is not inviting the player to
  // tap a button for a coin or two. This is a presentation floor and nothing
  // more — collecting early costs the player nothing, because collectIdle only
  // advances the clock past the time it actually paid for (see below).
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

  const { goldReady, msElapsed } = previewIdle(state, collection, now);

  // Nothing to pay: leave the banked time exactly where it is. Moving
  // lastCollectedAt forward on an empty collect would quietly delete the minutes
  // accrued so far, so a screen that calls this on mount would reset the timer
  // every time it opened and the player would never earn anything at all.
  if (goldReady <= 0) return { economy: state, wallet, goldCollected: 0 };

  // Gold is handed over in whole coins, so a collect almost never pays for the
  // whole of the time it covers. Only the time actually PAID FOR is consumed;
  // the sub-coin remainder stays banked for next time. Without this the leftover
  // was silently destroyed on every collect, and collecting often was strictly
  // worse than collecting once — sixty one-minute collects across an hour paid
  // 60 gold where a single collect paid 158. Players should never have to think
  // about collection timing, and now they do not: any pattern of collects across
  // the same stretch of time pays the same.
  //
  // Measured back from `now`, not forward from lastCollectedAt, so that time
  // past the offline ceiling is still forfeited rather than banked. Carrying the
  // overflow would turn the cap into a delay rather than a ceiling, and the
  // ceiling is what bounds a wound-forward clock.
  const msPaidFor = (goldReady / idleGoldPerHour(collection)) * MS_PER_HOUR;
  const msUnpaid = Math.min(msElapsed, Math.max(0, Math.floor(msElapsed - msPaidFor)));

  return {
    economy: { ...state, lastCollectedAt: now - msUnpaid },
    // GOLD ONLY. Spreading the existing wallet rather than rebuilding it is what
    // guarantees merge stones and gems are untouched by a clock-derived payout.
    wallet: { ...wallet, gold: wallet.gold + goldReady },
    goldCollected: goldReady,
  };
}
