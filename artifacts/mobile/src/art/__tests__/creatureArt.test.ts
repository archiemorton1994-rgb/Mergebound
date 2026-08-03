import { describe, expect, it } from 'vitest';
import { allSpecies } from '../../game/content';
import { makeCreature } from '../../game/__tests__/helpers';
import {
  AURA_GLOW_TIER,
  AURA_SHARD_TIER,
  BODY_SHAPES,
  FALLBACK_COLOR,
  FALLBACK_SHAPE,
  SPARKLE_ROLL_THRESHOLD,
  auraLevelForTier,
  creatureArt,
  darken,
  hasPerfectRoll,
  hexToRgb,
  lighten,
  mixHex,
  paletteFor,
  rgbToHex,
  shapeForSpecies,
} from '../creatureArt';

describe('body shapes', () => {
  it('gives every species in the game its own silhouette', () => {
    const shapes = allSpecies.map((s) => shapeForSpecies(s.id));
    expect(new Set(shapes).size).toBe(allSpecies.length);
  });

  it('only ever returns a shape the renderer knows how to draw', () => {
    for (const species of allSpecies) {
      expect(BODY_SHAPES).toContain(shapeForSpecies(species.id));
    }
  });

  it('falls back to a known shape for a species it has never seen', () => {
    expect(shapeForSpecies('not-a-real-species')).toBe(FALLBACK_SHAPE);
  });
});

describe('colour maths', () => {
  it('reads a six-digit hex colour', () => {
    expect(hexToRgb('#E4572E')).toEqual({ r: 228, g: 87, b: 46 });
  });

  it('reads a three-digit shorthand hex colour', () => {
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('reads a hex colour written without the hash', () => {
    expect(hexToRgb('4C9F70')).toEqual({ r: 76, g: 159, b: 112 });
  });

  it('returns black rather than throwing when the colour is not valid hex', () => {
    expect(hexToRgb('rebeccapurple')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('survives a round trip from hex to rgb and back', () => {
    expect(rgbToHex(hexToRgb('#3a7ca5'))).toBe('#3a7ca5');
  });

  it('returns the first colour when mixing nothing of the second', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
  });

  it('returns the second colour when mixing all of it', () => {
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('lands halfway when mixing evenly', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('clamps a mix amount above one instead of overshooting', () => {
    expect(mixHex('#000000', '#ffffff', 5)).toBe('#ffffff');
  });

  it('clamps a negative mix amount instead of undershooting', () => {
    expect(mixHex('#000000', '#ffffff', -5)).toBe('#000000');
  });

  it('makes a colour lighter without passing white', () => {
    expect(lighten('#808080', 1)).toBe('#ffffff');
  });

  it('makes a colour darker without passing black', () => {
    expect(darken('#808080', 1)).toBe('#000000');
  });
});

describe('palette', () => {
  it('uses the primary type colour as the body colour', () => {
    const palette = paletteFor(makeCreature({ types: ['tide'] }));
    expect(palette.body).toBe('#3A7CA5');
  });

  it('uses the second type colour as the accent on a dual-typed creature', () => {
    const palette = paletteFor(makeCreature({ types: ['tide', 'ember'] }));
    expect(palette.accent).toBe('#E4572E');
  });

  it('gives a single-typed creature an accent tinted from its own colour', () => {
    const palette = paletteFor(makeCreature({ types: ['tide'] }));
    expect(palette.accent).not.toBe(palette.body);
    expect(palette.accent).toBe(lighten('#3A7CA5', 0.45));
  });

  it('keeps the outline darker than the body so the silhouette reads', () => {
    const palette = paletteFor(makeCreature({ types: ['volt'] }));
    const body = hexToRgb(palette.body);
    const outline = hexToRgb(palette.outline);
    expect(outline.r + outline.g + outline.b).toBeLessThan(body.r + body.g + body.b);
  });

  it('falls back to a neutral colour instead of throwing on an unknown type', () => {
    const palette = paletteFor(makeCreature({ types: ['not-a-real-type'] }));
    expect(palette.body).toBe(FALLBACK_COLOR);
  });

  it('falls back to a neutral colour instead of throwing when a creature has no types', () => {
    const palette = paletteFor(makeCreature({ types: [] }));
    expect(palette.body).toBe(FALLBACK_COLOR);
  });
});

describe('aura', () => {
  it('gives a low-tier creature no aura', () => {
    expect(auraLevelForTier(0)).toBe(0);
    expect(auraLevelForTier(AURA_GLOW_TIER - 1)).toBe(0);
  });

  it('gives a mid-tier creature a glow', () => {
    expect(auraLevelForTier(AURA_GLOW_TIER)).toBe(1);
    expect(auraLevelForTier(AURA_SHARD_TIER - 1)).toBe(1);
  });

  it('gives a high-tier creature the strongest aura', () => {
    expect(auraLevelForTier(AURA_SHARD_TIER)).toBe(2);
    expect(auraLevelForTier(99)).toBe(2);
  });
});

describe('sparkle', () => {
  it('sparkles when any single stat rolled near-perfectly', () => {
    const creature = makeCreature();
    creature.statRolls.critChance = SPARKLE_ROLL_THRESHOLD;
    expect(hasPerfectRoll(creature)).toBe(true);
  });

  it('does not sparkle when every stat rolled below the threshold', () => {
    const creature = makeCreature();
    for (const key of Object.keys(creature.statRolls) as (keyof typeof creature.statRolls)[]) {
      creature.statRolls[key] = SPARKLE_ROLL_THRESHOLD - 1;
    }
    expect(hasPerfectRoll(creature)).toBe(false);
  });
});

describe('creatureArt', () => {
  it('describes a plain starter creature with no flourish', () => {
    const art = creatureArt(makeCreature({ speciesId: 'mossling', tier: 0, types: ['bloom'] }));
    expect(art.shape).toBe('leaf');
    expect(art.auraLevel).toBe(0);
    expect(art.sparkle).toBe(false);
    expect(art.palette.body).toBe('#4C9F70');
  });

  it('describes a high-tier dual-typed creature with aura and both colours', () => {
    const creature = makeCreature({
      speciesId: 'boulderb',
      tier: AURA_SHARD_TIER,
      types: ['crag', 'volt'],
    });
    creature.statRolls.hp = 100;
    const art = creatureArt(creature);
    expect(art.shape).toBe('boulder');
    expect(art.auraLevel).toBe(2);
    expect(art.sparkle).toBe(true);
    expect(art.palette.body).toBe('#8D6A4F');
    expect(art.palette.accent).toBe('#E8B21D');
  });
});
