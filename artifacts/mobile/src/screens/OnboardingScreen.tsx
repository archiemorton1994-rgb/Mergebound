/**
 * The first-run flow, start to finish, on ONE route.
 *
 * Every step is a branch of the same screen rather than a route of its own, so
 * a player who force-quits mid-tutorial can never land on an address that
 * disagrees with the step saved in their file. The saved step is the single
 * source of truth for where they are; this screen just draws it.
 *
 * The order is deliberate and is the answer to "do we ask who they are first?"
 * — no. The player hatches, hatches again, and merges before the game asks them
 * for anything at all. Three taps, and they have already seen the best moment
 * the game has. Character creation comes after, when they have a reason to care
 * what their Binder looks like, and it opens wearing the colour of the creature
 * they just made. A form on a cold start is where first sessions go to die.
 *
 * Contains no game rules: the steps, the eggs and the naming all come from
 * src/game/onboarding.ts and src/art/binderArt.ts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MIN_TAP_TARGET, palette, radius, space, type } from '@/constants/tokens';
import { binderContent, getType } from '@/src/game/content';
import { mergeWithPity } from '@/src/game/merge';
import type { BinderAppearance, Creature } from '@/src/game/models';
import { nextStep, tutorialEggs } from '@/src/game/onboarding';
import { createRng } from '@/src/game/rng';
import {
  defaultAppearanceFor,
  generateBinderName,
  sanitizeBinderName,
} from '@/src/art/binderArt';
import { BinderSprite } from '@/src/screens/BinderSprite';
import { CreatureCard } from '@/src/screens/CreatureCard';
import { CreatureSprite } from '@/src/screens/CreatureSprite';
import { useCollection } from '@/src/screens/CollectionContext';
import { AppText, Button, Panel, haptics } from '@/src/screens/ui/kit';

/** One row of appearance choices. Preset-based: every option is one somebody supported. */
function OptionRow<T extends { id: string; name: string; color?: string }>({
  label,
  options,
  selectedId,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.optionRow}>
      <AppText variant="caption" color={palette.textMuted}>
        {label}
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionScroll}>
        {options.map((option) => {
          const selected = option.id === selectedId;
          return (
            <Pressable
              key={option.id}
              onPress={() => {
                haptics.tap();
                onSelect(option.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label}: ${option.name}`}
              style={[
                styles.option,
                option.color ? { backgroundColor: option.color } : null,
                selected && styles.optionSelected,
              ]}
            >
              {option.color ? null : (
                <AppText
                  variant="caption"
                  color={selected ? palette.text : palette.textSecondary}
                >
                  {option.name}
                </AppText>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function OnboardingScreen() {
  const router = useRouter();
  const {
    save,
    collection,
    addCreatures,
    applyMerge,
    setMergePity,
    setBinder,
    setOnboardingStep,
  } = useCollection();

  const step = save.onboarding.step;
  const eggs = useMemo(() => tutorialEggs(save.onboarding.seed), [save.onboarding.seed]);

  const [justHatched, setJustHatched] = useState<Creature | null>(null);
  const [appearance, setAppearance] = useState<BinderAppearance | null>(null);
  const [name, setName] = useState('');

  /** Which tutorial eggs have already been taken, by id — so the second choice cannot repeat the first. */
  const takenIds = collection.map((c) => c.id);
  const remainingEggs = eggs.filter((e) => !takenIds.includes(e.id));
  const onAnEggStep = step === 'first-egg' || step === 'second-egg';

  // Recovery from a save whose step and collection disagree. hatch() advances
  // both together so this should be unreachable, but a save written by an older
  // build can still arrive at an egg step with no eggs left to take — and that
  // branch has no button on it, while the onboarding guard sends every other
  // route straight back here. Stranding a player with no way out but deleting
  // their app data is the worst outcome in this file, so it gets a second lock.
  useEffect(() => {
    if (onAnEggStep && remainingEggs.length === 0) {
      setOnboardingStep(nextStep(step));
    }
  }, [onAnEggStep, remainingEggs.length, step, setOnboardingStep]);

  /**
   * Take an egg. The creature and the step advance TOGETHER.
   *
   * They used to move at different moments — the creature saved here, the step
   * only when the player tapped past the reveal — and a force-quit in between
   * saved one without the other. On resume the screen offered one egg fewer
   * while the step stayed put, and repeating that emptied the egg row entirely.
   * That branch has no button in it, and the onboarding guard sends every other
   * route back here, so the player was permanently stuck with no way out but
   * deleting their app data. Advancing both at once removes the window.
   */
  function hatch(egg: Creature) {
    haptics.celebrate();
    addCreatures([egg]);
    setJustHatched(egg);
    setOnboardingStep(nextStep(step));
  }

  /** Dismiss the reveal. The step already moved when the egg was taken. */
  function continueFromHatch() {
    haptics.tap();
    setJustHatched(null);
  }

  function doFirstMerge() {
    const [a, b] = collection;
    if (!a || !b) return;
    haptics.celebrate();
    const rng = createRng(save.onboarding.seed + 1);
    const { creature, mergesSincePerfectRoll } = mergeWithPity(a, b, rng, save.mergePity);
    applyMerge(a.id, b.id, creature);
    setMergePity(mergesSincePerfectRoll);
    // The Binder forms out of this merge already wearing its element — and this
    // is SAVED immediately, not just held in component state. A player who quits
    // between the merge and confirming their look would otherwise come back
    // wearing the default colour instead of the one they just made, which is
    // the whole point of the moment.
    const look = defaultAppearanceFor(creature.types[0] ?? 'ember');
    setAppearance(look);
    setBinder({ ...save.binder, appearance: look });
    setOnboardingStep(nextStep(step));
  }

  function confirmLook() {
    if (!appearance) return;
    haptics.press();
    setBinder({ ...save.binder, appearance });
    setName(generateBinderName(createRng(save.onboarding.seed + 2)));
    setOnboardingStep(nextStep(step));
  }

  function confirmName() {
    haptics.press();
    const cleaned = sanitizeBinderName(name, createRng(save.onboarding.seed + 3));
    setBinder({ name: cleaned, appearance: appearance ?? save.binder.appearance });
    setOnboardingStep(nextStep(step));
  }

  function startFirstBattle() {
    haptics.press();
    setOnboardingStep('complete');
    router.replace('/battle');
  }

  // --- the hatch reveal -----------------------------------------------------
  // Checked BEFORE the step branches, because taking an egg already advanced the
  // step. The reveal belongs to the creature in hand, not to a step.
  if (justHatched) {
    return (
      <View style={styles.stage}>
        <AppText variant="caption" color={palette.textMuted}>
          Something was inside
        </AppText>
        <CreatureCard creature={justHatched} />
        <AppText variant="body" color={palette.textSecondary} style={styles.centred}>
          Every one of its eight numbers was rolled just now, and rolled separately.
          Gold means a roll near the best it could have been.
        </AppText>
        <Button
          label={step === 'second-egg' ? 'Choose another' : 'Now fuse them'}
          onPress={continueFromHatch}
        />
      </View>
    );
  }

  // --- egg steps ------------------------------------------------------------
  if (step === 'first-egg' || step === 'second-egg') {
    if (remainingEggs.length === 0) {
      // Belt and braces against the lockout described on hatch(). The recovery
      // itself runs in the effect above — setting state during render wedges
      // the component, which is its own kind of stuck screen.
      return <View style={styles.stage} />;
    }

    return (
      <View style={styles.stage}>
        <AppText variant="caption" color={palette.textMuted}>
          {step === 'first-egg' ? 'The Sundering left debris' : 'One more'}
        </AppText>
        <AppText variant="display">
          {step === 'first-egg' ? 'Pick an egg' : 'Pick another'}
        </AppText>
        <AppText variant="body" color={palette.textSecondary}>
          {step === 'first-egg'
            ? 'Nobody knows what is inside one until it cracks. Not even you.'
            : 'Two Wardens can be fused into something stronger. You will need a second.'}
        </AppText>

        <View style={styles.eggRow}>
          {remainingEggs.map((egg) => (
            <Pressable
              key={egg.id}
              onPress={() => hatch(egg)}
              accessibilityRole="button"
              accessibilityLabel="Mystery egg"
              style={({ pressed }) => [styles.egg, pressed && styles.pressed]}
            >
              <View style={styles.eggShape} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // --- the first merge ------------------------------------------------------
  if (step === 'first-merge') {
    const [a, b] = collection;
    return (
      <View style={styles.stage}>
        <AppText variant="display">Fuse them</AppText>
        <AppText variant="body" color={palette.textSecondary}>
          Both Wardens go in. One comes out, a tier higher, with its numbers rolled again.
          This is the whole game.
        </AppText>
        <View style={styles.fuseRow}>
          {a ? <CreatureSprite creature={a} size={92} /> : null}
          <AppText variant="title" color={palette.interactive}>
            +
          </AppText>
          {b ? <CreatureSprite creature={b} size={92} /> : null}
        </View>
        <Button label="Merge — Free" onPress={doFirstMerge} />
        <AppText variant="caption" color={palette.textMuted} style={styles.centred}>
          Merging usually costs merge stones. Your first ones are on the house.
        </AppText>
      </View>
    );
  }

  // --- character creation ---------------------------------------------------
  if (step === 'binder-look') {
    // Falls back to the SAVED appearance rather than to a default, so a resumed
    // tutorial still shows the element the player's first creature gave them.
    const look = appearance ?? save.binder.appearance;
    const accentName = getType(look.accentTypeId).name;
    const set = (patch: Partial<BinderAppearance>) => setAppearance({ ...look, ...patch });

    return (
      <ScrollView contentContainerStyle={styles.scrollStage} showsVerticalScrollIndicator={false}>
        <AppText variant="caption" color={palette.textMuted}>
          The one who binds them
        </AppText>
        <AppText variant="display">And you?</AppText>
        <AppText variant="body" color={palette.textSecondary}>
          You will never fight — you direct from the sidelines, and what you wear makes your
          Wardens stronger. You are already wearing {accentName}, from the one you just made.
        </AppText>

        <Panel style={styles.portrait}>
          <BinderSprite binder={{ name: '', appearance: look }} size={168} />
        </Panel>

        <OptionRow label="Build" options={binderContent.builds} selectedId={look.buildId} onSelect={(id) => set({ buildId: id })} />
        <OptionRow label="Skin" options={binderContent.skinTones} selectedId={look.skinToneId} onSelect={(id) => set({ skinToneId: id })} />
        <OptionRow label="Hair" options={binderContent.hairStyles} selectedId={look.hairStyleId} onSelect={(id) => set({ hairStyleId: id })} />
        <OptionRow label="Hair colour" options={binderContent.hairColors} selectedId={look.hairColorId} onSelect={(id) => set({ hairColorId: id })} />
        <OptionRow label="Outfit" options={binderContent.outfits} selectedId={look.outfitId} onSelect={(id) => set({ outfitId: id })} />
        <OptionRow label="Cloth" options={binderContent.outfitTones} selectedId={look.outfitToneId} onSelect={(id) => set({ outfitToneId: id })} />
        <OptionRow label="Mark" options={binderContent.marks} selectedId={look.markId} onSelect={(id) => set({ markId: id })} />

        <Button label="This is me" onPress={confirmLook} />
      </ScrollView>
    );
  }

  // --- naming ---------------------------------------------------------------
  if (step === 'binder-name') {
    const look = appearance ?? save.binder.appearance;
    return (
      <View style={styles.stage}>
        <BinderSprite binder={{ name: '', appearance: look }} size={132} />
        <AppText variant="display">What do they call you?</AppText>
        <TextInput
          value={name}
          onChangeText={setName}
          style={styles.nameInput}
          placeholder="Your name"
          placeholderTextColor={palette.textDisabled}
          maxLength={40}
          accessibilityLabel="Your Binder's name"
          selectTextOnFocus
        />
        {/* Pre-filled, and keeping it is a proper button rather than a skip —
            an empty text field is where a first session gets abandoned. */}
        <Button label="Keep this name" onPress={confirmName} />
      </View>
    );
  }

  // --- handing over to the real battle screen -------------------------------
  return (
    <View style={styles.stage}>
      <AppText variant="display">One more thing</AppText>
      <AppText variant="body" color={palette.textSecondary}>
        A Discordant is stirring. Take your Warden and see what it can do — you will not
        lose it, whatever happens.
      </AppText>
      <Button label="Into battle" onPress={startFirstBattle} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: palette.background,
    padding: space.xl,
    justifyContent: 'center',
    gap: space.lg,
  },
  scrollStage: {
    backgroundColor: palette.background,
    padding: space.xl,
    paddingTop: space.xxl * 2,
    gap: space.md,
  },
  centred: {
    textAlign: 'center',
  },
  eggRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.lg,
    marginTop: space.lg,
  },
  egg: {
    padding: space.md,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: palette.border,
    backgroundColor: palette.surfaceRaised,
  },
  eggShape: {
    width: 62,
    height: 80,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderTopLeftRadius: 31,
    borderTopRightRadius: 31,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  fuseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  portrait: {
    alignItems: 'center',
    paddingVertical: space.lg,
  },
  optionRow: {
    gap: space.xs,
  },
  optionScroll: {
    gap: space.sm,
    paddingVertical: space.xs,
  },
  option: {
    minWidth: MIN_TAP_TARGET,
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: palette.surfaceRaised,
  },
  optionSelected: {
    borderColor: palette.interactive,
  },
  nameInput: {
    ...type.title,
    color: palette.text,
    backgroundColor: palette.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
});
