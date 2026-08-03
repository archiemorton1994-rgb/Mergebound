/**
 * The shared building blocks every MergeBound screen is made of.
 *
 * This exists because `PrimaryButton` and the haptic helper were byte-for-byte
 * duplicated in EggScreen and BattleScreen, and every screen carried its own
 * copy of the safe-area padding expression. With five more screens coming, that
 * becomes nine copies of the same bug.
 *
 * Everything here reads from constants/tokens.ts. No screen should contain a
 * raw colour, and no component here should contain a game rule.
 */

import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { MIN_TAP_TARGET, elevation, palette, radius, space, type } from '@/constants/tokens';

/**
 * Haptics are a real part of the reward loop — the buzz on a good roll is half
 * of why it lands. They do not exist on web, where the preview runs, so every
 * call goes through here rather than each screen remembering to check.
 */
export const haptics = {
  tap() {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  press() {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  celebrate() {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  warn() {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  },
};

// --- text -------------------------------------------------------------------

type TextVariant = keyof typeof type;

export function AppText({
  variant = 'body',
  color = palette.text,
  style,
  children,
  ...rest
}: {
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
} & React.ComponentProps<typeof Text>) {
  return (
    <Text {...rest} style={[type[variant], { color }, style]}>
      {children}
    </Text>
  );
}

// --- layout -----------------------------------------------------------------

/**
 * A screen's outer shell. Owns the safe-area padding so no screen repeats the
 * `Platform.OS === 'web' ? 67 : insets.top` expression that used to be copied
 * into every one of them.
 */
export function Screen({
  children,
  scroll = true,
  contentStyle,
  edges = { top: true, bottom: true },
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: { top?: boolean; bottom?: boolean };
}) {
  const insets = useSafeAreaInsets();
  // The web preview reports no insets, but the browser chrome still overlaps —
  // these two values match what the previous screens used by hand.
  const topInset = Platform.OS === 'web' ? 24 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 16 : insets.bottom;

  const padding = {
    paddingTop: (edges.top ? topInset : 0) + space.lg,
    paddingBottom: (edges.bottom ? bottomInset : 0) + space.xl,
    paddingHorizontal: space.lg,
  };

  if (!scroll) {
    return <View style={[styles.screen, padding, contentStyle]}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[padding, { gap: space.xl }, contentStyle]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** A raised surface. Use `sunken` for anything that should read as "somewhere else", like the store. */
export function Panel({
  children,
  style,
  tone = 'raised',
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'raised' | 'flat' | 'sunken';
  padded?: boolean;
}) {
  const background =
    tone === 'raised'
      ? palette.surfaceRaised
      : tone === 'sunken'
        ? palette.surfaceSunken
        : palette.surface;
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: background },
        padded && { padding: space.lg },
        tone === 'raised' && elevation.panel,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** A small rounded label — a type name, a tier badge, a cost. */
export function Pill({
  label,
  color = palette.textSecondary,
  background = 'rgba(255,255,255,0.07)',
}: {
  label: string;
  color?: string;
  background?: string;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <AppText variant="caption" color={color} style={styles.pillText}>
        {label}
      </AppText>
    </View>
  );
}

export function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeading}>
      <AppText variant="heading">{title}</AppText>
      {action}
    </View>
  );
}

// --- buttons ----------------------------------------------------------------

/**
 * The primary action. A gradient rather than a flat fill, because white on the
 * old flat purple measured 4.35:1 — under the readable minimum. The gradient's
 * lightest stop clears it.
 */
export function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || loading;

  const content = loading ? (
    <ActivityIndicator color={palette.text} />
  ) : (
    <AppText
      variant="heading"
      color={
        inert
          ? palette.textDisabled
          : variant === 'ghost'
            ? palette.interactive
            : palette.text
      }
    >
      {label}
    </AppText>
  );

  if (variant === 'primary' && !inert) {
    return (
      <Pressable
        onPress={() => {
          haptics.press();
          onPress();
        }}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <LinearGradient
          colors={[...palette.primaryGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.buttonFill}
        >
          {content}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={
        inert
          ? undefined
          : () => {
              haptics.press();
              onPress();
            }
      }
      disabled={inert}
      style={({ pressed }) => [
        styles.button,
        styles.buttonFill,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        inert && styles.buttonDisabled,
        pressed && !inert && styles.pressed,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert }}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.background,
  },
  screenScroll: {
    flex: 1,
    backgroundColor: palette.background,
  },
  panel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: space.md,
  },
  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontFamily: 'Inter_600SemiBold',
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  button: {
    borderRadius: radius.md,
    overflow: 'hidden',
    minHeight: MIN_TAP_TARGET,
  },
  buttonFill: {
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonSecondary: {
    backgroundColor: palette.surfaceRaised,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'transparent',
  },
  pressed: {
    opacity: 0.82,
  },
});
