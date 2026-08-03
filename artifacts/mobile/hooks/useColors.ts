import colors from '@/constants/colors';

/**
 * Returns the semantic colour tokens for the app.
 *
 * MergeBound is a dark game everywhere, deliberately: the creature portraits
 * and the perfect-roll gold are both built to glow against a dark surface and
 * neither reads on white. So this no longer branches on the device's light or
 * dark setting — constants/colors.ts resolves both keys to the same palette, and
 * a phone in light mode still gets the game rather than a washed-out version of
 * it.
 *
 * New colours belong in constants/tokens.ts, which is the real source of truth.
 * This hook exists for the scaffolding screens that were written against the
 * older shape.
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
