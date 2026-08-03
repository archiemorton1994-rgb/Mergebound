/**
 * MergeBound's design tokens — the single source of truth for how the game
 * LOOKS, the way balance.json is the single source of truth for how it plays.
 *
 * Screens must not hardcode colours. Before this file existed every screen
 * carried its own copy of '#151322' and '#7C5CFF', which is why the error and
 * not-found screens still render white and look like a different app entirely.
 *
 * Two rules that are not style preferences:
 *
 * 1. CONTRAST. Text must clear 4.5:1 against the surface behind it. Two colours
 *    that shipped in the old screens do not: '#7C5CFF' as text on '#12101E' is
 *    4.32:1, and white on a flat '#7C5CFF' button is 4.35:1. Both are replaced
 *    below — `interactive` (#9B82FF) reaches 6.29:1 as text, and the primary
 *    button is a gradient whose lightest stop still gives white 5.31:1. Type
 *    colours from types.json are fine as card FILLS (which is how CreatureCard
 *    already uses them) but several fail badly as text on dark — Tide 4.12:1,
 *    Crag 3.85:1, Umbra 2.52:1 — so route them through accentOnDark() in
 *    src/art/typeTheme.ts rather than using them raw.
 *
 * 2. GOLD IS RESERVED. `perfect` (#FFD966) means "a stat rolled 90 or better"
 *    and nothing else, anywhere, ever. It is the game's single most important
 *    visual signal — the whole long-term chase is legible at a glance because
 *    that colour is never spent on decoration. If something else needs to look
 *    valuable, use `treasure` (#F5A623).
 */

export const palette = {
  /** Deepest surface — app background and the splash screen, so a cold start never flashes white. */
  background: '#0B0A14',
  /** Standard panel/card surface. */
  surface: '#12101E',
  /** A panel sitting on top of another panel. */
  surfaceRaised: '#1A1728',
  /** The store and other modal sheets sit darker than the app, so they read as somewhere else. */
  surfaceSunken: '#070610',

  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.18)',

  text: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.74)',
  textMuted: 'rgba(255,255,255,0.50)',
  textDisabled: 'rgba(255,255,255,0.32)',

  /** Interactive text and links. 6.29:1 on `surface`. */
  interactive: '#9B82FF',
  /** Primary button fill, as a gradient. White on the lightest stop is 5.31:1. */
  primaryGradient: ['#6E4CF0', '#5B3FD1'] as const,
  primaryPressed: '#5334C4',

  /** RESERVED: a stat rolled at or above the gold threshold. Never decoration. */
  perfect: '#FFD966',
  /** For things that should look valuable without claiming to be a perfect roll. */
  treasure: '#F5A623',

  danger: '#FF6B6B',
  success: '#5BD99A',

  /** Currency colours. Kept distinct enough to tell apart at HUD size and in a glance. */
  gold: '#F5C65B',
  mergeStone: '#7FD4E8',
  gem: '#EE7BC8',

  /** Scrim behind modals. */
  scrim: 'rgba(4,3,10,0.72)',
} as const;

/**
 * Spacing scale. One consistent rhythm beats per-screen guesses — the old
 * screens used 10, 12, 14, 16, 18, 20 and 24 more or less interchangeably.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/**
 * Type scale. The fonts loaded in app/_layout.tsx are the only ones available,
 * so every weight here must map to one that is actually loaded.
 */
export const type = {
  display: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 36 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 22 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  bodyStrong: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  /** Currency counters and stat values — tabular so digits do not jitter while counting up. */
  numeric: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20 },
} as const;

/**
 * Minimum tap target. Anything interactive must reach this in both directions,
 * however small it looks — the platform guidelines put it at 44pt and a merge
 * game is played fast with a thumb.
 */
export const MIN_TAP_TARGET = 44;

/** Elevation, expressed once so panels do not each invent their own shadow. */
export const elevation = {
  panel: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
} as const;

const tokens = { palette, space, radius, type, elevation, MIN_TAP_TARGET };
export default tokens;
