/**
 * Creature card: vector portrait plus name, tier, types and stats.
 * Card colour comes from the creature's primary type (src/data/types.json);
 * the portrait itself is drawn by CreatureSprite. No image assets.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette } from '@/constants/tokens';
import { CreatureSprite } from '@/src/screens/CreatureSprite';
import { balance, getType } from '@/src/game/content';
import { PERCENT_STAT_KEYS, STAT_KEYS, type Creature, type Stats } from '@/src/game/models';

/** Below this, a roll is dimmed rather than shown in full white — purely presentational. */
const DIM_ROLL_THRESHOLD = 15;

interface Props {
  creature: Creature;
  /** Optional per-stat deltas vs. something (used for the merge result). */
  deltas?: Stats;
  compact?: boolean;
}

const STAT_LABELS: Record<(typeof STAT_KEYS)[number], string> = {
  hp: 'HP',
  atk: 'ATK',
  spAtk: 'SP.ATK',
  def: 'DEF',
  spDef: 'SP.DEF',
  spd: 'SPD',
  critChance: 'CRIT%',
  critDamage: 'CRIT DMG',
};

function formatStat(key: (typeof STAT_KEYS)[number], value: number): string {
  return PERCENT_STAT_KEYS.includes(key) ? `${value}%` : `${value}`;
}

/**
 * Colour a stat value by how good its roll was, so a near-perfect roll
 * visibly pops even in the compact collection list — this is the whole
 * point of tracking statRolls: "perfect rolls" need to be visible to be
 * worth chasing.
 *
 * The threshold and the gold both come from shared sources rather than being
 * typed here: creatureArt.ts adds a sparkle at the same threshold, so if the
 * two ever disagreed a creature could show gold numbers without sparkling, or
 * the reverse. One number, one colour, read in both places.
 */
function rollColor(rollPercent: number): string {
  if (rollPercent >= balance.reveal.gold) return palette.perfect;
  if (rollPercent <= DIM_ROLL_THRESHOLD) return palette.textMuted;
  return palette.text;
}

export function CreatureCard({ creature, deltas, compact = false }: Props) {
  const primaryType = getType(creature.types[0] ?? 'ember');
  const typeNames = creature.types.map((t) => getType(t).name);

  return (
    <View style={[styles.card, { backgroundColor: primaryType.color }, compact && styles.cardCompact]}>
      <View style={styles.topRow}>
        <View style={styles.spriteStage}>
          <CreatureSprite creature={creature} size={compact ? 56 : 84} />
        </View>
        <View style={styles.identity}>
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
        </View>
      </View>
      <View style={styles.statsGrid}>
        {STAT_KEYS.map((k) => (
          <View key={k} style={styles.stat}>
            <Text style={styles.statLabel}>{STAT_LABELS[k]}</Text>
            <Text style={[styles.statValue, { color: rollColor(creature.statRolls[k]) }]}>
              {formatStat(k, creature.stats[k])}
            </Text>
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  /** A darker panel so the portrait reads against a card of its own type colour. */
  spriteStage: {
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderRadius: 14,
    padding: 3,
  },
  identity: {
    flex: 1,
    gap: 8,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  stat: {
    alignItems: 'center',
    width: '25%',
    paddingVertical: 4,
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
