/**
 * The app shell: a persistent currency HUD above a bottom tab bar.
 *
 * Two structural decisions worth not undoing:
 *
 * 1. This is a real Tabs navigator with a custom `tabBar`, NOT a bar rendered
 *    beside a Stack. A sibling bar makes every tab switch a Stack push, so
 *    Android's back button walks backwards through tabs one at a time and each
 *    tab loses its scroll position on the way out. Those are bugs, not styling
 *    preferences. The `tabBar` prop gives full visual control while keeping the
 *    navigator's semantics.
 *
 * 2. The HUD is a real row in the layout above the navigator, not an absolute
 *    overlay. That means no screen has to leave a gap for it and it can never
 *    cover the last row of a list on a small phone.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { MIN_TAP_TARGET, palette, radius, space } from '@/constants/tokens';
import { CurrencyHud } from '@/src/screens/CurrencyHud';
import { useCollection } from '@/src/screens/CollectionContext';
import { AppText, haptics } from '@/src/screens/ui/kit';

/** Tab labels live here rather than in each route file so the bar can be read in one place. */
const TAB_LABELS: Record<string, string> = {
  index: 'Home',
  hatchery: 'Hatchery',
  collection: 'Wardens',
};

function MergeTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const label = TAB_LABELS[route.name] ?? route.name;

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                haptics.tap();
                navigation.navigate(route.name);
              }
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={styles.tab}
          >
            <View style={[styles.indicator, focused && styles.indicatorActive]} />
            <AppText
              variant="caption"
              color={focused ? palette.text : palette.textMuted}
              style={focused ? styles.labelActive : undefined}
            >
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { wallet, binder } = useCollection();

  return (
    <View style={styles.root}>
      <CurrencyHud wallet={wallet} binderName={binder.name} />
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: palette.background } }}
        tabBar={(props) => <MergeTabBar {...props} />}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="hatchery" options={{ title: 'Hatchery' }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: space.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    gap: 6,
  },
  indicator: {
    width: 22,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: palette.interactive,
  },
  labelActive: {
    fontFamily: 'Inter_600SemiBold',
  },
});
