/**
 * Tests for the type colour palette (src/art/typeTheme.ts): every type must be
 * readable as text on the app's dark surfaces, without abandoning the colours
 * chosen for card fills.
 */

import { describe, expect, it } from 'vitest';
import { palette } from '../../../constants/tokens';
import { allTypes } from '../../game/content';
import {
  MIN_TEXT_CONTRAST,
  accentOnDark,
  contrastRatio,
  creatureTheme,
  hexToRgb,
  rgbToHex,
  typeTextColor,
} from '../typeTheme';

describe('measuring contrast', () => {
  it('rates black on white as the highest possible contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('rates a colour against itself as no contrast at all', () => {
    expect(contrastRatio('#7C5CFF', '#7C5CFF')).toBeCloseTo(1, 5);
  });

  it('gives the same answer whichever way round the two colours are given', () => {
    expect(contrastRatio('#12101E', '#9B82FF')).toBeCloseTo(contrastRatio('#9B82FF', '#12101E'), 10);
  });

  it('accepts short three-character colour codes', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(rgbToHex(hexToRgb('#abc'))).toBe('#aabbcc');
  });
});

describe('the colours the app actually uses', () => {
  it('the interactive colour is readable on every surface it appears on', () => {
    for (const surface of [palette.background, palette.surface, palette.surfaceRaised]) {
      expect(contrastRatio(palette.interactive, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('white is readable on the primary button at its lightest point', () => {
    const lightestStop = palette.primaryGradient[0];
    expect(contrastRatio('#FFFFFF', lightestStop)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('the perfect-roll gold is readable wherever a stat value is shown', () => {
    for (const surface of [palette.background, palette.surface, palette.surfaceRaised]) {
      expect(contrastRatio(palette.perfect, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('every currency colour is readable in the heads-up display', () => {
    for (const colour of [palette.gold, palette.mergeStone, palette.gem]) {
      expect(contrastRatio(colour, palette.surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('the ordinary body text colours are all readable', () => {
    // textMuted is deliberately the faintest thing in the app; it must still clear the bar.
    expect(contrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio('#BFBFBF', palette.surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

describe('making every creature type readable', () => {
  it('every single type is readable as text on the app background', () => {
    for (const type of allTypes) {
      const colour = typeTextColor(type.id, palette.background);
      expect(contrastRatio(colour, palette.background), `${type.name}`).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST,
      );
    }
  });

  it('every single type is readable on a raised panel too', () => {
    for (const type of allTypes) {
      const colour = typeTextColor(type.id, palette.surfaceRaised);
      expect(contrastRatio(colour, palette.surfaceRaised), `${type.name}`).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST,
      );
    }
  });

  it('leaves a colour that is already readable exactly as its designer chose it', () => {
    // Lumen is a pale type and needs no help — it must come back untouched
    // rather than being washed out for no reason.
    const lumen = allTypes.find((t) => t.id === 'lumen');
    if (!lumen) throw new Error('expected a lumen type');
    expect(accentOnDark(lumen.color, palette.background)).toBe(lumen.color);
  });

  it('lightens the darkest type rather than leaving it unreadable', () => {
    const umbra = allTypes.find((t) => t.id === 'umbra');
    if (!umbra) throw new Error('expected an umbra type');
    const adjusted = accentOnDark(umbra.color, palette.background);
    expect(adjusted).not.toBe(umbra.color);
    expect(contrastRatio(adjusted, palette.background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('gives a dual-typed creature two different colours, and a single-typed one a lighter version of its own', () => {
    const dual = creatureTheme(['ember', 'tide'], palette.background);
    expect(dual.fill).not.toBe(dual.accent);

    const single = creatureTheme(['ember'], palette.background);
    expect(single.accent).not.toBe(single.fill);
    expect(contrastRatio(single.accent, palette.background)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
  });
});
