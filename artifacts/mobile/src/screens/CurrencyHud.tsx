/**
 * The persistent heads-up display: who you are, and what you have.
 *
 * The count-up is not decoration. A number that jumps straight to its new value
 * reads as bookkeeping; a number that climbs reads as a reward, and a bigger
 * haul climbing for longer reads as a bigger reward. Spending, by contrast, is
 * deliberately instant and quiet — dwelling on what a player just gave up is
 * the opposite of what the moment needs.
 *
 * Contains no game rules. It renders whatever the wallet says.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { palette, radius, space } from '@/constants/tokens';
import type { Wallet } from '@/src/game/models';
import { AppText, haptics } from '@/src/screens/ui/kit';

/** How long a change takes to count up, and the longest it is ever allowed to take. */
const COUNT_MS_PER_UNIT = 6;
const COUNT_MIN_MS = 220;
const COUNT_MAX_MS = 1400;
const FRAME_MS = 16;

/**
 * Animate towards a target number. Increases climb; decreases snap.
 * Returns the value to render right now.
 */
export function useCountUp(target: number, enabled = true): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || target <= fromRef.current) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const from = fromRef.current;
    const delta = target - from;
    const duration = Math.min(
      COUNT_MAX_MS,
      Math.max(COUNT_MIN_MS, Math.abs(delta) * COUNT_MS_PER_UNIT),
    );
    const started = Date.now();

    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      const elapsed = Date.now() - started;
      const progress = Math.min(1, elapsed / duration);
      // Ease out — fast at first, settling at the end, which is what makes it
      // feel like it is landing rather than merely stopping.
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(from + delta * eased));
      if (progress >= 1) {
        fromRef.current = target;
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
      }
    }, FRAME_MS);

    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [target, enabled]);

  return display;
}

/** 1,240 rather than 1240; 12.4k once the numbers get long enough to break the layout. */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.floor(value);
  if (rounded < 100_000) return rounded.toLocaleString('en-GB');
  if (rounded < 1_000_000) return `${(rounded / 1000).toFixed(1)}k`;
  if (rounded < 1_000_000_000) return `${(rounded / 1_000_000).toFixed(2)}M`;
  return `${(rounded / 1_000_000_000).toFixed(2)}B`;
}

function CurrencyChip({
  amount,
  color,
  symbol,
  label,
  onPress,
}: {
  amount: number;
  color: string;
  symbol: string;
  label: string;
  onPress?: () => void;
}) {
  const shown = useCountUp(amount);
  const body = (
    <View style={styles.chip}>
      <View style={[styles.dot, { backgroundColor: color }]}>
        <AppText variant="caption" color={palette.background} style={styles.dotGlyph}>
          {symbol}
        </AppText>
      </View>
      <AppText variant="numeric" color={palette.text}>
        {formatCurrency(shown)}
      </AppText>
    </View>
  );

  if (!onPress) {
    return (
      <View accessibilityLabel={`${label}: ${formatCurrency(amount)}`}>{body}</View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${formatCurrency(amount)}. Opens the store.`}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {body}
    </Pressable>
  );
}

/**
 * Sits above the tab navigator as a real row in the layout, not an absolute
 * overlay. That means no screen has to leave a gap for it and it can never
 * cover content — a floating HUD over a scrolling list is a classic way to
 * hide the last row from someone on a small phone.
 */
export function CurrencyHud({
  wallet,
  binderName,
  onPressBinder,
  onPressStore,
}: {
  wallet: Wallet;
  binderName: string;
  onPressBinder?: () => void;
  onPressStore?: () => void;
}) {
  return (
    <View style={styles.hud}>
      <Pressable
        onPress={
          onPressBinder
            ? () => {
                haptics.tap();
                onPressBinder();
              }
            : undefined
        }
        accessibilityRole={onPressBinder ? 'button' : undefined}
        accessibilityLabel={binderName ? `Binder: ${binderName}` : 'Your Binder'}
        style={({ pressed }) => [styles.binder, pressed && styles.pressed]}
      >
        <View style={styles.avatarPlaceholder} />
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.binderName}>
          {binderName || 'Binder'}
        </AppText>
      </Pressable>

      <View style={styles.currencies}>
        <CurrencyChip amount={wallet.gold} color={palette.gold} symbol="G" label="Gold" onPress={onPressStore} />
        <CurrencyChip
          amount={wallet.mergeStones}
          color={palette.mergeStone}
          symbol="M"
          label="Merge stones"
          onPress={onPressStore}
        />
        <CurrencyChip amount={wallet.gems} color={palette.gem} symbol="◆" label="Gems" onPress={onPressStore} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    gap: space.md,
  },
  binder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 1,
  },
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceRaised,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },
  binderName: {
    maxWidth: 96,
  },
  currencies: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexShrink: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotGlyph: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    lineHeight: Platform.OS === 'web' ? 18 : 13,
  },
  pressed: {
    opacity: 0.7,
  },
});
