/**
 * Placeholder creature visual: a coloured rounded rectangle showing
 * name, tier, types and stats as text. Colour comes from the creature's
 * primary type (defined in src/data/types.json). No image assets.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getType } from '@/src/game/content';
import type { Creature } from '@/src/game/models';

interface Props {
  creature: Creature;
  /** Optional per-stat deltas vs. something (used for the merge result). */
  deltas?: { hp: number; atk: number; def: number; spd: number };
  compact?: boolean;
}

const STAT_KEYS = ['hp', 'atk', 'def', 'spd'] as const;
const STAT_LABELS: Record<(typeof STAT_KEYS)[number], string> = {
  hp: 'HP',
  atk: 'ATK',
  def: 'DEF',
  spd: 'SPD',
};

export function CreatureCard({ creature, deltas, compact = false }: Props) {
  const primaryType = getType(creature.types[0] ?? 'ember');
  const typeNames = creature.types.map((t) => getType(t).name);

  return (
    <View style={[styles.card, { backgroundColor: primaryType.color }, compact && styles.cardCompact]}>
      <View style={styles.headerRow}>
        <Text style={styles.name} numberOfLines={1}>
          {creature.name}
        </Text>
        <View style={styles.tierBadge}>
          <Text style={styles.tierText}>T{creature.tier}</Text>
        </View>
      </View>
      <View style={styles.typeRow}>
        {typeNames.map((n) => (
          <View key={n} style={styles.typePill}>
            <Text style={styles.typeText}>{n}</Text>
          </View>
        ))}
      </View>
      <View style={styles.statsRow}>
        {STAT_KEYS.map((k) => (
          <View key={k} style={styles.stat}>
            <Text style={styles.statLabel}>{STAT_LABELS[k]}</Text>
            <Text style={styles.statValue}>{creature.stats[k]}</Text>
            {deltas ? (
              <Text style={[styles.delta, deltas[k] >= 0 ? styles.deltaUp : styles.deltaDown]}>
                {deltas[k] >= 0 ? `+${deltas[k]}` : `${deltas[k]}`}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  cardCompact: {
    padding: 10,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    flexShrink: 1,
  },
  tierBadge: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tierText: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  typePill: {
    backgroundColor: 'rgba(255,255,255,0.24)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  typeText: {
    color: '#ffffff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  stat: {
    alignItems: 'center',
    minWidth: 44,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  statValue: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  delta: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  deltaUp: {
    color: '#b7f5c2',
  },
  deltaDown: {
    color: '#ffc9c9',
  },
});
