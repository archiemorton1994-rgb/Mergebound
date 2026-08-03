/**
 * Semantic colour tokens, derived from the game's design tokens.
 *
 * The real source of truth is constants/tokens.ts. This file exists because the
 * scaffolding screens (components/ErrorFallback.tsx, app/+not-found.tsx) and the
 * useColors() hook were written against this shape — and, until now, against a
 * LIGHT placeholder palette, which is why an error in a dark game rendered a
 * white screen that looked like a different app entirely.
 *
 * Mapping them onto the real palette here fixes those screens without having to
 * rewrite them. Add new colours to tokens.ts, not here.
 */

import { palette, radius as radiusTokens } from './tokens';

const dark = {
  // Legacy aliases (kept for backward compatibility)
  text: palette.text,
  tint: palette.interactive,

  // Core surfaces
  background: palette.background,
  foreground: palette.text,

  // Cards / elevated surfaces
  card: palette.surfaceRaised,
  cardForeground: palette.text,

  // Primary action colour (buttons, links, active states)
  primary: palette.interactive,
  primaryForeground: palette.text,

  // Secondary / less-emphasis interactive surfaces
  secondary: palette.surface,
  secondaryForeground: palette.textSecondary,

  // Muted / subdued elements (dividers, timestamps, placeholders)
  muted: palette.surface,
  mutedForeground: palette.textMuted,

  // Accent highlights (badges, selected items, focus rings)
  accent: palette.surfaceRaised,
  accentForeground: palette.text,

  // Destructive actions (delete, error states)
  destructive: palette.danger,
  destructiveForeground: palette.text,

  // Borders and input outlines
  border: palette.border,
  input: palette.borderStrong,
};

/**
 * MergeBound is a dark game everywhere, deliberately — the creature portraits
 * and the perfect-roll gold are both built to glow against a dark surface, and
 * neither works on white. Both keys resolve to the same palette so a device in
 * light mode still gets the game rather than a washed-out version of it.
 */
const colors = {
  light: dark,
  dark,
  radius: radiusTokens.lg,
};

export default colors;
