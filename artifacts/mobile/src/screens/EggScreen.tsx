/**
 * Slice 1 screen: eggs → select two → hatch → merge → result → collection.
 * Contains NO game rules — all hatching/merging comes from src/game/.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { palette, radius, space } from '@/constants/tokens';
import { AppText, Button, Screen, haptics } from '@/src/screens/ui/kit';
import { balance } from '@/src/game/content';
import { generateEggBatch } from '@/src/game/hatch';
import { MERGE_PITY_THRESHOLD, mergeWithPity } from '@/src/game/merge';
import { STAT_KEYS, type Creature, type Rng, type Stats } from '@/src/game/models';
import { createRng } from '@/src/game/rng';
import { CreatureCard } from '@/src/screens/CreatureCard';
import { useCollection } from '@/src/screens/CollectionContext';

type Phase = 'eggs' | 'hatched' | 'merged';

const haptic = haptics.press;

export function EggScreen() {
  const { collection, mergePity, loading, loadError, addCreatures, applyMerge, setMergePity } = useCollection();

  // One seeded rng per session batch. Reseeding happens on "New eggs".
  const [seed, setSeed] = useState(() => Date.now() % 0x7fffffff);
  const rng = useMemo<Rng>(() => createRng(seed), [seed]);
  const eggs = useMemo<Creature[]>(() => generateEggBatch(createRng(seed)), [seed]);

  const [phase, setPhase] = useState<Phase>('eggs');
  const [selected, setSelected] = useState<string[]>([]);
  const [hatched, setHatched] = useState<Creature[]>([]);
  const [result, setResult] = useState<Creature | null>(null);
  const [pityTriggered, setPityTriggered] = useState(false);

  function toggleEgg(id: string) {
    haptic();
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : prev.length < 2 ? [...prev, id] : prev,
    );
  }

  function hatchSelected() {
    haptic();
    const chosen = eggs.filter((e) => selected.includes(e.id));
    setHatched(chosen);
    addCreatures(chosen);
    setPhase('hatched');
  }

  function doMerge() {
    haptic();
    const [a, b] = hatched;
    if (!a || !b) return;
    const { creature, mergesSincePerfectRoll, pityTriggered: triggered } = mergeWithPity(a, b, rng, mergePity);
    applyMerge(a.id, b.id, creature);
    setMergePity(mergesSincePerfectRoll);
    setResult(creature);
    setPityTriggered(triggered);
    setPhase('merged');
  }

  function newBatch() {
    haptic();
    setSeed(Date.now() % 0x7fffffff);
    setSelected([]);
    setHatched([]);
    setResult(null);
    setPityTriggered(false);
    setPhase('eggs');
  }

  const parentAvg = useMemo<Stats | null>(() => {
    const [a, b] = hatched;
    if (!a || !b || !result) return null;
    const deltas = {} as Stats;
    for (const key of STAT_KEYS) {
      const avg = Math.round((a.stats[key] + b.stats[key]) / 2);
      deltas[key] = result.stats[key] - avg;
    }
    return deltas;
  }, [hatched, result]);

  if (loading) {
    return (
      <Screen scroll={false} contentStyle={styles.center}>
        <AppText color={palette.textMuted}>Loading your collection…</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="display">Hatchery</AppText>

      {loadError ? (
        <View style={styles.errorBox}>
          <AppText variant="bodyStrong" color={palette.danger}>
            Couldn&apos;t load saved data: {loadError}
          </AppText>
        </View>
      ) : null}

      {phase === 'eggs' ? (
        <View style={{ gap: space.md }}>
          <AppText variant="heading">Pick two of {balance.eggsPerBatch} eggs to hatch</AppText>
          <View style={styles.eggGrid}>
            {eggs.map((egg) => {
              const isSelected = selected.includes(egg.id);
              return (
                <Pressable
                  key={egg.id}
                  onPress={() => toggleEgg(egg.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={isSelected ? 'Selected egg' : 'Mystery egg'}
                  style={({ pressed }) => [
                    styles.egg,
                    isSelected && styles.eggSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  {/* Every egg looks identical on purpose. Painting it in the
                      colour of the type inside gives the answer away before the
                      player has chosen, which throws away the best moment the
                      game has. The reveal has to be a reveal. */}
                  <View style={[styles.eggShape, isSelected && styles.eggShapeSelected]} />
                  <AppText
                    variant={isSelected ? 'bodyStrong' : 'body'}
                    color={isSelected ? palette.text : palette.textSecondary}
                  >
                    {isSelected ? 'Selected' : 'Mystery egg'}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <Button
            label={selected.length === 2 ? 'Hatch both eggs' : `Select ${2 - selected.length} more`}
            disabled={selected.length !== 2}
            onPress={hatchSelected}
          />
        </View>
      ) : null}

      {phase === 'hatched' ? (
        <View style={{ gap: space.md }}>
          <AppText variant="heading">They hatched!</AppText>
          {hatched.map((c) => (
            <CreatureCard key={c.id} creature={c} />
          ))}
          <AppText variant="caption" color={palette.perfect} style={styles.centreText}>
            {mergePity + 1 >= MERGE_PITY_THRESHOLD
              ? 'This merge is guaranteed a perfect roll!'
              : `${MERGE_PITY_THRESHOLD - mergePity - 1} more merge${MERGE_PITY_THRESHOLD - mergePity - 1 === 1 ? '' : 's'} until a guaranteed perfect roll`}
          </AppText>
          <Button label="Merge these two" onPress={doMerge} />
        </View>
      ) : null}

      {phase === 'merged' && result ? (
        <View style={{ gap: space.md }}>
          <AppText variant="heading">Merge result</AppText>
          {pityTriggered ? (
            <View style={styles.pityBanner}>
              <AppText variant="bodyStrong" color={palette.perfect}>
                Perfect roll guaranteed! ✦
              </AppText>
            </View>
          ) : null}
          <CreatureCard creature={result} deltas={parentAvg ?? undefined} />
          <AppText variant="caption" color={palette.textMuted}>
            Stat changes shown against the average of its two parents. Both parents were
            consumed; the result is in your collection.
          </AppText>
          <AppText variant="heading">Its parents were</AppText>
          {hatched.map((c) => (
            <CreatureCard key={c.id} creature={c} compact />
          ))}
          <Button label="New eggs" onPress={newBatch} />
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <AppText variant="heading">Collection ({collection.length})</AppText>
        {collection.length === 0 ? (
          <AppText variant="body" color={palette.textMuted}>
            No creatures yet. Hatch and merge to start your collection.
          </AppText>
        ) : (
          collection
            .slice()
            .reverse()
            .map((c) => <CreatureCard key={c.id} creature={c} compact />)
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centreText: {
    textAlign: 'center',
  },
  eggGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  egg: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 2,
    borderColor: palette.border,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: palette.surfaceRaised,
  },
  eggSelected: {
    borderColor: palette.interactive,
    backgroundColor: 'rgba(155,130,255,0.16)',
  },
  eggShape: {
    width: 44,
    height: 56,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  eggShapeSelected: {
    backgroundColor: palette.interactive,
    borderColor: palette.interactive,
  },
  errorBox: {
    backgroundColor: 'rgba(255,107,107,0.16)',
    borderRadius: radius.sm,
    padding: space.md,
  },
  pressed: {
    opacity: 0.8,
  },
  pityBanner: {
    backgroundColor: 'rgba(255,217,102,0.16)',
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
});
