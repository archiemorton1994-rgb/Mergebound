/**
 * Home — what a returning player sees first.
 *
 * The job of this screen is to answer "what should I do now?" in under a
 * second. It leads with the single thing most worth doing, shows the player's
 * strongest creature as proof of progress, and keeps everything else one tap
 * away. It holds no game rules of its own.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { palette, radius, space } from '@/constants/tokens';
import { creaturePower } from '@/src/game/content';
import type { Creature } from '@/src/game/models';
import { CreatureSprite } from '@/src/screens/CreatureSprite';
import { useCollection } from '@/src/screens/CollectionContext';
import { AppText, Button, Panel, Screen, SectionHeading, haptics } from '@/src/screens/ui/kit';
import { creatureTheme } from '@/src/art/typeTheme';

function strongestOf(collection: Creature[]): Creature | null {
  if (collection.length === 0) return null;
  return collection.reduce((best, c) => (creaturePower(c) > creaturePower(best) ? c : best));
}

/** A large, tappable card leading somewhere. The eye should land on these in order. */
function DestinationCard({
  title,
  detail,
  accent,
  onPress,
}: {
  title: string;
  detail: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Panel style={styles.destination}>
        <View style={[styles.accentBar, { backgroundColor: accent }]} />
        <View style={styles.destinationText}>
          <AppText variant="heading">{title}</AppText>
          <AppText variant="caption" color={palette.textMuted}>
            {detail}
          </AppText>
        </View>
      </Panel>
    </Pressable>
  );
}

export function HomeScreen() {
  const router = useRouter();
  const { collection, binder, loading, loadError } = useCollection();

  const strongest = useMemo(() => strongestOf(collection), [collection]);
  const theme = useMemo(
    () => (strongest ? creatureTheme(strongest.types, palette.background) : null),
    [strongest],
  );

  const highestTier = useMemo(
    () => collection.reduce((max, c) => Math.max(max, c.tier), 0),
    [collection],
  );

  if (loading) {
    return (
      <Screen scroll={false} contentStyle={styles.centre}>
        <AppText color={palette.textMuted}>Loading your Wardens…</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      {loadError ? (
        <Panel tone="flat" style={styles.errorPanel}>
          <AppText variant="bodyStrong" color={palette.danger}>
            Couldn&apos;t load your saved game
          </AppText>
          <AppText variant="caption" color={palette.textMuted}>
            {loadError}
          </AppText>
        </Panel>
      ) : null}

      <View>
        <AppText variant="caption" color={palette.textMuted}>
          {binder.name ? `Welcome back, ${binder.name}` : 'Welcome back'}
        </AppText>
        <AppText variant="display">MergeBound</AppText>
      </View>

      {strongest && theme ? (
        <Panel style={styles.showcase}>
          <View style={styles.showcaseArt}>
            <CreatureSprite creature={strongest} size={120} />
          </View>
          <View style={styles.showcaseText}>
            <AppText variant="caption" color={palette.textMuted}>
              Your strongest Warden
            </AppText>
            <AppText variant="title">{strongest.name}</AppText>
            <AppText variant="bodyStrong" color={theme.accent}>
              Tier {strongest.tier} · {strongest.types.join(' / ')}
            </AppText>
          </View>
        </Panel>
      ) : (
        <Panel style={styles.emptyShowcase}>
          <AppText variant="title">No Wardens yet</AppText>
          <AppText variant="body" color={palette.textSecondary}>
            Eggs are debris of the Sundering. Hatch two, fuse them, and see what you make.
          </AppText>
          <Button label="Hatch your first eggs" onPress={() => router.push('/hatchery')} />
        </Panel>
      )}

      <View>
        <SectionHeading title="What next" />
        <View style={{ gap: space.md }}>
          <DestinationCard
            title="Hatchery"
            detail={
              collection.length === 0
                ? 'Crack open your first eggs'
                : `${collection.length} Warden${collection.length === 1 ? '' : 's'} · highest tier ${highestTier}`
            }
            accent={palette.interactive}
            onPress={() => router.push('/hatchery')}
          />
          <DestinationCard
            title="Battle"
            detail={
              collection.length < 2
                ? 'Hatch a few Wardens first'
                : 'Send a party against the Discordant'
            }
            accent={palette.gold}
            onPress={() => router.push('/battle')}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPanel: {
    borderColor: palette.danger,
    gap: space.xs,
  },
  showcase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  showcaseArt: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showcaseText: {
    flex: 1,
    gap: 2,
  },
  emptyShowcase: {
    gap: space.md,
  },
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
  },
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: radius.pill,
  },
  destinationText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.85,
  },
});
