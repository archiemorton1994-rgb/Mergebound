import { describe, expect, it } from 'vitest';
import { allTypes, binderContent, defaultBinderAppearance } from '../../game/content';
import type { Binder, BinderAppearance } from '../../game/models';
import { createRng } from '../../game/rng';
import { hexToRgb } from '../creatureArt';
import {
  type BinderPalette,
  binderArt,
  defaultAppearanceFor,
  generateBinderName,
  paletteForBinder,
  proportionsFor,
  sanitizeBinderName,
} from '../binderArt';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function makeBinder(appearance: Partial<BinderAppearance> = {}, name = 'Wren Ashford'): Binder {
  return { name, appearance: { ...defaultBinderAppearance(), ...appearance } };
}

/** How bright a colour is, roughly — enough to say "this one is darker than that one". */
function brightness(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return r + g + b;
}

function expectEveryColourIsDrawable(palette: BinderPalette): void {
  for (const colour of Object.values(palette)) {
    expect(colour).toMatch(HEX_COLOR);
  }
}

describe('the Binder options a save can refer to', () => {
  it('starts every new player on choices that really exist in the data file', () => {
    const start = defaultBinderAppearance();
    expect(binderContent.builds.some((b) => b.id === start.buildId)).toBe(true);
    expect(binderContent.skinTones.some((s) => s.id === start.skinToneId)).toBe(true);
    expect(binderContent.hairStyles.some((h) => h.id === start.hairStyleId)).toBe(true);
    expect(binderContent.hairColors.some((c) => c.id === start.hairColorId)).toBe(true);
    expect(binderContent.outfits.some((o) => o.id === start.outfitId)).toBe(true);
    expect(binderContent.outfitTones.some((t) => t.id === start.outfitToneId)).toBe(true);
    expect(binderContent.marks.some((m) => m.id === start.markId)).toBe(true);
    expect(allTypes.some((t) => t.id === start.accentTypeId)).toBe(true);
  });
});

describe('build proportions', () => {
  it('gives every build in the data file a real height and shoulder width', () => {
    for (const build of binderContent.builds) {
      const proportions = proportionsFor(build.id);
      expect(proportions.shoulderScale).toBeGreaterThan(0);
      expect(proportions.heightScale).toBeGreaterThan(0);
    }
  });

  it('draws each build at the size the data file asked for', () => {
    for (const build of binderContent.builds) {
      expect(proportionsFor(build.id)).toEqual({
        shoulderScale: build.shoulderScale,
        heightScale: build.heightScale,
      });
    }
  });

  it('falls back to the starting build when a saved build no longer exists', () => {
    expect(proportionsFor('a-build-that-was-deleted')).toEqual(
      proportionsFor(defaultBinderAppearance().buildId),
    );
  });

  it('keeps every build close enough in size that one figure fits every screen', () => {
    for (const build of binderContent.builds) {
      const { shoulderScale, heightScale } = proportionsFor(build.id);
      expect(shoulderScale).toBeGreaterThanOrEqual(0.8);
      expect(shoulderScale).toBeLessThanOrEqual(1.25);
      expect(heightScale).toBeGreaterThanOrEqual(0.9);
      expect(heightScale).toBeLessThanOrEqual(1.15);
    }
  });
});

describe('the Binder palette', () => {
  it('wears the skin tone the player picked', () => {
    for (const tone of binderContent.skinTones) {
      expect(paletteForBinder(makeBinder({ skinToneId: tone.id }).appearance).skin).toBe(tone.color);
    }
  });

  it('wears the hair colour the player picked', () => {
    for (const colour of binderContent.hairColors) {
      expect(paletteForBinder(makeBinder({ hairColorId: colour.id }).appearance).hair).toBe(
        colour.color,
      );
    }
  });

  it('wears the outfit colour the player picked', () => {
    for (const tone of binderContent.outfitTones) {
      expect(paletteForBinder(makeBinder({ outfitToneId: tone.id }).appearance).outfit).toBe(
        tone.color,
      );
    }
  });

  it('always takes the accent colour from the chosen type, for every type in the game', () => {
    for (const type of allTypes) {
      expect(paletteForBinder(makeBinder({ accentTypeId: type.id }).appearance).accent).toBe(
        type.color,
      );
    }
  });

  it('gives every single option in the data file colours a renderer can actually use', () => {
    for (const tone of binderContent.skinTones) {
      expectEveryColourIsDrawable(paletteForBinder(makeBinder({ skinToneId: tone.id }).appearance));
    }
    for (const colour of binderContent.hairColors) {
      expectEveryColourIsDrawable(
        paletteForBinder(makeBinder({ hairColorId: colour.id }).appearance),
      );
    }
    for (const tone of binderContent.outfitTones) {
      expectEveryColourIsDrawable(
        paletteForBinder(makeBinder({ outfitToneId: tone.id }).appearance),
      );
    }
    for (const type of allTypes) {
      expectEveryColourIsDrawable(paletteForBinder(makeBinder({ accentTypeId: type.id }).appearance));
    }
  });

  it('shades the skin darker than the skin it was given, so a face has depth', () => {
    for (const tone of binderContent.skinTones) {
      const palette = paletteForBinder(makeBinder({ skinToneId: tone.id }).appearance);
      expect(brightness(palette.skinShade)).toBeLessThan(brightness(palette.skin));
    }
  });

  it('gives the outfit both a lit side and a shadowed side', () => {
    for (const tone of binderContent.outfitTones) {
      const palette = paletteForBinder(makeBinder({ outfitToneId: tone.id }).appearance);
      expect(brightness(palette.outfitLight)).toBeGreaterThan(brightness(palette.outfit));
      expect(brightness(palette.outfitShade)).toBeLessThan(brightness(palette.outfit));
    }
  });

  it('keeps the outline darker than the outfit, so the silhouette reads', () => {
    for (const tone of binderContent.outfitTones) {
      const palette = paletteForBinder(makeBinder({ outfitToneId: tone.id }).appearance);
      expect(brightness(palette.outline)).toBeLessThan(brightness(palette.outfit));
    }
  });

  it('keeps the eyes darker than the face around them, on every skin tone', () => {
    for (const tone of binderContent.skinTones) {
      const palette = paletteForBinder(makeBinder({ skinToneId: tone.id }).appearance);
      expect(brightness(palette.eye)).toBeLessThan(brightness(palette.skin));
    }
  });

  it('falls back to the starting skin tone when a saved one no longer exists', () => {
    const palette = paletteForBinder(makeBinder({ skinToneId: 'tone-that-was-renamed' }).appearance);
    expect(palette.skin).toBe(paletteForBinder(defaultBinderAppearance()).skin);
  });

  it('falls back to the starting accent when a saved type no longer exists', () => {
    const palette = paletteForBinder(makeBinder({ accentTypeId: 'a-type-we-removed' }).appearance);
    expect(palette.accent).toBe(paletteForBinder(defaultBinderAppearance()).accent);
  });
});

describe('drawing the Binder', () => {
  it('draws every hair style in the data file', () => {
    for (const style of binderContent.hairStyles) {
      expect(binderArt(makeBinder({ hairStyleId: style.id })).hairStyleId).toBe(style.id);
    }
  });

  it('draws every outfit in the data file', () => {
    for (const outfit of binderContent.outfits) {
      expect(binderArt(makeBinder({ outfitId: outfit.id })).outfitId).toBe(outfit.id);
    }
  });

  it('draws every mark in the data file', () => {
    for (const mark of binderContent.marks) {
      expect(binderArt(makeBinder({ markId: mark.id })).markId).toBe(mark.id);
    }
  });

  it('still renders a Binder whose saved hairstyle no longer exists', () => {
    const art = binderArt(makeBinder({ hairStyleId: 'hairstyle-we-renamed' }));
    expect(art.hairStyleId).toBe(defaultBinderAppearance().hairStyleId);
    expect(binderContent.hairStyles.some((h) => h.id === art.hairStyleId)).toBe(true);
  });

  it('still renders a person when every single saved choice has been renamed', () => {
    const art = binderArt(
      makeBinder({
        buildId: 'gone',
        skinToneId: 'gone',
        hairStyleId: 'gone',
        hairColorId: 'gone',
        outfitId: 'gone',
        outfitToneId: 'gone',
        accentTypeId: 'gone',
        markId: 'gone',
      }),
    );
    expect(binderContent.hairStyles.some((h) => h.id === art.hairStyleId)).toBe(true);
    expect(binderContent.outfits.some((o) => o.id === art.outfitId)).toBe(true);
    expect(binderContent.marks.some((m) => m.id === art.markId)).toBe(true);
    expect(art.proportions.heightScale).toBeGreaterThan(0);
    expectEveryColourIsDrawable(art.palette);
  });

  it('only ever names a hair style, outfit and mark the renderer knows how to draw', () => {
    for (const style of [...binderContent.hairStyles.map((h) => h.id), 'nonsense', '']) {
      const art = binderArt(makeBinder({ hairStyleId: style }));
      expect(binderContent.hairStyles.some((h) => h.id === art.hairStyleId)).toBe(true);
    }
  });

  it('makes the same Binder look exactly the same every single time', () => {
    const binder = makeBinder({
      buildId: 'broad',
      skinToneId: 'tone-5',
      hairStyleId: 'braid',
      hairColorId: 'hair-frost',
      outfitId: 'coat',
      outfitToneId: 'outfit-moss',
      accentTypeId: 'volt',
      markId: 'sigil',
    });
    expect(binderArt(binder)).toEqual(binderArt(binder));
  });

  it('makes two Binders who chose differently look different', () => {
    const one = binderArt(makeBinder({ skinToneId: 'tone-1', hairColorId: 'hair-wheat' }));
    const other = binderArt(makeBinder({ skinToneId: 'tone-6', hairColorId: 'hair-dark' }));
    expect(one).not.toEqual(other);
  });

  it('does not change how a Binder looks when they change their name', () => {
    const appearance = { skinToneId: 'tone-2', outfitId: 'robes' };
    expect(binderArt(makeBinder(appearance, 'Wren Ashford'))).toEqual(
      binderArt(makeBinder(appearance, 'Sable Marrow')),
    );
  });
});

describe('the look a new character starts with', () => {
  it('arrives already wearing the colour of the creature the player just made', () => {
    for (const type of allTypes) {
      const appearance = defaultAppearanceFor(type.id);
      expect(appearance.accentTypeId).toBe(type.id);
      expect(paletteForBinder(appearance).accent).toBe(type.color);
    }
  });

  it('changes nothing except the accent colour', () => {
    const base = defaultBinderAppearance();
    expect(defaultAppearanceFor('tide')).toEqual({ ...base, accentTypeId: 'tide' });
  });

  it('leaves the starting look alone when handed a type that does not exist', () => {
    expect(defaultAppearanceFor('not-a-real-type')).toEqual(defaultBinderAppearance());
  });

  it('hands back a fresh look each time, so editing one player cannot edit another', () => {
    const first = defaultAppearanceFor('bloom');
    const second = defaultAppearanceFor('bloom');
    first.hairStyleId = 'shaved';
    expect(second.hairStyleId).toBe(defaultBinderAppearance().hairStyleId);
  });
});

describe('suggesting a name', () => {
  it('suggests a first name and a surname taken from the data file', () => {
    const [first, second] = generateBinderName(createRng(7)).split(' ');
    expect(binderContent.nameParts.first).toContain(first);
    expect(binderContent.nameParts.second).toContain(second);
  });

  it('suggests the very same name again from the same seed', () => {
    expect(generateBinderName(createRng(42))).toBe(generateBinderName(createRng(42)));
  });

  it('suggests plenty of different names across different seeds', () => {
    const names = new Set(
      Array.from({ length: 200 }, (_, seed) => generateBinderName(createRng(seed))),
    );
    expect(names.size).toBeGreaterThan(20);
  });

  it('can eventually suggest every name part the data file offers', () => {
    const suggested = Array.from({ length: 2000 }, (_, seed) => generateBinderName(createRng(seed)));
    for (const part of binderContent.nameParts.first) {
      expect(suggested.some((n) => n.startsWith(`${part} `))).toBe(true);
    }
    for (const part of binderContent.nameParts.second) {
      expect(suggested.some((n) => n.endsWith(` ${part}`))).toBe(true);
    }
  });

  it('never suggests a name too long to keep', () => {
    for (let seed = 0; seed < 500; seed++) {
      const suggestion = generateBinderName(createRng(seed));
      expect(suggestion.length).toBeLessThanOrEqual(binderContent.nameMaxLength);
      expect(sanitizeBinderName(suggestion)).toBe(suggestion);
    }
  });
});

describe('tidying up a name the player typed', () => {
  it('leaves a sensible name exactly as it was typed', () => {
    expect(sanitizeBinderName('Wren Ashford')).toBe('Wren Ashford');
  });

  it('trims the spaces off both ends', () => {
    expect(sanitizeBinderName('   Orin Vale  ')).toBe('Orin Vale');
  });

  it('collapses a run of spaces in the middle down to one', () => {
    expect(sanitizeBinderName('Neve      Thorne')).toBe('Neve Thorne');
  });

  it('turns a pasted line break into a single space', () => {
    expect(sanitizeBinderName('Rook\nQuill')).toBe('Rook Quill');
  });

  it('turns a tab into a single space', () => {
    expect(sanitizeBinderName('Fen\tHollow')).toBe('Fen Hollow');
  });

  it('strips characters that would show up as empty boxes', () => {
    expect(sanitizeBinderName(`Lyra${String.fromCharCode(0)}Vale`)).toBe('Lyra Vale');
  });

  it('cuts a very long name down to the limit', () => {
    const long = 'A'.repeat(200);
    expect(sanitizeBinderName(long)).toHaveLength(binderContent.nameMaxLength);
  });

  it('never leaves a name ending in a space after cutting it', () => {
    const awkward = `${'A'.repeat(binderContent.nameMaxLength - 1)} Bxxxxx`;
    const tidied = sanitizeBinderName(awkward);
    expect(tidied).toBe('A'.repeat(binderContent.nameMaxLength - 1));
    expect(tidied.endsWith(' ')).toBe(false);
  });

  it('keeps a name that is exactly as long as the limit allows', () => {
    const exact = 'A'.repeat(binderContent.nameMaxLength);
    expect(sanitizeBinderName(exact)).toBe(exact);
  });

  it('suggests a name rather than leaving the player nameless when the field is empty', () => {
    const tidied = sanitizeBinderName('');
    expect(tidied.length).toBeGreaterThan(0);
    expect(binderContent.nameParts.first).toContain(tidied.split(' ')[0]);
  });

  it('suggests a name when the player types nothing but spaces', () => {
    expect(sanitizeBinderName('     ').length).toBeGreaterThan(0);
  });

  it('uses the given rng to pick the suggestion it falls back to', () => {
    expect(sanitizeBinderName('', createRng(3))).toBe(generateBinderName(createRng(3)));
  });
});
