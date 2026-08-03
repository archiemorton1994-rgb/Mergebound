/**
 * Pure visual derivation for the Binder — the player's own character. Decides
 * *what* the Binder looks like; drawing it is the UI's job (see
 * src/screens/BinderSprite.tsx). Same split as creatureArt.ts: anything that
 * could be phrased as a rule lives here where it can be tested, and only path
 * geometry belongs in the component.
 *
 * Pure TypeScript — no React, no UI imports.
 *
 * The Binder is never a combatant (DESIGN.md), so nothing here is derived from
 * stats, tier or power. It comes entirely from choices the player made, which
 * the save stores as a handful of ids (BinderAppearance) and this module
 * resolves against src/data/binder.json.
 *
 * Every lookup degrades instead of throwing. A save can name a cosmetic id that
 * a later content edit renamed or dropped, and the one thing that must never
 * happen is the player's own character failing to appear — a hole where a
 * person should be reads as "the game lost my character", which is much worse
 * than showing them in last season's haircut.
 */

import { allTypes, binderContent, defaultBinderAppearance } from '../game/content';
import type { Binder, BinderAppearance, Rng } from '../game/models';
import { pickOne } from '../game/rng';
import { FALLBACK_COLOR, darken, lighten } from './creatureArt';

/**
 * How far each derived tone is pushed from the colour the player actually
 * picked. These are shading amounts, not balance or content numbers — a player
 * never chooses them and no rule reads them — so they live beside the art the
 * way creatureArt.ts's do. Push them much further and the figure stops reading
 * as one material lit by one light; much less and the shading disappears
 * entirely at the size the Binder is drawn in the HUD.
 */
const SKIN_SHADE = 0.24;
const HAIR_SHADE = 0.3;
const OUTFIT_LIGHT = 0.16;
const OUTFIT_SHADE = 0.3;
const OUTLINE_SHADE = 0.6;
const EYE_SHADE = 0.66;

/**
 * Find an option by id, falling back to the default option and then to the
 * first one authored. Returns undefined only if the list itself is empty,
 * which the data file makes impossible — callers still handle it rather than
 * asserting, because an art module must never be the thing that throws.
 */
function resolveOption<T extends { id: string }>(
  options: readonly T[],
  id: string,
  fallbackId: string,
): T | undefined {
  return options.find((o) => o.id === id) ?? options.find((o) => o.id === fallbackId) ?? options[0];
}

/** Non-throwing type lookup — getType() throws, and unknown ids are expected here. */
function typeColor(typeId: string): string | undefined {
  return allTypes.find((t) => t.id === typeId)?.color;
}

/** True if this type id is one the game actually has. */
function isKnownType(typeId: string): boolean {
  return allTypes.some((t) => t.id === typeId);
}

export interface BinderPalette {
  /** The chosen skin tone — face, hands, neck. */
  skin: string;
  /** Underside shading for skin, e.g. below the jaw. */
  skinShade: string;
  hair: string;
  /** Darker hair tone, for the parting and the underside of a fringe. */
  hairShade: string;
  /** The chosen outfit tone — the largest area of colour on the figure. */
  outfit: string;
  /** Lit side of the outfit. */
  outfitLight: string;
  /** Shadowed side of the outfit. */
  outfitShade: string;
  /**
   * Trim, mark and any glow. This is the ONE colour the Binder does not own:
   * it is the accent type's colour, read from types.json. binder.json
   * deliberately carries no colour list for this axis, so adding a tenth type
   * to the game gives the Binder a tenth accent for free, with no matching
   * edit needed in the Binder data or here. It is also what lets the character
   * arrive already wearing the colour of the first creature the player made —
   * see defaultAppearanceFor.
   */
  accent: string;
  /**
   * One outline for the whole figure, taken from the outfit rather than from
   * each part's own colour, so the silhouette reads as a single person instead
   * of three separately outlined pieces at HUD size.
   */
  outline: string;
  eye: string;
}

export function paletteForBinder(appearance: BinderAppearance): BinderPalette {
  const fallback = defaultBinderAppearance();
  const skin =
    resolveOption(binderContent.skinTones, appearance.skinToneId, fallback.skinToneId)?.color ??
    FALLBACK_COLOR;
  const hair =
    resolveOption(binderContent.hairColors, appearance.hairColorId, fallback.hairColorId)?.color ??
    FALLBACK_COLOR;
  const outfit =
    resolveOption(binderContent.outfitTones, appearance.outfitToneId, fallback.outfitToneId)
      ?.color ?? FALLBACK_COLOR;
  const accent =
    typeColor(appearance.accentTypeId) ?? typeColor(fallback.accentTypeId) ?? FALLBACK_COLOR;

  return {
    skin,
    skinShade: darken(skin, SKIN_SHADE),
    hair,
    hairShade: darken(hair, HAIR_SHADE),
    outfit,
    outfitLight: lighten(outfit, OUTFIT_LIGHT),
    outfitShade: darken(outfit, OUTFIT_SHADE),
    accent,
    outline: darken(outfit, OUTLINE_SHADE),
    eye: darken(skin, EYE_SHADE),
  };
}

export interface BinderProportions {
  /** Multiplier on shoulder width. */
  shoulderScale: number;
  /** Multiplier on overall height. */
  heightScale: number;
}

/**
 * The build's scales, from binder.json. An unrecognised build falls back to the
 * default build; 1 is the identity — "draw the figure exactly as authored" —
 * and is only reached if the build list itself were empty.
 */
export function proportionsFor(buildId: string): BinderProportions {
  const build = resolveOption(binderContent.builds, buildId, defaultBinderAppearance().buildId);
  return {
    shoulderScale: build?.shoulderScale ?? 1,
    heightScale: build?.heightScale ?? 1,
  };
}

export interface BinderArt {
  palette: BinderPalette;
  proportions: BinderProportions;
  /** Which hair silhouette to draw. Always an id the data file still contains. */
  hairStyleId: string;
  /** Which outfit silhouette to draw. Always an id the data file still contains. */
  outfitId: string;
  /** Which face/body mark to draw, in the accent colour. 'none' draws nothing. */
  markId: string;
}

export function binderArt(binder: Binder): BinderArt {
  const appearance = binder.appearance;
  const fallback = defaultBinderAppearance();
  return {
    palette: paletteForBinder(appearance),
    proportions: proportionsFor(appearance.buildId),
    hairStyleId:
      resolveOption(binderContent.hairStyles, appearance.hairStyleId, fallback.hairStyleId)?.id ??
      fallback.hairStyleId,
    outfitId:
      resolveOption(binderContent.outfits, appearance.outfitId, fallback.outfitId)?.id ??
      fallback.outfitId,
    markId:
      resolveOption(binderContent.marks, appearance.markId, fallback.markId)?.id ?? fallback.markId,
  };
}

/**
 * The starting look, wearing a given type's colour.
 *
 * Onboarding calls this with the type of the creature the player has just
 * merged, so the character forms out of that merge already matching it rather
 * than as a stranger the player then has to fix. An unknown type id keeps the
 * default accent — the character still arrives, just in the default colour.
 *
 * Returns a fresh object every call (defaultBinderAppearance does the same),
 * because a shared constant would mean editing one player's Binder edits every
 * save that ever migrated onto one.
 */
export function defaultAppearanceFor(primaryTypeId: string): BinderAppearance {
  const base = defaultBinderAppearance();
  return isKnownType(primaryTypeId) ? { ...base, accentTypeId: primaryTypeId } : base;
}

/**
 * Suggest a name, e.g. "Wren Ashford". A suggestion is always pre-filled into
 * the name field because an empty text box is the single most common place a
 * first session is abandoned — the player should be renaming something, never
 * inventing something from nothing.
 */
export function generateBinderName(rng: Rng): string {
  const { first, second } = binderContent.nameParts;
  return `${pickOne(rng, first)} ${pickOne(rng, second)}`;
}

/**
 * Everything a name is not allowed to contain, as ranges of code points. None
 * of these are tunable numbers — they are Unicode's own boundaries, not ours,
 * which is why they live here rather than in binder.json.
 *
 * Two kinds of character, both of which have to go for the same reason: the
 * name is drawn as one short line of text in the HUD on every screen, and
 * neither kind can be seen there.
 *  - Control characters render as stray boxes, and a pasted newline would break
 *    the line the name sits on.
 *  - Zero-width and blank characters render as nothing at all, which is worse:
 *    they make a name that looks empty but is not, so it slips past the "never
 *    leave the player nameless" fallback below and leaves a permanent gap where
 *    the name should be.
 */
const UNRENDERABLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f], // C0 controls, including tab and newline
  [0x7f, 0x9f], // DEL and the C1 control block — arrives by pasting out of a word processor
  [0xad, 0xad], // soft hyphen
  [0x200b, 0x200f], // zero-width space and joiners, left/right marks
  [0x202a, 0x202e], // bidirectional embeds and overrides, which reverse the text after them
  [0x2060, 0x206f], // word joiner, invisible operators, directional isolates
  [0x2800, 0x2800], // braille pattern blank
  [0x3164, 0x3164], // Hangul filler
  [0xd800, 0xdfff], // half of a character, orphaned — see cutWithoutSplittingACharacter
  [0xfeff, 0xfeff], // zero-width no-break space
];

function isUnrenderable(code: number): boolean {
  return UNRENDERABLE_RANGES.some(([lowest, highest]) => code >= lowest && code <= highest);
}

/**
 * Swap every unrenderable character for a space.
 *
 * A space rather than nothing, so the collapse-and-trim that follows disposes of
 * them for free: between two words they become the single space they already
 * look like, and a name made of nothing else collapses to the empty string and
 * takes a suggestion instead.
 *
 * Iterating with for...of walks whole code points, so a correctly paired emoji
 * arrives here as one character and is never mistaken for a stray surrogate —
 * only a genuinely orphaned half of one falls in the surrogate range.
 */
function withoutUnrenderableCharacters(value: string): string {
  let out = '';
  for (const ch of value) {
    out += isUnrenderable(ch.codePointAt(0) ?? 0) ? ' ' : ch;
  }
  return out;
}

/**
 * Cut to the length cap without slicing a character in half.
 *
 * The cap counts UTF-16 units — JavaScript's own idea of a string's length, and
 * what the HUD's width budget was measured against — but an emoji is two of
 * them, so a cut can land between an emoji's two halves and leave one behind.
 * Half a character renders as a box, survives being saved and reloaded intact,
 * and is not repaired by tidying the name again. A Binder is named exactly once
 * during onboarding and the game has no rename screen, so that box would be on
 * screen, on every screen, forever.
 */
function cutWithoutSplittingACharacter(value: string, maxUnits: number): string {
  const cut = value.slice(0, maxUnits);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  // The value being cut has already had orphaned halves swapped out, so a
  // trailing leading-surrogate can only be one this cut has just orphaned.
  return lastUnit >= 0xd800 && lastUnit <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Tidy a name the player typed: strip anything unrenderable, collapse runs of
 * whitespace, trim, and cut to binder.json's nameMaxLength.
 *
 * If nothing usable survives, hand back a suggestion rather than an empty
 * string — a nameless Binder shows as a gap in the HUD on every screen, and
 * nothing later in the game forces the player to go back and fix it. Which
 * suggestion it is matters far less than that there is one, so an omitted rng
 * simply takes the first parts in the list.
 *
 * "Nothing usable" has to mean "nothing anybody can see", not "no characters at
 * all": a name of zero-width characters is a non-empty string that draws as the
 * same gap. Stripping them above is what makes the emptiness test below true of
 * both.
 */
export function sanitizeBinderName(raw: string, rng?: Rng): string {
  // Defensive String(): this value can come straight off a hand-edited save.
  const collapsed = withoutUnrenderableCharacters(String(raw ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  // Trim again after cutting, in case the cut landed in the middle of a space.
  const capped = cutWithoutSplittingACharacter(collapsed, binderContent.nameMaxLength).trim();
  return capped.length > 0 ? capped : generateBinderName(rng ?? (() => 0));
}
