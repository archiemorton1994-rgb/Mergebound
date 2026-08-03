/**
 * Route file only — the actual screen lives in src/screens/OnboardingScreen.tsx.
 *
 * The whole tutorial is deliberately ONE route. See the screen's header for why:
 * a step-per-route flow can put a resumed player on an address that disagrees
 * with the step in their save file.
 */

import { OnboardingScreen } from '@/src/screens/OnboardingScreen';

export default OnboardingScreen;
