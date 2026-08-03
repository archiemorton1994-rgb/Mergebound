import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { palette } from '@/constants/tokens';
import { onboardingRedirectTarget } from '@/src/game/onboarding';
import { CollectionProvider, useCollection } from '@/src/screens/CollectionContext';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

/**
 * Sends a player who has not finished the tutorial back to it, wherever they
 * try to go. Runs on every navigation, which is safe because
 * onboardingRedirectTarget returns null when the current route is already an
 * allowed one — a redirect that fires on the route it redirects to is an
 * infinite loop, and on a phone that is a frozen screen rather than an error.
 *
 * Waits for `loading` first. Before the save is read, every player looks brand
 * new, so redirecting early would throw an existing player into the tutorial
 * for the split second before their collection arrives.
 */
function OnboardingGuard() {
  const { save, loading } = useCollection();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const target = onboardingRedirectTarget(save.onboarding, pathname);
    if (target) router.replace(target as never);
  }, [loading, save.onboarding, pathname, router]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <OnboardingGuard />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        {/* The tab shell owns Home and the Hatchery, and carries the currency HUD. */}
        <Stack.Screen name="(tabs)" />
        {/* The tutorial and battles sit OUTSIDE the tabs on purpose: both should
            hold the whole screen, and letting someone tab away mid-battle would
            mean deciding what happens to the battle they abandoned. */}
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="battle" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <CollectionProvider>
                <RootLayoutNav />
              </CollectionProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
