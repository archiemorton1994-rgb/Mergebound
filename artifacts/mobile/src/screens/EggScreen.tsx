/**
 * Slice 1 screen: eggs → select two → hatch → merge → result → collection.
 * Contains NO game rules — all hatching/merging comes from src/game/.
 */

import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { balance, getType } from '@/src/game/content';
import { generateEggBatch } from '@/src/game/hatch';
import { MERGE_PITY_THRESHOLD, mergeWithPity } from '@/src/game/merge';
import { STAT_KEYS, type Creature, type Rng, type Stats } from '@/src/game/models';
import { createRng } from '@/src/game/rng';
import { CreatureCard } from '@/src/screens/CreatureCard';
import { useCollection } from '@/src/screens/CollectionContext';

type Phase = 'eggs' | 'hatched' | 'merged';

function haptic() {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

export function EggScreen() {
  const insets = useSafeAreaInsets();
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

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = (Platform.OS === 'web' ? 34 : insets.bottom) + 24;

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
      <View style={[styles.container, styles.center]}>
        <Text style={styles.mutedText}>Loading your collection…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad, paddingHorizontal: 16, gap: 20 }}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Hatchery</Text>
        <Link href="/battle" style={styles.navLink}>
          Battle
        </Link>
      </View>
      {loadError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Couldn't load saved data: {loadError}</Text>
        </View>
      ) : null}

      {phase === 'eggs' ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.sectionLabel}>
            Pick two of {balance.eggsPerBatch} eggs to hatch
          </Text>
          <View style={styles.eggGrid}>
            {eggs.map((egg) => {
              const isSelected = selected.includes(egg.id);
              const color = getType(egg.types[0] ?? 'ember').color;
              return (
                <Pressable
                  key={egg.id}
                  onPress={() => toggleEgg(egg.id)}
                  style={({ pressed }) => [
                    styles.egg,
                    { borderColor: color },
                    isSelected && { backgroundColor: color },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.eggShape, { backgroundColor: isSelected ? 'rgba(255,255,255,0.35)' : color }]} />
                  <Text style={[styles.eggLabel, isSelected && styles.eggLabelSelected]}>
                    {isSelected ? 'Selected' : 'Mystery egg'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <PrimaryButton
            label={selected.length === 2 ? 'Hatch both eggs' : `Select ${2 - selected.length} more`}
            disabled={selected.length !== 2}
            onPress={hatchSelected}
          />
        </View>
      ) : null}

      {phase === 'hatched' ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.sectionLabel}>They hatched!</Text>
          {hatched.map((c) => (
            <CreatureCard key={c.id} creature={c} />
          ))}
          <Text style={styles.pityText}>
            {mergePity + 1 >= MERGE_PITY_THRESHOLD
              ? 'This merge is guaranteed a perfect roll!'
              : `${MERGE_PITY_THRESHOLD - mergePity - 1} more merge${MERGE_PITY_THRESHOLD - mergePity - 1 === 1 ? '' : 's'} until a guaranteed perfect roll`}
          </Text>
          <PrimaryButton label="Merge these two" onPress={doMerge} />
        </View>
      ) : null}

      {phase === 'merged' && result ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.sectionLabel}>Merge result</Text>
          {pityTriggered ? (
            <View style={styles.pityBanner}>
              <Text style={styles.pityBannerText}>Perfect roll guaranteed! ✦</Text>
            </View>
          ) : null}
          <CreatureCard creature={result} deltas={parentAvg ?? undefined} />
          <Text style={styles.mutedText}>
            Stat changes shown against the average of its two parents. Both parents were
            consumed; the result is in your collection.
          </Text>
          <Text style={styles.sectionLabel}>Its parents were</Text>
          {hatched.map((c) => (
            <CreatureCard key={c.id} creature={c} compact />
          ))}
          <PrimaryButton label="New eggs" onPress={newBatch} />
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Text style={styles.sectionLabel}>Collection ({collection.length})</Text>
        {collection.length === 0 ? (
          <Text style={styles.mutedText}>
            No creatures yet. Hatch and merge to start your collection.
          </Text>
        ) : (
          collection
            .slice()
            .reverse()
            .map((c) => <CreatureCard key={c.id} creature={c} compact />)
        )}
      </View>
    </ScrollView>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#151322',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
  },
  navLink: {
    color: '#7C5CFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  mutedText: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  eggGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  egg: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  eggShape: {
    width: 44,
    height: 56,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  eggLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  eggLabelSelected: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
  },
  button: {
    backgroundColor: '#7C5CFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  buttonText: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  buttonTextDisabled: {
    color: 'rgba(255,255,255,0.4)',
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderRadius: 10,
    padding: 10,
  },
  errorText: {
    color: '#ffb4b4',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  pressed: {
    opacity: 0.8,
  },
  pityText: {
    color: '#ffd966',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textAlign: 'center',
  },
  pityBanner: {
    backgroundColor: 'rgba(255,217,102,0.18)',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  pityBannerText: {
    color: '#ffd966',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
});
