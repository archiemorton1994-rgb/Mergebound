/**
 * Core game data shapes. Pure TypeScript — no React, no UI imports.
 */

/** The eight stats every creature has. Single source of truth for iteration order. */
export const STAT_KEYS = [
  'hp',
  'atk',
  'spAtk',
  'def',
  'spDef',
  'spd',
  'critChance',
  'critDamage',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type Stats = Record<StatKey, number>;

/** critChance/critDamage are stored as plain percentages (6 = 6%, 150 = 150%). */
export const PERCENT_STAT_KEYS: readonly StatKey[] = ['critChance', 'critDamage'];

export interface Creature {
  /** Unique id. */
  id: string;
  /** References an entry in src/data/species.json. */
  speciesId: string;
  name: string;
  /** Integer, starts at 0. */
  tier: number;
  /** 1 or 2 type ids, never more. */
  types: string[];
  stats: Stats;
  /**
   * Where each stat's roll landed within its variance band the last time it
   * was rolled (hatch, or the most recent merge), as a 0-100 percentile.
   * 100 = the best possible roll that hatch/merge could have produced.
   * This is what makes "perfect rolls" a visible, chaseable thing — a
   * creature can have a 98 on critChance and a 6 on hp at the same time.
   */
  statRolls: Stats;
  /** The two creatures this was merged from. Empty for hatched creatures. */
  parentIds: string[];
}

export interface SpeciesDef {
  id: string;
  name: string;
  /** Placeholder for future art — file path or null. */
  sprite: string | null;
  baseStats: Stats;
}

export type TypeRarity = 'common' | 'rare' | 'mythic';

export interface TypeDef {
  id: string;
  name: string;
  color: string;
  rarity: TypeRarity;
}

/** Which attack stat a move uses: atk/def for physical, spAtk/spDef for special. */
export type MoveCategory = 'physical' | 'special';

interface MoveBase {
  id: string;
  name: string;
  /** 0-100 chance to hit. */
  accuracy: number;
}

/** A plain damage move against one enemy, granted by a single type. */
export interface DamageMove extends MoveBase {
  kind: 'damage';
  category: MoveCategory;
  typeId: string;
  /** Damage scale — see computeDamage in battle.ts for the full formula. */
  power: number;
}

/** A support move that restores HP instead of dealing damage, granted by a single type. */
export interface HealMove extends MoveBase {
  kind: 'heal';
  typeId: string;
  /** 'lowest-ally' heals whichever living ally (including the user) has the lowest HP%; 'party' heals every living ally a little. */
  target: 'lowest-ally' | 'party';
  /** Fraction of the target's max HP restored, e.g. 0.3 = 30%. Never overheals past max. */
  healFraction: number;
}

/** A damage move that also heals its user for a fraction of the damage dealt, granted by a single type. */
export interface DrainMove extends MoveBase {
  kind: 'drain';
  category: MoveCategory;
  typeId: string;
  power: number;
  /** Fraction of the damage dealt that heals the user, e.g. 0.5 = 50%. */
  drainFraction: number;
}

/**
 * A signature move only a dual-typed creature knows, drawing on both of its
 * types at once — the "perk" of merging into a specific type combination.
 * Effectiveness is the average of both component types' multipliers against
 * the defender (see effectivenessForMove in content.ts), so it's usually
 * decent against everything rather than a hard counter or a dead loss.
 */
export interface HybridMove extends MoveBase {
  kind: 'hybrid';
  category: MoveCategory;
  typeIds: [string, string];
  power: number;
}

export type MoveDef = DamageMove | HealMove | DrainMove | HybridMove;

/** A random source: returns a float in [0, 1). Seeded implementations live in rng.ts. */
export type Rng = () => number;

// --- Persistent player state ------------------------------------------------
// These are the shapes that survive between sessions. Everything here is
// serialised by save.ts, so changing any of them needs a SAVE_VERSION bump and
// a migration in the same change — see the note at the top of save.ts.

/** The three currencies. Roles are fixed in DESIGN.md and must not drift. */
export interface Wallet {
  /** Earned constantly, from battles and idle income. Spends on gear and merge stones. */
  gold: number;
  /** Spent to merge. Earned through play, or bought with gold — never with real money directly. */
  mergeStones: number;
  /** Premium. Bought with money or won in small one-time amounts. Buys time and vanity, never power. */
  gems: number;
}

/**
 * Everything the economy needs to remember between sessions.
 *
 * `dayIndex` is a monotonic high-water mark, not simply "today" — it never
 * decreases, however the device clock is set. Every daily cap keys off it, so
 * winding the clock backwards cannot reset a single one of them.
 */
export interface EconomyState {
  /** When idle income was last banked. 0 means "never" and is filled in on first load. */
  lastCollectedAt: number;
  /** Monotonic day counter. -1 means "not yet stamped". */
  dayIndex: number;
  stonesEarnedToday: number;
  /** Doubles as the exchange escalator step — the Nth stone bought today costs more. */
  stonesPurchasedToday: number;
  /** Counted for diagnostics only. A player is never punished for a clock jump. */
  clockAnomalies: number;
}

export type StarCount = 0 | 1 | 2 | 3;

export interface StageProgress {
  bestStars: StarCount;
  /** Fewest rounds this stage has ever been cleared in. 0 means never cleared. */
  bestRounds: number;
  clears: number;
  /** Attempts today — wins AND losses, so a player cannot farm by losing. */
  attemptsToday: number;
  /** The day those attempts belong to. A stale day means the count is treated as 0. */
  attemptsDay: number;
}

export interface CampaignProgress {
  stages: Record<string, StageProgress>;
  claimedChests: string[];
}

/** Every axis of the Binder's look. All ids reference src/data/binder.json. */
export interface BinderAppearance {
  buildId: string;
  skinToneId: string;
  hairStyleId: string;
  hairColorId: string;
  outfitId: string;
  outfitToneId: string;
  /** Names a type id — the colour itself comes from types.json. */
  accentTypeId: string;
  markId: string;
}

export interface Binder {
  /** Empty string means the player has not named themselves yet. */
  name: string;
  appearance: BinderAppearance;
}

/**
 * Where a player is in the first-run flow. Stored rather than inferred so that
 * force-quitting mid-tutorial resumes exactly where it left off.
 */
export type OnboardingStep =
  | 'first-egg'
  | 'second-egg'
  | 'first-merge'
  | 'binder-look'
  | 'binder-name'
  | 'first-battle'
  | 'complete';

export interface OnboardingState {
  step: OnboardingStep;
  /** Fixes the tutorial's eggs, so a resumed tutorial shows the same ones. */
  seed: number;
  seenTips: string[];
}

export interface ShopState {
  purchasedOneTimeIds: string[];
  ownedCosmeticIds: string[];
  /** Cosmetic slot id -> owned cosmetic id. */
  equippedCosmetics: Record<string, string>;
}
