/**
 * Pure visual derivation for creatures — decides *what* a creature should look
 * like; drawing it is the UI's job (see src/screens/CreatureSprite.tsx).
 *
 * Pure TypeScript — no React, no UI imports — so every visual decision is
 * unit-testable, same as the game rules.
 *
 * Deliberately derives everything from data the creature already carries, so
 * any species/type combination a merge can produce is covered without an
 * artist authoring a new asset. Species chooses the silhouette, types choose
 * the palette, tier and roll quality add flourish.
 */

import { getType } from '../game/content';
import { STAT_KEYS, type Creature } from '../game/models';

export const BODY_SHAPES = [
  'flame',
  'leaf',
  'droplet',
  'wing',
  'boulder',
  'spark',
  'wisp',
  'crystal',
] as const;

export type BodyShape = (typeof BODY_SHAPES)[number];

/**
 * One silhouette per species. Species is the stable identity across merges
 * (it's inherited from the higher-tier parent), so it's the right thing to
 * hang the body shape on — a creature keeps its shape and changes its colours.
 */
const SHAPE_BY_SPECIES: Record<string, BodyShape> = {
  cindret: 'flame',
  mossling: 'leaf',
  puddlet: 'droplet',
  zephyrl: 'wing',
  boulderb: 'boulder',
  sparkit: 'spark',
  gloomo: 'wisp',
  shimmet: 'crystal',
};

/** Used when a species has no silhouette yet. Art must never crash a screen. */
export const FALLBACK_SHAPE: BodyShape = 'droplet';

/** Used when a type id can't be resolved, for the same reason. */
export const FALLBACK_COLOR = '#8a8f98';

export function shapeForSpecies(speciesId: string): BodyShape {
  return SHAPE_BY_SPECIES[speciesId] ?? FALLBACK_SHAPE;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Accepts `#rgb`, `#rrggbb`, or the same without the hash. Never throws. */
export function hexToRgb(hex: string): Rgb {
  const cleaned = hex.trim().replace(/^#/, '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned.padEnd(6, '0').slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(rgb: Rgb): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** Linear blend between two colours. `t` is clamped to 0..1. */
export function mixHex(a: string, b: string, t: number): string {
  const amount = Math.max(0, Math.min(1, t));
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  return rgbToHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  });
}

export function lighten(hex: string, amount: number): string {
  return mixHex(hex, '#ffffff', amount);
}

export function darken(hex: string, amount: number): string {
  return mixHex(hex, '#000000', amount);
}

function typeColor(typeId: string | undefined): string {
  if (!typeId) return FALLBACK_COLOR;
  try {
    return getType(typeId).color;
  } catch {
    return FALLBACK_COLOR;
  }
}

export interface Palette {
  /** Primary type's colour — the main body fill. */
  body: string;
  /** Lighter body tone, for the top of the body gradient and the aura. */
  bodyLight: string;
  /** Darker body tone, for underside shading. */
  bodyShade: string;
  /**
   * Secondary type's colour, used for belly/wing/marking detail. A
   * single-typed creature has no second colour, so it gets a lightened
   * version of its own — which is exactly why dual-typed creatures read as
   * visibly more elaborate, reinforcing merging as the way to get there.
   */
  accent: string;
  outline: string;
  eye: string;
}

export function paletteFor(creature: Creature): Palette {
  const primary = typeColor(creature.types[0]);
  const secondaryId = creature.types[1];
  return {
    body: primary,
    bodyLight: lighten(primary, 0.3),
    bodyShade: darken(primary, 0.32),
    accent: secondaryId ? typeColor(secondaryId) : lighten(primary, 0.45),
    outline: darken(primary, 0.55),
    eye: darken(primary, 0.7),
  };
}

/** 0 = none, 1 = soft glow, 2 = strong glow plus orbiting shards. */
export type AuraLevel = 0 | 1 | 2;

export const AURA_GLOW_TIER = 3;
export const AURA_SHARD_TIER = 5;

export function auraLevelForTier(tier: number): AuraLevel {
  if (tier >= AURA_SHARD_TIER) return 2;
  if (tier >= AURA_GLOW_TIER) return 1;
  return 0;
}

/**
 * Matches the gold threshold CreatureCard already uses for stat text, so a
 * creature whose numbers are showing gold also visibly sparkles. Chasing
 * perfect rolls is the long-game hook — it should be readable at a glance,
 * not only by reading eight numbers.
 */
export const SPARKLE_ROLL_THRESHOLD = 90;

export function hasPerfectRoll(creature: Creature): boolean {
  return STAT_KEYS.some((key) => creature.statRolls[key] >= SPARKLE_ROLL_THRESHOLD);
}

export interface CreatureArt {
  shape: BodyShape;
  palette: Palette;
  auraLevel: AuraLevel;
  sparkle: boolean;
}

export function creatureArt(creature: Creature): CreatureArt {
  return {
    shape: shapeForSpecies(creature.speciesId),
    palette: paletteFor(creature),
    auraLevel: auraLevelForTier(creature.tier),
    sparkle: hasPerfectRoll(creature),
  };
}
