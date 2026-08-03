`pnpm run check` verified green at baseline (176 tests / 8 files, typecheck exit 0). Every claim below was checked against the real source, not the designs' summaries.

---

# MergeBound — Implementation Specification

**Repo:** `C:\dev\Mergebound` · **App:** `C:\dev\Mergebound\artifacts\mobile`
**Verified baseline:** `pnpm run check` exits 0 — 176 tests, 8 files, typecheck clean.

---

## 1. Verified facts that drive every decision below

I re-derived these from the actual code and data rather than trusting the subsystem designs.

| Claim | Verified result |
|---|---|
| `cumulativeStatMultiplier` by tier | `1, 1.5, 3.3, 10.56, 48.58, 315.74, 2841.7, 25575, 230177` |
| Crit stats inherit the tier multiplier (`rollAllStats` hatch.ts:34-38, `mergedStats` merge.ts:68-77 loop all `STAT_KEYS`) | **Confirmed.** Cindret at T4: `critChance 291%`, `critDamage 7529%`. At T6: `critChance 17050%`, `critDamage 440463%` (a 4405× multiplier). `computeDamage` battle.ts:94 is `rng() < critChance/100`, so **every hit crits from tier 4 up.** `PERCENT_STAT_KEYS` exists (models.ts:22) and is unused by game logic. |
| Damage does not scale with tier (`raw = power * (atk/def)`, battle.ts:92 — the ratio cancels) | **Confirmed.** Mirror-match hits-to-kill: T0 `0.48`, T2 `1.58`, T3 `5.07`, T4 `23.3`, T6 `1364`. |
| `BattleLogEntry` has no `targetId`/`targetSide`; `targetName` is the **species** name | **Confirmed** (battle.ts:45-58, set from `species.name`). Three Cindret in a party are indistinguishable. |
| Manual battles never produce a `BattleResult` from the engine | **Confirmed.** `BattleScreen.tsx` `finish()` hand-builds `{winner, log, rounds}` in the `.tsx`. The economy design's *"rewards.ts requires ZERO changes to battle.ts"* is **false**. |
| `.expo/types/router.d.ts` knows only `/battle`, `/`, `/_sitemap`, `/+not-found`; `.expo/` is gitignored | **Confirmed.** New routes fail local typecheck until regenerated; on a fresh Replit clone the file is absent so typed routes aren't enforced there — **local is stricter than CI.** |
| Reanimated / worklets babel risk | **NOT a risk — struck.** `babel-preset-expo` build/index.js:289 auto-injects `require('react-native-worklets/plugin')`, and `react-native-worklets@0.5.1` is hoisted to `node_modules/.pnpm/node_modules/` with `plugin/index.js` present. **Do not edit `babel.config.js`** — that would double-apply the transform. |
| "Draw-count changes break pinned tests" | **Overstated.** Every existing test is property-based or uses a constant rng (`() => 0.5`, `() => 1`). No test pins a creature from a seed. Adding optional options args is safe. |
| No IAP SDK installed | **Confirmed.** No `react-native-iap`, no `expo-iap`, no audio package. Installed and unused: `react-native-reanimated`, `react-native-worklets`, `expo-linear-gradient`, `expo-blur`, `expo-system-ui`. |
| Roll probabilities per merge (8 independent stats) | `P(any ≥90) = 56.95%`, `P(any ≥85) = 72.75%`, `P(any = 100) = 3.93%` |

---

## 2. Every blocking issue, resolved

### B1 — Merge stone cost specified twice, incompatibly
**Decision: Currency design wins.** `economy.json → merge.stoneCostByInputTier = [0,1,3,8,20,50,125,300]`, indexed by the **stronger parent's tier**, cross-tier at half price (rounded up).
**Why:** only input-tier indexing can express `[0] = 0`, which is the structural no-wall guarantee — a player with an empty wallet can always make tier-1 creatures because eggs are free. The merge-loop design's result-tier table charges 1 stone for the very first merge, which breaks both the guarantee and onboarding's "Merge — Free" beat. Charging cross-tier full price also punishes the type-reroll tool twice (it already pays in diluted stats per CLAUDE.md line 29).
**Delete:** `mergeStoneCostByTier`, and `content.ts mergeStoneCost(resultingTier)`. One function: `economy.ts → mergeStoneCost(a, b)`.

Verified total stones to build one creature from tier-0s: T3 = **5**, T4 = **18**, T5 = **56**, T6 = **162**.

### B2 — Merge pity is manufacturable, and money accelerates it
This is the one genuine break of an inviolable rule, and it lives in a seam nobody owned.
**Decision: the pity countdown only advances on merges that cost merge stones.**

```ts
// merge.ts — inside mergeWithPity, before anything else
const advancesPity = mergeStoneCost(a, b) > 0;   // imported from ./economy
// if !advancesPity: never trigger, never increment, never reset. Free merges are
// invisible to the pity system entirely.
```
`merge.ts → economy.ts → content.ts` is a clean acyclic edge.

**Why this closes it:** the only free merge is tier-0 × tier-0. Manufacturing pity now requires ten tier-1+ merges, which cost real stones, and stones are hard-capped per day (B4) by a ceiling **money cannot raise**. That converts a free exploit into a bounded strategic trade. Plain English for the owner: *"the countdown only counts merges you paid for."*

Also removed in the NOW slice: **paid eggs**, **gem→egg refresh**, and **hatch pity**. Eggs are free and unlimited; there is no purchasable path to a guaranteed type at all.

### B3 — Clock jumps reset five caps at once
**Decision: one monotonic day index, in one module, and clock-derived income may only ever pay GOLD.**

New `src/game/clock.ts` owns `dayIndex`, which is **monotonic high-water** — it never decreases. Every daily counter (stones earned, stones purchased, stage replay decay) keys off it. Deleted entirely: the 16h rolling budget window, `escalatorDecayPerCreditedHour`, `maxWindowCatchUpDays`. That leaves exactly **two** clock surfaces: `lastCollectedAt` (idle gold) and `dayIndex` (daily caps).

Idle income pays **gold only** — no merge stones, no eggs, no gems, no pity. So the entire blast radius of any clock tamper is "the cheater has a big gold number", and gold's only route to stones passes the 30/day purchase cap. Honest statement for DESIGN.md: *a purely local offline economy cannot be made tamper-proof; this design makes tampering not worth doing rather than impossible.*

### B4 — Merge stones are an uncapped tap
**Decision: two hard daily ceilings, both on the monotonic day.**
`economy.json → dailyCaps: { stonesEarned: 60, stonesPurchased: 30 }`.
Total stone supply ≤ 90/day for everyone, spender or cheater. A tier-6 creature (162 stones) therefore takes **at least two real days** for anybody. This is the meter the whole design was missing, and it retroactively bounds every future stone faucet.

### B5 — Losing pays more than winning; losses never decay
**Decision:** `starGoldMultipliers[0] = 0.10` (was 0.25) — strictly below a floored 1-star win (`1.0 × 0.2 = 0.20`). And repeat decay counts **attempts**, not clears: `StageProgress.attemptsToday` increments in `applyStageResult` regardless of winner.

### B6 — Sweep is an unbounded gold tap; two battle-reward formulas
**Decision: no sweep in the NOW slice.** And ownership splits cleanly:
- `campaign.ts` owns **scoring** (`scoreStage` → `StageScore`) — it has the per-stage round limits and needs the final-HP snapshot.
- `rewards.ts` owns **currency**, and is the only module that converts a score into money.
**Delete** from campaign's economy block: `goldPerEnemy`, `replayGoldMultiplier`, `bossGoldMultiplier`, `starGoldBonus`, `chestMergeStonesByStars`, `bossChestMergeStonesByStars`. `StarCount` is exported once, from `campaign.ts`.

Gold also now scales with stage power so no stage is strictly dominated:
`gold = round(goldPerEnemyPerPowerUnit × cumulativeStatMultiplier(enemyTier) × Σ powerScale of enemies defeated × starMult × decay)`

### B7 — Campaign replay eggs guarantee mythics
**Decision: no type-guaranteed eggs from replays, at all.** Shard eggs are **first-clear boss chest only**, one per region, ever. The NOW slice has 4 regions (ember/bloom/tide/gale) so no guaranteed rare or mythic exists anywhere. That preserves Aether at its real 0.47% and leaves the future hatch-pity design intact.

### B8 — Two contradictory `gear.json` files
**Decision: the Forge design's model wins** — five slots (focus/mantle/sigil/bracer/tome), **percentage-only, no flat bonuses ever, no crit affix**, region-gated level cap.
**Why:** a flat `+20 hp` is +47% of a tier-0 creature and +0.0007% of a tier-6 one — no single number works across a 2841× curve. And the flat design's `warden-plate` grants **+51.7% HP to a tier-0 creature**, which is more than a full tier-up, purchased with gold — a direct "sell power" break. The Binder design keeps ownership of *where gear is worn and how it renders*; it drops its own `gear.json`, `GearSlot`, `GearItem`, `binderBonus`, `withBinderBonus`.
**Gear is DEFERRED** out of the NOW slice (see §7) — but the decision is recorded so it cannot be re-litigated, and `SaveData` reserves its fields now.

### B9 — Five incompatible SAVE_VERSION 4 designs
**Decision: signature stays `deserializeCollection(raw: string)`**, plus a new pure `stampFreshSave(data, now, tzOffsetMinutes)`.
**Why:** widening to `(raw, now)` forces edits to all **18** existing call sites in `save.test.ts` and leaks the clock toward a pure module for no benefit. `stampFreshSave` fills any zero timestamp, is called once from `CollectionContext`'s load effect, and is itself pure and testable. Full shape in §4.

### B10 — Sealed eggs vs. tutorial resume
**Decision: keep pre-rolled eggs.** Hatch pity and banners — the only two things that require hatch-time rolling — are deferred, so sealed eggs buy nothing now and would break onboarding's id-matched resume.
The real problem sealed eggs were solving (the egg is painted in its unhatched type's colour, spoiling the reveal — `EggScreen.tsx:133`) is fixed in three lines: **all eggs render in one neutral mystery shell**. Reveal unspoiled, resume intact, zero data-model change.

### B11 — Store bypasses the stone escalator; no IAP SDK exists
**Decision: exactly one gold→stone price in the game** (the escalator + daily cap). `shop.json` has **no `stoneBundles`** and **no gem→stone packs**. The single chain is `gems → gold → (escalator + 30/day) → stones`.
**The NOW store is spend-only** and ships three real, working sections — **Gold** (buy with gems), **Merge Stones** (buy with gold), **Cosmetics** (buy with gems). The Gems/real-money tab is behind `shop.iapEnabled: false` and simply does not render, so nothing looks broken. Gems come from campaign milestones plus a 25-gem starting grant.

### B12 — Crit repair on existing saves
**Goes to the owner** (§8, decision 1). It visibly and irreversibly weakens existing high-tier creatures and must ride this migration or it can never be done.

---

## 3. Data files (all numbers, final)

### `src/data/balance.json` — additions only, existing keys untouched
```json
{
  "partySize": 3,
  "maxBattleRounds": 50,
  "emergencyHealThreshold": 0.5,

  "damagePowerScaleComment": "Multiplies every move's power, and damage is additionally multiplied by cumulativeStatMultiplier(attacker.tier). Together these make a fair fight take a similar number of hits at EVERY tier. 0.25 gives ~3.5 hits with a reliable move (power 45) and ~2.4 with a heavy one (power 65), measured across all eight species. Raise it for shorter, swingier battles.",
  "damagePowerScale": 0.25,

  "pity": { "mergeThreshold": 10 },

  "revealComment": "Single source of truth for roll quality. creatureArt.ts's SPARKLE_ROLL_THRESHOLD, CreatureCard's stat colour and the reveal sting all read goldThreshold, so the sparkle, the gold number and the sting can never disagree. nearThreshold is the near-miss band: 85-89 flashes toward gold then settles back to white.",
  "reveal": { "nearThreshold": 85, "goldThreshold": 90, "perfectThreshold": 100 },

  "revealTiming": {
    "preStatsMs": 1200, "stepMs": 160, "nearExtraMs": 120, "goldExtraMs": 260,
    "perfectExtraMs": 600, "verdictMs": 400, "maxFlourishExtraMs": 1200,
    "ceilingMs": 4200, "reduceMotionMs": 220
  },

  "powerWeightsComment": "Display and sort only, never a game rule. crit stats weight 0 because they are percentages.",
  "powerWeights": { "hp": 0.5, "atk": 2, "spAtk": 2, "def": 1.5, "spDef": 1.5, "spd": 1.5, "critChance": 0, "critDamage": 0 }
}
```
This also closes four pre-existing rule-3 violations: `MERGE_PITY_THRESHOLD` (merge.ts:13), `EMERGENCY_HEAL_THRESHOLD` (battle.ts:29), `MAX_ROUNDS` (battle.ts:31), `PARTY_SIZE` (BattleScreen.tsx:35), plus the duplicated `90` in creatureArt.ts:163 and CreatureCard.tsx:42.

`MERGE_PITY_THRESHOLD` stays exported from `merge.ts` as `= balance.pity.mergeThreshold` — both existing import sites (`EggScreen.tsx:20`, `merge.test.ts:18`) keep working verbatim.

### `src/data/economy.json` — NEW, sole owner of every currency number
```json
{
  "comment": "Every currency number in MergeBound. Read ONLY through content.ts's `economy`. Three rules hold it together: (1) every gold payout scales on cumulativeStatMultiplier — the honest from-tier-0 power number — so battle gold, idle gold and enemy strength grow in lockstep forever; (2) merge stone COSTS scale with tier but stone SUPPLY is capped per day, which is the meter on the whole economy; (3) anything derived from the device clock may only ever pay GOLD.",

  "startingWallet": { "gold": 250, "mergeStones": 10, "gems": 25 },

  "merge": {
    "comment": "Stones per merge, indexed by the tier of the STRONGER parent. Index 0 is free FOREVER — eggs are free and unlimited, so a player with an empty wallet can always make tier-1 creatures. That is the structural guarantee that nobody can be hard-walled. Cross-tier merges cost half (rounded up) because they already pay in diluted stats. Building one creature from scratch costs: tier 3 = 5, tier 4 = 18, tier 5 = 56, tier 6 = 162.",
    "stoneCostByInputTier": [0, 1, 3, 8, 20, 50, 125, 300],
    "crossTierCostFraction": 0.5
  },

  "battleRewards": {
    "comment": "gold = round(goldPerEnemyPerPowerUnit * cumulativeStatMultiplier(enemyTier) * SUM of the powerScale of each enemy defeated * starGoldMultipliers[stars] * repeatDecay). Including powerScale is what stops stage 2 of a region strictly dominating stages 3-5 (they all have 3 enemies) and what makes a solo boss pay properly. Index 0 of starGoldMultipliers is the loss consolation, deliberately set BELOW a floored 1-star win (1.0 x 0.2 = 0.20) so deliberate losing is strictly dominated.",
    "goldPerEnemyPerPowerUnit": 9,
    "starGoldMultipliers": [0.10, 1.0, 1.15, 1.35],
    "starMergeStones": [0, 1, 2, 3],
    "minStonesPerWin": 1,
    "firstClearGoldMultiplier": 3,
    "repeatDecayComment": "Multiplier on gold AND stones for repeat ATTEMPTS (wins and losses alike) on one stage inside one day: max(floor, perAttempt ^ attemptsToday). First-clear bonuses are one-time and never decay.",
    "repeatDecayPerAttempt": 0.7,
    "repeatRewardFloor": 0.2
  },

  "dailyCaps": {
    "comment": "The meter on the entire economy, keyed to a monotonic day index that never runs backwards. Total merge stone supply is at most 90 a day for everyone, so a tier-6 creature takes at least two real days for anybody — spender, grinder or clock-cheater alike. Money can buy speed up to these ceilings; it cannot raise them.",
    "stonesEarned": 60,
    "stonesPurchased": 30
  },

  "idle": {
    "comment": "Only the strongest rosterSize creatures earn, so hoarding weak creatures is worth nothing and merging always raises income. GOLD ONLY, deliberately — idle is the one clock-derived faucet and clock-derived income must never pay anything that guarantees an outcome. goldPerHour = goldPerHourPerPowerUnit * sum of cumulativeStatMultiplier(tier) across the roster. Six tier-1s = 108/hour; six tier-3s = 760/hour. Eight hours banks roughly 8-10 merge stones' worth of gold at every tier.",
    "rosterSize": 6,
    "goldPerHourPerPowerUnit": 12,
    "offlineCapHours": 8,
    "minCollectMinutes": 1
  },

  "exchange": {
    "comment": "Gold to merge stones. Price = round(baseGoldPerStone * cumulativeStatMultiplier(your highest tier) * priceGrowth ^ stones bought today). Anchoring on your own highest tier makes it tier-invariant in BATTLES per stone forever: the first stone each day always costs about two battles and the thirtieth about nine, at tier 1 and at tier 6 alike. The escalator resets with the day; there is no clock-based decay to forge.",
    "baseGoldPerStone": 60,
    "priceGrowth": 1.06
  },

  "gemSources": {
    "comment": "One-time only. No repeatable action anywhere in the game pays gems.",
    "stageFirstClearThreeStars": 2,
    "bossFirstClear": 10,
    "regionFullyMastered": 30
  },

  "gemSinks": {
    "comment": "Gems buy TIME (gold) and VANITY (cosmetics). A gem may NEVER touch a stat roll, a type, or the pity counter. Gem gold scales on your highest tier so it stays meaningful. REJECTED and recorded so it is not re-proposed: gems buying merge stones directly, gems buying eggs, gems buying idle-roster slots.",
    "goldPerGem": 120,
    "cosmeticPriceBands": { "common": 80, "rare": 250, "legendary": 700 }
  }
}
```

### `src/data/campaign.json` — NEW, 4 regions × 6 stages = 24 stages
No player-facing words; those live in `story.json` keyed by id.
```json
{
  "comment": "Regions run in type-wheel order so each region's element beats the next region's boss. anchorTier is the creature tier the region is designed for. powerScale is enemy strength relative to a creature at that tier (1.0 = even). Bosses are hand-written and identical every attempt — a boss you can learn is a boss you retry. Regions 5-9 are a data-only addition later; recommended anchorTiers when they ship: [0,1,2,3,4,5,5,6,6].",
  "stageDefaults": {
    "normal": [
      { "powerScale": 0.62, "enemyPartySize": 2, "swiftRoundLimit": 3 },
      { "powerScale": 0.70, "enemyPartySize": 3, "swiftRoundLimit": 4 },
      { "powerScale": 0.78, "enemyPartySize": 3, "swiftRoundLimit": 4 },
      { "powerScale": 0.85, "enemyPartySize": 3, "swiftRoundLimit": 5 },
      { "powerScale": 0.92, "enemyPartySize": 3, "swiftRoundLimit": 5 }
    ],
    "bossSwiftRoundLimit": 6
  },
  "difficultyBands": { "trivial": 4, "comfortable": 2, "fair": 1.3, "risky": 0.8 },
  "regions": [
    { "id": "cinderreach", "typeId": "ember", "anchorTier": 0, "shardEggTypeId": "bloom",
      "stages": [
        { "id": "cinderreach-1" }, { "id": "cinderreach-2" }, { "id": "cinderreach-3" },
        { "id": "cinderreach-4" }, { "id": "cinderreach-5" },
        { "id": "cinderreach-boss", "bossParty": [
          { "id": "ashmaw", "speciesId": "cindret", "types": ["ember", "gale"],
            "powerScale": 1.70, "statScales": { "hp": 1.2, "def": 1.1, "spd": 0.8 } }
        ]}
      ]},
    { "id": "thornwake", "typeId": "bloom", "anchorTier": 1, "shardEggTypeId": "tide",
      "stages": [ "…5 normal…",
        { "id": "thornwake-boss", "bossParty": [
          { "id": "verdigris", "speciesId": "mossling", "types": ["bloom", "tide"],
            "powerScale": 1.35, "statScales": { "hp": 1.15, "spDef": 1.2 } }
        ]}
      ]},
    { "id": "drownbell", "typeId": "tide", "anchorTier": 2, "shardEggTypeId": "gale",
      "stages": [ "…5 normal…",
        { "id": "drownbell-boss", "bossParty": [
          { "id": "nauthis", "speciesId": "puddlet", "types": ["tide", "umbra"],
            "powerScale": 1.75, "statScales": { "hp": 1.25, "spAtk": 1.15 } }
        ]}
      ]},
    { "id": "skyrend", "typeId": "gale", "anchorTier": 3, "shardEggTypeId": "crag",
      "stages": [ "…5 normal…",
        { "id": "skyrend-boss", "bossParty": [
          { "id": "skirl", "speciesId": "zephyrl", "types": ["gale", "volt"],
            "powerScale": 1.80, "statScales": { "spd": 1.5, "hp": 0.85 } }
        ]}
      ]}
  ]
}
```
**`shardEggTypeId` is the counter to the NEXT region's boss**, awarded once on first boss clear. Verified 2× for every link against `types.json`. Every boss's second type was checked so it does not resist the counter you were just handed (e.g. Ashmaw is ember/**gale**, not ember/crag — crag halves volt and would have voided the chain).

### `src/data/story.json`, `src/data/binder.json`, `src/data/ui.json`, `src/data/shop.json`
Shapes as specified in the subsystem designs, with these amendments: `binder.json` keeps its preset lists but the **accent axis reads `types.json`** (no duplicated colour list); `ui.json` owns tab unlock gates and the single-badge priority order (delete `onboarding.json`'s `menuUnlocks`); `shop.json` has **no `stoneBundles`** and gains `"iapEnabled": false`.

### `constants/tokens.ts` — design tokens as typed TS, not JSON
Presentation is not balance. Verified contrast fixes that must land: `#7C5CFF` as text on `#12101E` is **4.32:1** and white on a flat `#7C5CFF` button is **4.35:1** — both currently shipping and both below the 4.5 floor. Use `#9B82FF` (6.29:1) for text/links and a `['#6E4CF0','#5B3FD1']` gradient for buttons (white is 5.31:1 at the lightest stop). Type colours used as accents on dark must go through `accentOnDark()` — Tide 4.12:1, Crag 3.85:1 and Umbra 2.52:1 all fail as-is (they are fine as card *fills*, which is how `CreatureCard` correctly uses them today).

`#ffd966` is **reserved** — it means perfect roll and nothing else, ever. The future `wellforged` gear rarity uses `#F5A623` instead.

---

## 4. Save migration v3 → v4 (exact)

```ts
// src/game/save.ts
const SAVE_VERSION = 4;

export interface Wallet { gold: number; mergeStones: number; gems: number }

export interface EconomyState {
  lastCollectedAt: number;      // 0 until stampFreshSave fills it
  dayIndex: number;             // monotonic high-water; -1 until stamped
  stonesEarnedToday: number;
  stonesPurchasedToday: number; // doubles as the exchange escalator step count
  clockAnomalies: number;       // recorded, never punished
}

export interface StageProgress {
  bestStars: 0 | 1 | 2 | 3; bestRounds: number; clears: number;
  attemptsToday: number; attemptsDay: number;   // self-healing: stale day ⇒ 0
}
export interface CampaignProgress { stages: Record<string, StageProgress>; claimedChests: string[] }

export interface BinderAppearance { buildId: string; skinToneId: string; hairStyleId: string;
  hairColorId: string; outfitId: string; outfitToneId: string; accentTypeId: string; markId: string }
export interface Binder { name: string; appearance: BinderAppearance }   // name '' = not yet named

export interface OnboardingState { step: OnboardingStep; seed: number; seenTips: string[] }
export interface ShopState { purchasedOneTimeIds: string[]; ownedCosmeticIds: string[];
  equippedCosmetics: Record<string, string> }

export interface SaveData {
  collection: Creature[];
  mergePity: number;
  lockedIds: string[];
  wallet: Wallet;
  economy: EconomyState;
  campaign: CampaignProgress;
  binder: Binder;
  onboarding: OnboardingState;
  shop: ShopState;
  // Reserved now so the forge slice needs no second bump:
  gear: GearItem[]; loadout: Loadout; materials: Materials;
}

/** Fills every v4 field. All four version branches return through this, so adding
 *  a field is one line in one place instead of four. */
export function withDefaults(
  partial: Pick<SaveData, 'collection' | 'mergePity'> & Partial<SaveData>
): SaveData;

/** Signature UNCHANGED — all 18 existing save.test.ts call sites stay byte-identical. */
export function deserializeCollection(raw: string): SaveData;

/** Replaces any zero/-1 timestamp with real values. Pure; the clock enters the
 *  system in exactly one place: CollectionContext's load effect. */
export function stampFreshSave(data: SaveData, now: number, tzOffsetMinutes: number): SaveData;
```

**Defaults applied by `withDefaults`:**

| Field | Default |
|---|---|
| `lockedIds` | `applyAutoLocks([], collection)` — every existing natural-100 creature comes back **already protected**, a gift on the update that introduces locking |
| `wallet` | `{ ...economy.startingWallet }` = 250 gold / 10 stones / 25 gems |
| `economy` | `{ lastCollectedAt: 0, dayIndex: -1, stonesEarnedToday: 0, stonesPurchasedToday: 0, clockAnomalies: 0 }` — stamped at load, so a migrated veteran gets **zero pending idle income** (paying eight hours for a save predating idle income would be dishonest) |
| `campaign` | `{ stages: {}, claimedChests: [] }` — **a factory, never a shared const**, or every migrated save aliases one mutable record |
| `binder` | `{ name: '', appearance: defaultBinderAppearance() }` — `save.ts` calls `content.ts` for this, never `binderArt.ts`; art depends on game and that direction must never invert |
| `onboarding` | `{ step: collection.length > 0 ? 'complete' : 'first-egg', seed: 0, seenTips: [] }` — **a veteran is never sent back to the egg tutorial**, but someone who installed and never hatched still gets theirs |
| `shop`, `gear`, `loadout`, `materials` | empty |

**Branches:** v1 keeps its 4-stat creature migration → `withDefaults`. v2 → `withDefaults`. v3 → `withDefaults(collection, mergePity)`. v4 validates with hand-rolled predicates in the existing `isStats` / `isCreature` / `isValidMergePity` style — `isWallet`, `isEconomyState`, `isStageProgress`, `isCampaignProgress`, `isBinder`, `isOnboardingState`, `isShopState`, `isStringArray`. **No zod on this path.**

**`repairPercentStats(creature)`** runs on every branch (owner sign-off required, §8). Reconstruction is exact because `statRolls` records where the roll landed:
`clampedFactor = (statRolls[k]/100) * 2v + (1 - v)` then `value = max(1, round(speciesBase[k] * clampedFactor))`.
It uses a **non-throwing** species lookup (`allSpecies.find`) and, if the species is unknown, clamps `critChance ≤ 100` / `critDamage ≤ 400` rather than throwing. Test: *'a saved creature whose species no longer exists still loads'*.

**Tolerance rules, each with a test:** a `loadout` id pointing at a missing gear item nulls that slot rather than rejecting the save; `lockedIds` entries no longer in the collection are pruned on load; unknown campaign stage ids are ignored, not rejected. Losing one item is recoverable; losing a collection is not.

**`STORAGE_KEY` stays `'creature-merge:collection:v1'`** — the `v1` there is part of the key's *name*, not the save version. Renaming it orphans every existing save.

**`CollectionContext.tsx` collapses to a single `useState<SaveData>` with one `useEffect(..., [save])`.** This is not tidying — it is the only structural defence against the dependency-array trap. Today the effect is `[collection, mergePity]` (line 66); a field left out of that array works perfectly all session and vanishes on relaunch with no error, no crash, and no test in this repo that would catch it. With one field there is nothing to forget. The existing `if (!loaded.current) return;` guard (line 62) stays exactly as it is.

---

## 5. Build order — seven steps, each ending on a green `pnpm run check`

### Step 0 — Engine truth + the one save bump *(no new screens; ship and review alone)*
This is the only step that can destroy a player's collection.

1. **Move hardcoded constants into `balance.json`** and read them through `content.ts`: `MERGE_PITY_THRESHOLD`, `EMERGENCY_HEAL_THRESHOLD`, `MAX_ROUNDS`, `PARTY_SIZE`, and the roll threshold `90` (creatureArt.ts:163 becomes a re-export; CreatureCard.tsx:42 reads the same block).
2. **Combat fix 1 — crit stats stop inheriting the tier multiplier.** Exclude `PERCENT_STAT_KEYS` from the multiplier in `rollAllStats` (hatch.ts) and `mergedStats` (merge.ts).
3. **Combat fix 2 — damage scales with tier:**
   `raw = move.power * balance.damagePowerScale * cumulativeStatMultiplier(attacker.tier) * (atkStat / defStat)`
4. **Additive `battle.ts` changes** (nothing removed):
```ts
export interface CombatantSnapshot { creatureId: string; name: string; side: Side; currentHp: number; maxHp: number }
export interface BattleLogEntry { /* existing fields */ targetId: string; targetSide: Side }
export interface BattleResult { winner: Side; log: BattleLogEntry[]; rounds: number; finalCombatants: CombatantSnapshot[] }
export function toBattleResult(state: BattleState): BattleResult;
```
   `runBattle` returns `toBattleResult(state)`; `BattleScreen.finish()` calls it instead of hand-building the object. Without this, "no Warden fainted" is not derivable and manual battles cannot be scored at all.
5. **`src/game/repair.ts`** — `repairPercentStats`.
6. **`SAVE_VERSION` 3 → 4** per §4, with `withDefaults` and `stampFreshSave`.
7. **Collapse `CollectionContext` to one `SaveData` state.**

**Tests that will break, precisely — re-derive each by hand as a balance decision, do not mechanically re-pin:**
- `battle.test.ts` — about six `computeDamage` assertions (lines 55, 62, 72, 80, 89, and the `raw = 50` in the variance test). The crit-ratio test (line 105) and the floor-at-1 test (line 114) survive unchanged.
- `merge.test.ts` line ~89 — the ±15% band loop over all `STAT_KEYS`. It must become `PERCENT_STAT_KEYS.includes(k) ? 1 : mult`. **Keep this test** — it becomes the permanent proof that percent stats never scale.

New tests: *'a critical-hit multiplier never grows with tier'*, *'an evenly matched battle takes a similar number of rounds at tier 0, tier 3 and tier 6'*, *'a version one save still loads after the currency update'*, *'a version three save opens with the starting wallet and no pending income'*, *'an existing player is never sent back to the egg tutorial'*.

### Step 1 — Pure logic *(no screens; the app looks identical and still works)*

| File | Key signatures |
|---|---|
| `src/game/clock.ts` | `reportedDayIndex(now, tzOffsetMinutes)`, `advanceDay(state, now, tz)` — monotonic high-water, never decreases |
| `src/game/economy.ts` | `mergeStoneCost(a, b)`, `canAfford(wallet, cost)`, `spend`, `earn`, `stonePriceAt(highestTier, purchasedToday)`, `stoneBundlePrice`, `stonesAffordable`, `buyMergeStones(state, wallet, count, highestTier)`, `highestTier(collection)` |
| `src/game/rewards.ts` | `enemiesDefeated(result)`, `wardensFainted(result)`, `repeatDecay(attemptsToday)`, `battleRewards(score, ctx): BattleReward` — **zero RNG draws** |
| `src/game/idle.ts` | `idleRoster(collection)`, `idleRates(collection)`, `previewIdle(state, collection, now)`, `collectIdle(...)` — clock is a **parameter**, gold only |
| `src/game/campaign.ts` | `stageEncounter`, `buildBoss`, `buildStageEnemies`, `scoreStage(result, swiftRoundLimit): StageScore`, `applyStageResult`, `isStageUnlocked`, `isRegionUnlocked`, `nextIncompleteStage`, `difficultyBand`, `stageRewards` |
| `src/game/mergePreview.ts` | `previewMerge(a, b, mergePity): MergePreview` — built on an **extracted `mergedStatBases(a, b, tier)`** that `mergedStats` also feeds, so the preview is not a second implementation and physically cannot drift |
| `src/game/collection.ts` | `creaturePower`, `filterCollection`, `sortCollection`, `isLocked`, `toggleLock`, `shouldAutoLock`, `applyAutoLocks`, `pruneLocks`, `suggestMergePartners` |
| `src/game/onboarding.ts` | `onboardingRedirectTarget(state, currentPath): string \| null`, `nextStep`, `tutorialEggs`, `shouldShowTip`, `stepForExistingSave` |
| `src/game/navigation.ts` | `visibleTabs(progress)`, `defaultTab`, `newlyUnlockedTabs` |
| `src/game/notifications.ts` | `pendingRewards`, `tabBadge` — **at most one badge dot in the whole app, ever** |
| `src/art/binderArt.ts` | `binderArt(binder)`, `paletteForBinder`, `proportionsFor`, `defaultAppearanceFor(primaryTypeId)`, `generateBinderName(rng)`, `sanitizeBinderName` |
| `src/art/revealPlan.ts` | `revealPlan(creature, ctx): RevealBeat[]`, `revealDurationMs`, `flourishForRoll` — **zero RNG**, receives the finished creature so it can only pace numbers already decided |
| `src/art/typeTheme.ts`, `contrast.ts`, `format.ts` | `accentOnDark`, `contrastRatio`, `formatCurrency(value, { fontScale })` |

**RNG discipline:** campaign encounters, campaign reward rolls and any future drop table each get their **own** `createRng` instance. Never share a stream with hatch or battle — a drop rate that depends on battle length is a real bug that would be very hard to spot.

Key tests: *'merging two brand-new creatures does not move the perfect-roll countdown'*, *'a hundred free tier-zero merges leave the countdown exactly where it was'*, *'no amount of gold can buy more than thirty merge stones in one day'*, *'losing a stage over and over pays less gold each time, and never more than winning it'*, *'the preview's best case equals what a merge produces when every roll is maximum'*, *'only the six strongest creatures earn idle income'*, *'setting the clock backwards pays nothing and never wipes the collection'*, *'each region's shard egg is strong against the next region's boss'*, *'a boss is built identically every time, with no random rolls'*.

Plus `campaignDifficulty.test.ts`, which runs hundreds of seeded battles per stage: *'a party at a region's own tier clears every ordinary stage at least 70% of the time'*, *'a party at a region's own tier beats its boss between 25% and 65% of the time'*, *'no campaign battle ever runs into the stalemate round cap'*. This is what turns "is it too hard?" into something the owner can verify by running one command.

### Step 2 — Tokens, shared kit, shell
`constants/tokens.ts` + the contrast test + rewrite `constants/colors.ts` to derive from it (this also fixes `+not-found.tsx` and `ErrorFallback.tsx`, which currently render **white** and look like a different app). Then `src/screens/ui/` — `Screen`, `Text`, `Button`, `Panel`, `Sheen`, `Pill`, `CountUp`, `CostChip`, `haptics.ts`, `useReduceMotion`. `PrimaryButton` and `haptic()` are currently byte-for-byte duplicated in `EggScreen.tsx` and `BattleScreen.tsx`; extract **before** adding screens or it becomes nine copies.

Then the shell: `app/(tabs)/_layout.tsx` using **`<Tabs tabBar={props => <MergeTabBar {...props}/>}>`**, not a bar rendered beside a `<Stack>`. This departs from one design deliberately: a sibling bar makes every tab switch a Stack push, so Android's back button walks backwards through tabs and per-tab scroll position is lost. Those are bugs, not styling preferences. The `tabBar` prop gives full visual control with correct semantics.

The HUD is a **real flex row above `<Tabs>`**, not an absolute overlay — that lets every screen delete its duplicated `Platform.OS === 'web' ? 67 : insets.top` (EggScreen.tsx:49-50, BattleScreen.tsx:111-112) and makes overlap impossible.

**Atomic route move:** delete `app/index.tsx`, create `app/(tabs)/index.tsx` (Home) and `app/(tabs)/hatchery.tsx`. `/` now means Home. This invalidates `.expo/types/router.d.ts` — see §6.

### Step 3 — Onboarding, the reveal, the first battle
`app/onboarding.tsx` → `OnboardingScreen` (**one route**, a switch on `onboarding.step`, so a force-quit resume can never land on a route out of sync with the saved step). Steps: `first-egg → second-egg → first-merge → binder-look → binder-name → first-battle → complete`.

`RevealStage.tsx` plays a `RevealBeat[]` and holds **zero rules**. `BinderSprite.tsx` draws `binderArt()` output with `react-native-svg`.

Two one-line wins here: `app.json` `splash.backgroundColor` `#ffffff` → `#0B0A14` (every cold start currently flashes white into a dark game), and `expo.name` `"Creature Merge RPG"` → `"MergeBound"`.

Onboarding's first battle pushes `/battle?stageId=cinderreach-1` — `BattleScreen` reads the encounter from `campaign.ts`. **`BattleScreen` becomes campaign-only**; the current `avgTier` guess (BattleScreen.tsx:142-145) is deleted, which is what stops rewards self-scaling off the player's own party. A loss leaves `step` at `first-battle` with a retry — **never a soft-lock**.

### Step 4 — Merge screen and collection grid
`MergeScreen.tsx` (two altar slots, honest preview panel, filterable grid, sticky commit bar reading `Merge — 3 stones (you have 23)` or `Merge — Free` at tier 0), `CollectionGrid.tsx` (**FlatList, `numColumns={2}`** — `EggScreen` currently mounts every card at once, which stalls at 50+ creatures), `MergeRevealOverlay.tsx` driven by `revealPlan`.

### Step 5 — Campaign screens
`WorldMapScreen`, `RegionScreen`, `StageBriefSheet`, `StageResultOverlay`, `ChestRevealScreen`. Locked regions stay **visible** with the boss in silhouette and a named unlock condition.

### Step 6 — Store and idle collect
`StoreScreen` (modal, three working sections), `MergeStoneExchange`, `IdleCollectCard`, `CurrencyHud` animation (count-up + coin flight), `BinderScreen`.

---

## 6. Environment hazards to plan for, not discover

- **Typed routes will fail the build before the code is wrong.** `.expo/types/router.d.ts` knows four routes; `.expo/` is gitignored so it does not ship. Every new `href` fails local typecheck until regenerated. On a fresh Replit clone the file is **absent**, so typed routes aren't enforced there — the local box is *stricter* than CI, and a red typecheck on a new link is a stale generated file, not broken code. Local workaround: delete `artifacts/mobile/.expo/types/router.d.ts` before `pnpm run check`, or run `expo start` once to regenerate. Do **not** turn `typedRoutes` off.
- **Reanimated:** installed, never imported, and the babel plugin **is** auto-injected — verified. Do not edit `babel.config.js`. Budget five minutes to smoke-run the first commit that imports it in Replit's preview.
- **Any new dependency must ship with an updated `pnpm-lock.yaml`** in the same commit — Replit runs `pnpm install --frozen-lockfile` after every pull. This plan adds **zero** dependencies.
- **No visual verification is possible from this Windows box** (the browser preview tool binds to a different project's directory). `pnpm run check` is the only honest signal. Every claim about how anything *looks* must be labelled unverified until seen in Replit. The procedural creature portraits have still never been looked at by anyone — and this plan puts one at 120pt as the focal point of the Home screen.
- **No component test harness exists** (no vitest.config for jsdom, no testing-library). That is why every rule above lives in `src/game/` or `src/art/` as a pure function. Anything that ends up inside a `.tsx` is permanently unverifiable by the owner.

---

## 7. The cut line — deferred, with reasons

| Deferred | Why, and what must be true when it lands |
|---|---|
| **Gear and the Forge** | Next slice. Decision already locked (§B8): percentage-only, five slots, **no crit affix**, `forgeLevelCapByRegionsCleared` is the never-sell-power wall, and a test must assert `maxSingleStatPercentHardCap (45) < (min(tierMultipliers.slice(1)) - 1) × 100 = 50`, reading **both** sides from `content.ts`. `SaveData` already reserves `gear` / `loadout` / `materials`, so no second bump. **Drop `stoneFind`** from the Tome — a permanent multiplier on the bottleneck currency is worth more than any stat bonus and is buyable with gold. |
| **Real-money IAP** | No SDK exists, `expo-in-app-purchases` is deprecated, and the live alternatives need a custom dev build that cannot run on web — the owner's only preview. It is its own decision with its own dependency and App Store account work, not part of "enhance the app". |
| **Sealed eggs, hatch pity, banners, paid eggs** | All three need hatch-time rolling, which breaks onboarding's resume. When they land: **a purchased egg must not advance either hatch-pity counter**, or money buys a guaranteed rare type — that is the exact line DESIGN.md forbids. |
| **Streak, Compendium** | A `SAVE_VERSION` 5 bump, which is fine — the pattern is established and `withDefaults` generalises. Compendium credit must be gated on **play** (fielded in a won battle), not hatch volume, or it becomes an egg-tapping farm. Its 72/72 reward must be **cosmetic**, not gear. |
| **Anchoring** (carry a good roll through a merge) | Genuinely interesting but carries two real bugs that must be fixed first: (a) `hasNaturalPerfectRoll` would read a carried 100 as freshly rolled and **reset pity for free, forever**; (b) an anchored roll is itself anchorable, so quality chains indefinitely and can be laundered up from free tier-0 eggs. Fix: exclude the anchored key from the reset check, decay the carry (`−15`), and require same-tier parents. |
| **Merge Rush** | Needed at 50+ creatures, not before. Must compute the whole run and commit **atomically** or a force-quit eats half a collection. |
| **Regions 5-9, the Aether finale** | Data-only addition. Region 8 at `anchorTier 8` needs three tier-8 creatures — 768 tier-0 hatchlings. Flatten to `[0,1,2,3,4,5,5,6,6]`. Aether has zero rows in `types.json`'s effectiveness table, so the finale currently has no counterplay lever at all. |
| **Sweep** | Removed outright. It is an unbounded gold tap at tap rate — a 3-star Region 4 stage would sweep for ~1,180 gold per tap against an intended 3,497 gold/**hour**. If it ever returns, it must route through the same `rewards.ts` and increment the same `attemptsToday`. |
| **Sound** | Would roughly double the reveal's impact but needs a new dependency and a lockfile commit. A deliberate, separate decision. |

---

## 8. Decisions for the owner (short — these materially change the work)

**1. Repair the critical-hit bug on creatures you already own?**
High-tier creatures currently have a bug that lets their critical-hit numbers grow with their tier, so from tier 4 up **every single hit is a critical**, and a tier-6 creature hits for about 4,400 times normal damage. Fixing it makes battles work properly — speed and survival stars mean nothing otherwise. But it will make your existing high-tier favourites visibly weaker. The fix can reconstruct each creature's correct numbers exactly from its own roll history, so nothing else about them changes. It must ride this update or it can never be done at all.
**Recommended: yes, with an announcement.** Everything downstream depends on it.

**2. Real-money purchases now, or a spend-only store now?**
There is no payments library installed, the modern ones need a special app build, and none of them run in the web preview you use. A spend-only store (gold, merge stones, cosmetics — all working, all premium-looking) ships now with zero risk. Real money becomes its own piece of work.
**Recommended: spend-only now.**

**3. Four regions now, or all nine?**
Four regions is 24 stages and roughly 5-8 hours of play, reachable with tier 0-3 creatures. Nine regions would require creatures built from 768 eggs to finish — months of tail. Regions are pure data, so adding more later is a JSON change, not a code change.
**Recommended: four now.**

**4. Merge stones are capped at 90 a day (60 earned, 30 bought).**
This is the single number that keeps the economy honest — it means nobody, however much they spend or however they set their phone's clock, can build a top-tier creature in under two days. You will feel it as "I've hit today's stone limit" on a heavy play session.
**Recommended: keep it.** It is the only thing that bounds every currency exploit at once. Easy to raise later; very hard to add once players are used to unlimited.

---

## 9. Plain English — what this will feel like to play

*(For the owner. No code, no jargon.)*

You open MergeBound and there is no white flash and no form to fill in. You see three eggs. You tap one. It cracks, splits, and a creature you now own bursts out — and then its eight numbers land one at a time, about a fifth of a second apart, counting up from zero in white. You watch each one climb without knowing where it will stop. When one lands at 90 or above it turns gold, throws a sparkle and buzzes the phone. That happens on more than half of all creatures, so it is a frequent, reliable little hit rather than a rare one. A perfect 100 stops everything for half a second with a gold sweep across the whole screen.

You tap a second egg. Then one button lights up: **Merge — Free**. The two creatures rush together, the screen flashes white, and one bigger creature stands where two were, with its tier badge stamping from 0 to 1. That is three taps and about twenty-five seconds from opening the app, and the game has not asked you for anything yet.

Only then does it ask who you are. The light from that merge forms into a person — your Binder — already wearing the colour of the creature you just made. You tap through a few rows of choices (build, skin, hair, outfit, mark, accent) and each tap improves something that already looks right rather than building from nothing. Your name comes last, already filled in with a suggestion, and keeping it is a proper button, not a skip.

Then you fight. Battles are your three creatures against a stage's enemies, and every stage is scored out of three stars: you won, nobody fainted, you won fast. If you miss a star the game tells you exactly why — *"you took six rounds, needed five"* — so a near miss becomes a specific goal instead of a shrug.

From there the shape is: four regions, six stages each, each region themed to an element and ending with a named boss who is the same every attempt, so losing is your fault and retrying feels like solving rather than rerolling. Beating a boss hands you an egg guaranteed to be the element that beats the *next* boss. Every region's prize is the next region's key.

Battles pay gold and merge stones. Gold also trickles in while the app is closed, from your six strongest creatures only — so hoarding weak creatures earns you nothing and merging always raises your income. Stones are what merging costs, and the cost climbs with tier: your first merges are free, a mid-game merge costs a handful, and a top-tier merge is the biggest thing you have ever spent. Gold buys extra stones, but each one you buy today costs six percent more than the last, and there is a firm daily ceiling. That ceiling is deliberate: it means nobody — however much they spend — can rush to the top overnight, which is what keeps the game worth playing for someone who doesn't spend.

Merging finally gets a proper screen. You pick any two creatures from your whole collection, with filters and sorting, and a padlock on anything precious. Anything that rolls a perfect stat locks itself automatically, so you can never fumble away your best creature. Before you commit, the game shows the exact band each stat will land in — worst, typical, best — and says plainly when a merge will *not* raise the tier and will drop your stats. It also names the signature move the new type pair unlocks. That preview does its sums with the same code the real merge uses, so it cannot lie to you.

Along the bottom is a bar that grows: one tab at first, then Merge, then Quest, then Home, then Wardens. Along the top, always, is your Binder's face and your three balances. When you earn something, coins physically fly across the screen into that bar, and the number only starts climbing when the first coin lands — so it feels like you caused it. A big haul counts up for longer than a small one. Spending, deliberately, is instant and quiet.

The store slides up from the bottom, darker than the rest of the game so it reads as somewhere special. It is never forced on you: it cannot open during the tutorial, it never appears after a loss, and it never pops up by itself. Every "best value" claim is calculated from the real numbers rather than typed in, so it cannot mislead. And nothing in it — ever — makes a creature better. It only makes getting there faster.