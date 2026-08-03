/**
 * The first-run flow's rules. Pure functions — no React, no UI imports, and no
 * clock. Everything here is derived from the saved OnboardingState, which is
 * why force-quitting anywhere in the tutorial resumes exactly where it left
 * off instead of starting over or dumping the player into a half-set-up game.
 *
 * The whole tutorial lives behind ONE route (app/onboarding.tsx switches on the
 * step). That is not a layout preference: with a route per step, a resumed save
 * could land on a route that disagrees with the saved step, and the redirect
 * below would bounce between the two forever. One route means the saved step is
 * the only thing that decides what is on screen, so they cannot disagree.
 */

import { balance } from './content';
import { generateEggBatch } from './hatch';
import type { Creature, OnboardingState, OnboardingStep } from './models';
import { createRng } from './rng';

/**
 * The tutorial's steps, in the order they are played. This array is the order —
 * nextStep walks it rather than hard-coding a chain of cases, so inserting a
 * step is a one-line change here and nowhere else.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'first-egg',
  'second-egg',
  'first-merge',
  'binder-look',
  'binder-name',
  'first-battle',
  'complete',
];

/** The single route the whole tutorial is drawn on. */
export const ONBOARDING_ROUTE = '/onboarding';

/**
 * The real battle screen. The tutorial's last beat hands control to it rather
 * than faking a fight, so this is the one address outside the tutorial that an
 * unfinished tutorial is allowed to be on.
 */
export const BATTLE_ROUTE = '/battle';

/** Has the player finished the first-run flow and been let loose on the game? */
export function isComplete(state: OnboardingState): boolean {
  return state.step === 'complete';
}

/**
 * The step that follows this one.
 *
 * 'complete' is terminal and stays terminal. Walking off the end of the list
 * would either throw or wrap around to 'first-egg', and wrapping would drop a
 * finished player back into the egg tutorial with a full collection already in
 * hand — the one thing the whole module exists to prevent.
 */
export function nextStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  if (index < 0 || index >= ONBOARDING_STEPS.length - 1) return 'complete';
  return ONBOARDING_STEPS[index + 1] ?? 'complete';
}

/**
 * Every address an unfinished tutorial is allowed to sit on at a given step.
 * Only the first battle has a second one, because only the first battle leaves
 * the tutorial's own screen.
 */
function allowedPaths(step: OnboardingStep): readonly string[] {
  return step === 'first-battle' ? [ONBOARDING_ROUTE, BATTLE_ROUTE] : [ONBOARDING_ROUTE];
}

/**
 * Reduce a router path to just its screen. The tutorial's battle is pushed as
 * `/battle?stageId=…`, so the query string has to come off before comparing, and
 * a trailing slash is the same screen as none.
 */
function screenOf(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? '';
  const withSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

/**
 * Where an unfinished tutorial must send the player, or null if they are free
 * to be where they are.
 *
 * Returning null when the player is ALREADY on an allowed route is the whole
 * safety property here: a redirect that fires on the route it redirects to is
 * an infinite loop, and on a phone that is a frozen white screen rather than a
 * visible error. Callers can therefore run this on every navigation without
 * having to reason about whether it is safe to.
 */
export function onboardingRedirectTarget(
  state: OnboardingState,
  currentPath: string,
): string | null {
  if (isComplete(state)) return null;
  if (allowedPaths(state.step).includes(screenOf(currentPath))) return null;
  return ONBOARDING_ROUTE;
}

/**
 * Draw the seed that fixes one player's tutorial eggs. The moment they started
 * is a PARAMETER — no clock is read in here, same as clock.ts.
 *
 * Something has to draw this or the saved default of 0 survives into play and
 * every player on earth opens the game to the same three eggs. That is not a
 * theoretical worry: nothing else in the codebase ever writes a non-zero seed,
 * so 0 is what ships unless this is called. `stampFreshSave` is the caller,
 * because it is the one function in the game that sees the clock.
 *
 * Zero is reserved to mean "never drawn" — that is how a fresh save asks for a
 * seed at all — so a draw that lands on it has to move. If it did not, the seed
 * would look unset again on the next launch and a player would resume their
 * tutorial in front of three different eggs, which is the exact thing the whole
 * resume mechanism exists to prevent.
 */
export function freshOnboardingSeed(startedAt: number): number {
  // Stored exactly as createRng will consume it — rng.ts does `seed >>> 0`, so
  // going through the same conversion here means the number in the save file is
  // the number that gets replayed, with no rounding in between.
  const drawn = Number.isFinite(startedAt) ? startedAt >>> 0 : 1;
  return drawn === 0 ? 1 : drawn;
}

/**
 * The fixed eggs the tutorial offers, derived entirely from the seed stored in
 * the save (drawn once by freshOnboardingSeed). Same seed in, same eggs out,
 * forever — which is what lets the tutorial show a player the exact eggs they
 * were looking at when their phone died mid-choice, rather than a fresh set
 * that makes the interrupted choice meaningless.
 */
export function tutorialEggs(seed: number): Creature[] {
  const wanted = balance.tutorial.eggCount;
  const rng = createRng(seed);
  const eggs: Creature[] = [];
  // generateEggBatch draws balance.eggsPerBatch at a time, which is a different
  // number from the tutorial's on purpose (see balance.json) — the hatchery can
  // be retuned without touching the first screen anybody sees. Drawing whole
  // batches and trimming stays correct however far apart those two numbers get.
  while (eggs.length < wanted) {
    const batch = generateEggBatch(rng);
    // A zero-length batch would spin here forever on a bad edit to balance.json.
    if (batch.length === 0) break;
    eggs.push(...batch);
  }
  return eggs.slice(0, wanted);
}

/**
 * The steps that put eggs in front of the player, in the order they are played.
 * One egg is opened per step, so this list is also "how many of the tutorial's
 * eggs the player is meant to end up holding before the first merge" — which is
 * deliberately NOT the same number as how many eggs are laid out to choose from
 * (balance.json's tutorial.eggCount). Two of three get opened; the third is the
 * one they said no to, and that is what makes it a choice.
 */
export const TUTORIAL_EGG_STEPS: readonly OnboardingStep[] = ['first-egg', 'second-egg'];

/** Is this a step where the player is being asked to tap an egg? */
export function isTutorialEggStep(step: OnboardingStep): boolean {
  return TUTORIAL_EGG_STEPS.includes(step);
}

/** Where the tutorial goes once the eggs are done with. Derived from the step order, never restated. */
function stepAfterTutorialEggs(): OnboardingStep {
  const last = TUTORIAL_EGG_STEPS[TUTORIAL_EGG_STEPS.length - 1];
  return last === undefined ? 'complete' : nextStep(last);
}

/**
 * The tutorial eggs that are still on offer: the ones the player has not
 * already opened, matched by id against what they own.
 *
 * This is a game rule and it lives here rather than in the screen, for the
 * usual reason plus a specific one: a screen that works out for itself which
 * eggs are left has no way of noticing when the answer is "none of them", and
 * an egg step with no eggs is a screen with nothing on it to press.
 */
export function tutorialEggsRemaining(seed: number, collection: Creature[]): Creature[] {
  const owned = new Set(collection.map((c) => c.id));
  return tutorialEggs(seed).filter((egg) => !owned.has(egg.id));
}

/**
 * The step a save should ACTUALLY be showing, given what the player already
 * owns — the saved step reconciled with the saved collection.
 *
 * Why this has to exist: hatching writes a creature to the save the instant the
 * egg is tapped, but the step only moves on when the player presses past the
 * reveal. Force-quitting while the new creature is on screen therefore persists
 * a creature without persisting the step, and the two disagree from then on.
 * The player resumes on the same egg step with one fewer egg in front of them,
 * and doing it again empties the row entirely: an egg step with no eggs, no
 * button, and a redirect guard that puts them straight back on it if they try
 * to leave. That is a new player permanently unable to play, fixable only by
 * deleting the app's data.
 *
 * The rule that closes it: progress is counted from the collection (which is
 * written first and never lies) rather than from the step (which can lag by one
 * write). A step whose eggs are used up resolves FORWARD to the merge instead
 * of drawing an empty choice, so there is always something to press.
 *
 * Deliberately only egg steps are reconciled. After the merge the parents are
 * consumed, so "how many tutorial eggs do they still hold" stops describing
 * progress and would send a player who had already merged back to the start.
 */
export function stepForTutorialProgress(
  state: OnboardingState,
  collection: Creature[],
): OnboardingStep {
  if (!isTutorialEggStep(state.step)) return state.step;

  const offered = tutorialEggs(state.seed).length;
  const remaining = tutorialEggsRemaining(state.seed, collection).length;
  const opened = offered - remaining;

  // Nothing left to choose from, or they already opened one per egg step: the
  // egg phase is over however the step got out of step with the collection.
  if (remaining <= 0 || opened >= TUTORIAL_EGG_STEPS.length) return stepAfterTutorialEggs();
  return TUTORIAL_EGG_STEPS[opened] ?? stepAfterTutorialEggs();
}

/**
 * Should this one-off tip be shown?
 *
 * Two rules, and they are the same rule twice: never teach the same thing
 * twice, and never teach over the top of the tutorial. While the first-run flow
 * is running it is already the only voice on screen — a tip layered on top of it
 * is the modal wall of text this game deliberately does not have. Tips exist
 * for the things the tutorial leaves for later, so they start after it ends.
 */
export function shouldShowTip(state: OnboardingState, tipId: string): boolean {
  if (!isComplete(state)) return false;
  return !state.seenTips.includes(tipId);
}

/**
 * Record that a tip has been shown. Returns a new state rather than mutating,
 * and returns the SAME object when nothing changed — the save is one piece of
 * React state (see CollectionContext), so handing back an unchanged reference
 * is what stops a re-shown tip triggering a pointless write to storage.
 */
export function markTipSeen(state: OnboardingState, tipId: string): OnboardingState {
  if (state.seenTips.includes(tipId)) return state;
  return { ...state, seenTips: [...state.seenTips, tipId] };
}

/**
 * Which step a save that predates the tutorial should start at.
 *
 * A player who already owns creatures is complete: sending someone with a
 * collection back to "tap your first egg" is worse than showing them nothing at
 * all. Someone who installed the game and never hatched anything has nothing to
 * lose and still gets their tutorial.
 */
export function stepForExistingSave(collection: Creature[]): OnboardingStep {
  return collection.length > 0 ? 'complete' : 'first-egg';
}
