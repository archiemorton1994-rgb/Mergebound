/**
 * Tests for the first-run flow (src/game/onboarding.ts).
 *
 * The thing being proved here is almost entirely about interruption: a phone
 * that dies, a call that comes in, an app that gets swiped away mid-tutorial.
 * Every test below is some version of "the player comes back and finds exactly
 * what they left", plus the two things that must never happen — an existing
 * player being sent back to the egg tutorial, and a redirect that loops.
 */

import { describe, expect, it } from 'vitest';
import { balance } from '../content';
import type { OnboardingState, OnboardingStep } from '../models';
import {
  BATTLE_ROUTE,
  ONBOARDING_ROUTE,
  ONBOARDING_STEPS,
  freshOnboardingSeed,
  isComplete,
  markTipSeen,
  nextStep,
  onboardingRedirectTarget,
  shouldShowTip,
  stepForExistingSave,
  tutorialEggs,
} from '../onboarding';
import { stampFreshSave, withDefaults } from '../save';
import { makeCreature } from './helpers';

/** A plausible install time and the day it falls on. Any two moments would do. */
const INSTALLED_AT = 1_700_000_000_000;
const INSTALL_DAY = 19675;

/** A saved tutorial part-way through, with everything a test doesn't care about defaulted. */
function makeOnboarding(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { step: 'first-egg', seed: 4242, seenTips: [], ...overrides };
}

const finished = makeOnboarding({ step: 'complete' });

describe('onboarding: the steps run in a fixed order', () => {
  it('the tutorial starts on the first egg and finishes after the first battle', () => {
    expect(ONBOARDING_STEPS[0]).toBe('first-egg');
    expect(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]).toBe('complete');
    expect(nextStep('first-battle')).toBe('complete');
  });

  it('every step leads to the next one, in the order the tutorial is played', () => {
    expect(nextStep('first-egg')).toBe('second-egg');
    expect(nextStep('second-egg')).toBe('first-merge');
    expect(nextStep('first-merge')).toBe('binder-look');
    expect(nextStep('binder-look')).toBe('binder-name');
    expect(nextStep('binder-name')).toBe('first-battle');
  });

  it('a finished tutorial never starts over from the first egg', () => {
    expect(nextStep('complete')).toBe('complete');
  });

  it('the tutorial only counts as complete on its very last step', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(isComplete(makeOnboarding({ step }))).toBe(step === 'complete');
    }
  });
});

describe('onboarding: the eggs a resumed tutorial offers', () => {
  it('the tutorial always offers the same eggs when resumed', () => {
    const firstVisit = tutorialEggs(4242);
    const afterAForceQuit = tutorialEggs(4242);
    expect(afterAForceQuit).toEqual(firstVisit);
  });

  it('the tutorial offers exactly as many eggs as the balance file asks for', () => {
    expect(tutorialEggs(7)).toHaveLength(balance.tutorial.eggCount);
  });

  it('every egg the tutorial offers is a brand-new tier-zero creature with one type', () => {
    for (const egg of tutorialEggs(99)) {
      expect(egg.tier).toBe(0);
      expect(egg.types).toHaveLength(1);
      expect(egg.parentIds).toEqual([]);
    }
  });

  it('someone who force-quits after their first egg comes back to their second egg', () => {
    const saved = makeOnboarding({ step: nextStep('first-egg') });
    expect(saved.step).toBe('second-egg');
    // Reopening the app lands them back in the tutorial, not in the game...
    expect(onboardingRedirectTarget(saved, '/')).toBe(ONBOARDING_ROUTE);
    // ...and the eggs waiting for them are the same ones they were choosing from.
    expect(tutorialEggs(saved.seed)).toEqual(tutorialEggs(4242));
  });
});

describe('onboarding: every player gets their own eggs, drawn once', () => {
  it('two players who install the game at different moments do not get the same eggs', () => {
    const mine = tutorialEggs(freshOnboardingSeed(INSTALLED_AT));
    const theirs = tutorialEggs(freshOnboardingSeed(INSTALLED_AT + 60_000));
    expect(theirs).not.toEqual(mine);
  });

  it('a new save is never left on the unseeded zero that would give everybody identical eggs', () => {
    // 0 is the "never drawn" marker; 4294967296 is where the conversion to a
    // 32-bit seed wraps back around onto it. Both have to come out non-zero.
    for (const installedAt of [0, 1, 4_294_967_296, INSTALLED_AT]) {
      expect(freshOnboardingSeed(installedAt), `installed at ${installedAt}`).not.toBe(0);
    }
  });

  it('a brand-new save comes out of storage with its tutorial eggs already decided', () => {
    const fresh = stampFreshSave(
      withDefaults({ collection: [], mergePity: 0 }),
      INSTALLED_AT,
      INSTALL_DAY,
    );
    expect(fresh.onboarding.seed).not.toBe(0);
    expect(tutorialEggs(fresh.onboarding.seed)).toHaveLength(balance.tutorial.eggCount);
  });

  it('reopening the app part-way through the tutorial does not swap the eggs for different ones', () => {
    const started = stampFreshSave(
      withDefaults({ collection: [], mergePity: 0 }),
      INSTALLED_AT,
      INSTALL_DAY,
    );
    const reopenedTheNextDay = stampFreshSave(started, INSTALLED_AT + 86_400_000, INSTALL_DAY + 1);
    expect(reopenedTheNextDay.onboarding.seed).toBe(started.onboarding.seed);
  });

  it('an existing player is not handed tutorial eggs they will never be shown', () => {
    const veteran = stampFreshSave(
      withDefaults({ collection: [makeCreature()], mergePity: 0 }),
      INSTALLED_AT,
      INSTALL_DAY,
    );
    expect(veteran.onboarding.step).toBe('complete');
    expect(veteran.onboarding.seed).toBe(0);
  });
});

describe('onboarding: where an unfinished tutorial sends the player', () => {
  it('an unfinished tutorial pulls the player back to it from anywhere else', () => {
    const unfinished = ONBOARDING_STEPS.filter((step) => step !== 'complete');
    for (const step of unfinished) {
      const state = makeOnboarding({ step });
      expect(onboardingRedirectTarget(state, '/')).toBe(ONBOARDING_ROUTE);
      expect(onboardingRedirectTarget(state, '/store')).toBe(ONBOARDING_ROUTE);
    }
  });

  it('a player already on the tutorial screen is left alone, so it cannot loop', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(onboardingRedirectTarget(makeOnboarding({ step }), ONBOARDING_ROUTE)).toBeNull();
    }
  });

  it('the last step lets the player be on the real battle screen', () => {
    const state = makeOnboarding({ step: 'first-battle' });
    expect(onboardingRedirectTarget(state, BATTLE_ROUTE)).toBeNull();
  });

  it('the battle screen still counts as the battle screen with a stage attached to it', () => {
    const state = makeOnboarding({ step: 'first-battle' });
    expect(onboardingRedirectTarget(state, '/battle?stageId=cinderreach-1')).toBeNull();
    expect(onboardingRedirectTarget(state, '/battle/')).toBeNull();
  });

  it('the battle screen is out of bounds until the tutorial reaches the first battle', () => {
    const beforeTheBattle = ONBOARDING_STEPS.slice(0, ONBOARDING_STEPS.indexOf('first-battle'));
    for (const step of beforeTheBattle) {
      const state = makeOnboarding({ step });
      expect(onboardingRedirectTarget(state, BATTLE_ROUTE), step).toBe(ONBOARDING_ROUTE);
      expect(onboardingRedirectTarget(state, '/battle?stageId=cinderreach-1'), step).toBe(
        ONBOARDING_ROUTE,
      );
    }
  });

  it('wherever the tutorial sends the player, it leaves them there', () => {
    // The no-loop guarantee stated the way it actually matters: one redirect is
    // always enough. If this ever fails the app does not show an error — it sits
    // on a blank screen redirecting to itself forever.
    for (const step of ONBOARDING_STEPS) {
      for (const path of ['/', '/store', '/battle', '/quest?region=thornwake', ONBOARDING_ROUTE]) {
        const target = onboardingRedirectTarget(makeOnboarding({ step }), path);
        if (target === null) continue;
        expect(
          onboardingRedirectTarget(makeOnboarding({ step }), target),
          `${step}: ${path} -> ${target}`,
        ).toBeNull();
      }
    }
  });

  it('finishing the last step leaves the player free to go anywhere', () => {
    for (const path of ['/', '/battle', '/store', ONBOARDING_ROUTE, '/quest?region=thornwake']) {
      expect(onboardingRedirectTarget(finished, path)).toBeNull();
    }
  });
});

describe('onboarding: players who were already here before the tutorial existed', () => {
  it('an existing player is never sent into the tutorial', () => {
    expect(stepForExistingSave([makeCreature()])).toBe('complete');
    expect(isComplete(makeOnboarding({ step: stepForExistingSave([makeCreature()]) }))).toBe(true);
  });

  it('someone who installed the game and never hatched anything still gets the tutorial', () => {
    expect(stepForExistingSave([])).toBe('first-egg');
  });
});

describe('onboarding: tips are taught by doing, once', () => {
  it('a tip is shown once and never again', () => {
    const before = makeOnboarding({ step: 'complete' });
    expect(shouldShowTip(before, 'lock-a-creature')).toBe(true);
    const after = markTipSeen(before, 'lock-a-creature');
    expect(shouldShowTip(after, 'lock-a-creature')).toBe(false);
  });

  it('seeing one tip does not use up a different one', () => {
    const after = markTipSeen(finished, 'lock-a-creature');
    expect(shouldShowTip(after, 'buy-merge-stones')).toBe(true);
  });

  it('a tip never interrupts the tutorial', () => {
    const unfinished = ONBOARDING_STEPS.filter((step) => step !== 'complete');
    for (const step of unfinished) {
      expect(shouldShowTip(makeOnboarding({ step }), 'lock-a-creature')).toBe(false);
    }
  });

  it('the same tip is never recorded twice', () => {
    const once = markTipSeen(finished, 'lock-a-creature');
    const twice = markTipSeen(once, 'lock-a-creature');
    expect(twice.seenTips).toEqual(['lock-a-creature']);
  });

  it('recording a tip leaves the rest of the saved tutorial exactly as it was', () => {
    const before = makeOnboarding({ step: 'complete', seed: 1234 });
    const after = markTipSeen(before, 'lock-a-creature');
    expect(after.step).toBe(before.step);
    expect(after.seed).toBe(before.seed);
    // The original must not have been edited in place — the save is one object.
    expect(before.seenTips).toEqual([]);
  });
});

describe('onboarding: the step list matches the saved shape', () => {
  it('every step the save file can hold is somewhere in the tutorial order', () => {
    const everyStep: OnboardingStep[] = [
      'first-egg',
      'second-egg',
      'first-merge',
      'binder-look',
      'binder-name',
      'first-battle',
      'complete',
    ];
    for (const step of everyStep) {
      expect(ONBOARDING_STEPS).toContain(step);
    }
    expect(ONBOARDING_STEPS).toHaveLength(everyStep.length);
  });
});
