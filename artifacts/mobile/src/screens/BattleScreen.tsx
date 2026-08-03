/**
 * Slice 2 screen: pick up to 3 creatures from the collection, fight a
 * generated enemy party, see the result and a plain-English log.
 * Contains NO battle rules — all resolution comes from src/game/battle.ts
 * and src/game/encounter.ts.
 */

import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { runBattle, type BattleLogEntry, type BattleResult } from '@/src/game/battle';
import { generateEnemyParty } from '@/src/game/encounter';
import type { Creature } from '@/src/game/models';
import { createRng } from '@/src/game/rng';
import { CreatureCard } from '@/src/screens/CreatureCard';
import { useCollection } from '@/src/screens/CollectionContext';

const PARTY_SIZE = 3;

function haptic() {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

function formatLogEntry(entry: BattleLogEntry): string {
  const who = entry.actorSide === 'player' ? entry.actorName : `Enemy ${entry.actorName}`;
  const whom = entry.targetName === 'the party' ? 'the party' : entry.targetName;
  if (!entry.hit) {
    return `${who} used ${entry.moveName} on ${whom} — missed!`;
  }
  if (entry.moveKind === 'heal') {
    return `${who} used ${entry.moveName}, healing ${whom} for ${entry.healed}`;
  }
  const critText = entry.crit ? ' (crit!)' : '';
  const drainText = entry.moveKind === 'drain' && entry.healed > 0 ? `, healing itself for ${entry.healed}` : '';
  const faintText = entry.targetFainted ? ' — fainted!' : '';
  return `${who} used ${entry.moveName} on ${whom} for ${entry.damage} damage${critText}${drainText}${faintText}`;
}

export function BattleScreen() {
  const insets = useSafeAreaInsets();
  const { collection } = useCollection();

  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [enemyParty, setEnemyParty] = useState<Creature[] | null>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = (Platform.OS === 'web' ? 34 : insets.bottom) + 24;

  const selectedCreatures = useMemo(
    () => collection.filter((c) => selected.includes(c.id)),
    [collection, selected],
  );

  function toggleSelect(id: string) {
    haptic();
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : prev.length < PARTY_SIZE ? [...prev, id] : prev,
    );
  }

  function fight() {
    haptic();
    const avgTier = Math.round(
      selectedCreatures.reduce((sum, c) => sum + c.tier, 0) / selectedCreatures.length,
    );
    const rng = createRng(Date.now() % 0x7fffffff);
    const enemies = generateEnemyParty(rng, avgTier, selectedCreatures.length);
    setEnemyParty(enemies);
    setResult(runBattle(selectedCreatures, enemies, rng));
  }

  function reset() {
    haptic();
    setResult(null);
    setEnemyParty(null);
    setSelected([]);
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad, paddingHorizontal: 16, gap: 20 }}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Battle</Text>
        <Link href="/" style={styles.navLink}>
          Hatchery
        </Link>
      </View>

      {!result ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.sectionLabel}>
            Pick up to {PARTY_SIZE} creatures ({selected.length}/{PARTY_SIZE})
          </Text>
          {collection.length === 0 ? (
            <Text style={styles.mutedText}>
              No creatures yet — hatch and merge a few from the Hatchery first.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {collection
                .slice()
                .reverse()
                .map((c) => (
                  <Pressable key={c.id} onPress={() => toggleSelect(c.id)}>
                    <View style={selected.includes(c.id) ? styles.selectedRing : undefined}>
                      <CreatureCard creature={c} compact />
                    </View>
                  </Pressable>
                ))}
            </View>
          )}
          <PrimaryButton label="Fight" disabled={selected.length === 0} onPress={fight} />
        </View>
      ) : (
        <View style={{ gap: 16 }}>
          <View style={[styles.resultBanner, result.winner === 'player' ? styles.resultWin : styles.resultLoss]}>
            <Text style={styles.resultText}>
              {result.winner === 'player' ? 'Victory!' : 'Defeated...'}
            </Text>
            <Text style={styles.mutedText}>{result.rounds} rounds</Text>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>Your party</Text>
            {selectedCreatures.map((c) => (
              <CreatureCard key={c.id} creature={c} compact />
            ))}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>Enemy party</Text>
            {(enemyParty ?? []).map((c) => (
              <CreatureCard key={c.id} creature={c} compact />
            ))}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>Battle log</Text>
            <View style={styles.logBox}>
              {result.log.map((entry, i) => (
                <Text key={i} style={styles.logLine}>
                  {formatLogEntry(entry)}
                </Text>
              ))}
            </View>
          </View>

          <PrimaryButton label="New Battle" onPress={reset} />
        </View>
      )}
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
  selectedRing: {
    borderWidth: 2,
    borderColor: '#7C5CFF',
    borderRadius: 18,
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
  pressed: {
    opacity: 0.8,
  },
  resultBanner: {
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  resultWin: {
    backgroundColor: 'rgba(76,159,112,0.28)',
  },
  resultLoss: {
    backgroundColor: 'rgba(228,87,46,0.28)',
  },
  resultText: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
  },
  logBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  logLine: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
});
