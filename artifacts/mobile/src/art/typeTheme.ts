/**
 * Colour maths for the type palette. Pure TypeScript — no UI imports, tested
 * like any other rule. Same split as creatureArt.ts: this decides what colour
 * something should be, components only draw it.
 *
 * The problem this solves: types.json's colours were chosen to look right as
 * CARD FILLS, which is how CreatureCard correctly uses them. Several of them
 * are unreadable as TEXT on a dark background — measured against the app
 * surface, Tide manages 4.12:1, Crag 3.85:1 and Umbra only 2.52:1, all under
 * the 4.5:1 needed for body text. Rather than maintaining a second hand-picked
 * palette that can drift out of step with the first, accentOnDark() lightens a
 * type's own colour just far enough to be legible. One source of truth, and a
 * new type never needs a matching edit anywhere.
 */

import { getType } from '../game/content';

/** The contrast floor for text, from the accessibility guidelines. */
export const MIN_TEXT_CONTRAST = 4.5;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Relative luminance, per the WCAG definition. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours: 1 is identical, 21 is black on white. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Mix towards white by `amount` (0 = unchanged, 1 = white). */
function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: r + (255 - r) * amount,
    g: g + (255 - g) * amount,
    b: b + (255 - b) * amount,
  });
}

/**
 * A type's colour, lightened only as far as it must be to be readable as text
 * on the given background. A colour that already passes is returned untouched,
 * so the common case keeps exactly the hue the designer picked.
 *
 * Steps in small increments and stops at the first passing value rather than
 * jumping straight to a safe pale tint — the point is to stay recognisably
 * Umbra or Crag, not to turn every type into the same washed-out lilac.
 */
export function accentOnDark(hex: string, background: string, minContrast = MIN_TEXT_CONTRAST): string {
  if (contrastRatio(hex, background) >= minContrast) return hex;
  for (let step = 1; step <= 20; step++) {
    const candidate = lighten(hex, step / 20);
    if (contrastRatio(candidate, background) >= minContrast) return candidate;
  }
  // Nothing in the ramp cleared it (only possible against a light background) —
  // white is the best available answer and always beats returning something
  // unreadable.
  return '#FFFFFF';
}

/** The readable text colour for a type id on a given background. */
export function typeTextColor(typeId: string, background: string): string {
  return accentOnDark(getType(typeId).color, background);
}

/** A creature's two theme colours: its primary type's fill, and its accent. */
export function creatureTheme(typeIds: string[], background: string): { fill: string; accent: string } {
  const primary = typeIds[0];
  const secondary = typeIds[1];
  const fill = primary ? getType(primary).color : background;
  // A single-typed creature accents with a lightened version of its own colour,
  // so a dual-typed one is visibly richer. That is deliberate reinforcement of
  // merging as the way to get there — the same rule creatureArt.ts follows.
  const accentSource = secondary ? getType(secondary).color : lighten(fill, 0.35);
  return { fill, accent: accentOnDark(accentSource, background) };
}
