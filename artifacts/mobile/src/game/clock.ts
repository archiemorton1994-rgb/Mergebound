/**
 * The only place the passage of days is decided. Pure functions — the current
 * time is always a parameter, never read from the device in here, so every rule
 * below is testable without mocking a clock.
 *
 * The problem this solves: a purely local game cannot stop somebody changing
 * their device clock. What it CAN do is make changing it pointless. Every daily
 * cap keys off `dayIndex`, which is a high-water mark that never decreases — so
 * winding the clock back does not hand out a fresh day's allowance. Winding it
 * FORWARD does advance the day, but that only ever moves a player forward
 * through their own allowances, and the one faucet that reads wall-clock time
 * (idle income) pays gold and nothing else. Gold cannot buy an outcome.
 *
 * See DESIGN.md: a local offline economy cannot be made tamper-proof, so this
 * makes tampering not worth doing rather than impossible.
 */

import type { EconomyState } from './models';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Which day the device thinks it is, as a whole number of local days since the
 * epoch. Takes the timezone offset in minutes as JavaScript reports it
 * (Date.getTimezoneOffset: minutes to ADD to local time to reach UTC), so a
 * player's day rolls over at their local midnight rather than UTC's.
 */
export function reportedDayIndex(now: number, tzOffsetMinutes: number): number {
  return Math.floor((now - tzOffsetMinutes * MS_PER_MINUTE) / MS_PER_DAY);
}

export interface DayAdvance {
  economy: EconomyState;
  /** True when this call rolled over into a new day and reset the daily counters. */
  newDay: boolean;
  /** True when the device clock reported a day EARLIER than one already seen. */
  wentBackwards: boolean;
}

/**
 * Move the economy's day forward if the device says a new day has started.
 *
 * Never moves backwards. A clock wound back reports an earlier day, which is
 * recorded as an anomaly and otherwise ignored — the player keeps the day they
 * had, along with whatever they have already spent of it. That is deliberately
 * neither a punishment nor a reward: a genuine timezone change should not cost
 * an honest player anything, and a deliberate one should not gain a cheat
 * anything either.
 */
export function advanceDay(state: EconomyState, now: number, tzOffsetMinutes: number): DayAdvance {
  const reported = reportedDayIndex(now, tzOffsetMinutes);

  // First ever stamp: adopt whatever the device says.
  if (state.dayIndex < 0) {
    return {
      economy: { ...state, dayIndex: reported, stonesEarnedToday: 0, stonesPurchasedToday: 0 },
      newDay: true,
      wentBackwards: false,
    };
  }

  if (reported > state.dayIndex) {
    return {
      economy: { ...state, dayIndex: reported, stonesEarnedToday: 0, stonesPurchasedToday: 0 },
      newDay: true,
      wentBackwards: false,
    };
  }

  if (reported < state.dayIndex) {
    return {
      economy: { ...state, clockAnomalies: state.clockAnomalies + 1 },
      newDay: false,
      wentBackwards: true,
    };
  }

  return { economy: state, newDay: false, wentBackwards: false };
}

/**
 * How many milliseconds of idle time to actually pay for, given when income was
 * last banked. Clamped at both ends: a clock jumped backwards pays nothing
 * rather than a negative amount, and no amount of elapsed time pays more than
 * the offline cap.
 */
export function payableIdleMs(lastCollectedAt: number, now: number, capHours: number): number {
  const elapsed = now - lastCollectedAt;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.min(elapsed, capHours * 60 * MS_PER_MINUTE);
}
