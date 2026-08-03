# MergeBound

MergeBound is a mobile creature-merging RPG built with Expo / React Native and TypeScript, targeting an eventual App Store release via Replit. Players hatch creatures from eggs, merge two creatures into a stronger one, battle, earn idle income, forge gear, and buy currency — built in that order (see Build order). Slice 1 (hatch + merge + local save) is complete.

**The owner cannot read or write code.** Every change must come with a plain-English summary of what changed and why. Automated checks are the owner's only way to verify work — keep them passing and extend them with every logic change.

## The one command that checks everything

```
pnpm run check
```

Run from the repo root: typechecks every package, then runs all tests. It must pass before every commit. Test-only run: `pnpm test`. Game-logic tests live in `artifacts/mobile/src/game/__tests__/` (Vitest).

## Architecture rules (follow, don't re-derive)

1. **Game rules live in `artifacts/mobile/src/game/` as pure TypeScript functions.** No imports from React, React Native, Expo, or any UI library in that folder. Same inputs + same RNG state = same output, always.
2. **Screens live in `artifacts/mobile/src/screens/`.** They call game functions; they never contain game rules of their own.
3. **Content and balance numbers live as JSON in `artifacts/mobile/src/data/`** (`species.json`, `types.json`, `balance.json`) and are read only through `src/game/content.ts`. Never hardcode a balance number in code — UI or logic.
4. **All randomness goes through the seeded RNG** (`src/game/rng.ts`). Never call `Math.random()` in game logic.
5. **Every new game-logic function gets tests in the same commit.** Test names must read as plain English.

## Merge specification (the source of truth)

- **Tier** — both parents tier T → result is tier T+1. Different tiers → result is the *higher* tier, no increase.
- **Types** — higher-tier parent's types first, then the other parent's; remove duplicates; keep the first two only. **A creature must never have more than two types.**
- **Stats** — per-stat average of the parents, ± a random roll of `statRollVariance` (±15%), rounded, minimum 1. **The tier multiplier from `balance.json` is applied ONLY when the merge actually raises the tier** (both parents same tier). A cross-tier merge gets no multiplier at all — averaging with a weaker parent dilutes the stronger parent's stats instead of boosting them. This is deliberate: it's what makes "merge like with like" the correct strategy and closes off cross-tier merging as a free stat pump. Deliberately merging across tiers is still a legitimate move for changing a creature's *types* (see Types rule above) — you're consciously trading stats for a type reroll, not getting both for free.
- **Species** — inherited from the higher-tier parent. On a tier tie the "higher" parent is the one whose id sorts first (deterministic, no coin flip).
- **Consumption** — both parents are removed from the collection and the result added, in one atomic update (`applyMerge` in `src/screens/CollectionContext.tsx`). The pure `merge()` itself does not touch the collection; it records `parentIds`.

`balance.json`'s `tierMultipliers` are **per-merge step multipliers**, not cumulative ones — repeated same-tier merging compounds them, so real growth from tier 0 is much bigger than the raw table suggests (tier 6 lands around 2800x, by design — that compounding is the intended "big numbers" payoff of the merge loop). Never read `tierMultipliers` directly when you need a tier's true relative power (e.g. tuning enemy scaling later) — use `cumulativeStatMultiplier(tier)` from `content.ts` instead.

## Stats

Every creature has eight stats (`STAT_KEYS` in `models.ts` is the single source of truth for the list): `hp`, `atk`, `spAtk` (special attack), `def`, `spDef` (special defence), `spd`, `critChance` (%), `critDamage` (% damage multiplier on a crit). Species lean physical or special in `species.json`'s `baseStats` on purpose, ahead of battles being built.

Every stat also carries a persisted **roll quality** (`statRolls`, 0-100 per stat, alongside `stats`) recording where that stat's most recent roll landed in its ±15% band — 100 is the best possible roll. This is what makes hunting a "perfect roll" a real, visible thing: a creature can have a 98 on `critChance` and a 6 on `hp` at the same time, because every stat rolls independently on every hatch or merge. `CreatureCard.tsx` colours a stat's displayed value by its roll quality (gold ≥90, dim ≤15) so this is visible without extra UI chrome.

## Type system

Nine types, defined in `src/data/types.json`, each with a `rarity` (`common` | `rare` | `mythic`) that drives real hatch odds via `balance.json`'s `typeRarityWeights` (`pickWeighted` in `rng.ts`) — rare and mythic types are meaningfully harder to hatch, not just labelled differently:

- Six **common** types in a weakness ring, each **strong against the next**: Ember → Bloom → Tide → Gale → Crag → Volt → Ember (and correspondingly weak against the previous).
- Two **rare** types: **Umbra** and **Lumen**, strong against each other only.
- One **mythic** type, rarer than either rare type: **Aether**. No effectiveness interactions defined yet — deliberately left neutral until battles are designed rather than guessed at now.

Rarity is not meant to be raw combat power: a common-type creature should still be able to beat a rare/mythic one. Rarity should show up as better base stats and better special attacks on the species that roll those types, not as a hard combat trump — keep this in mind when battles get built.

The effectiveness table already exists in `types.json` (2 = strong, 0.5 = weak) for battles to use later. Hatched creatures get exactly one type; two types only ever come from merging.

## Currencies (planned)

- **Gold** — earned from battles and idle income; spent forging gear.
- **Merge stones** — spent to merge creatures.
- **Gems** — bought with real money; can buy the other two.

None are implemented yet. When they are, their amounts and prices belong in `src/data/`, not in code.

## Build order

1. ✅ Creatures and merging (slice 1)
2. Battles
3. Idle income
4. Gear and the forge
5. Shop and IAP — last

Do not build ahead of this order without the owner asking for it.

## Where things live

- `artifacts/mobile/` — the Expo app (the game).
  - `src/game/` — pure game logic: `models.ts` (types), `rng.ts` (seeded RNG), `content.ts` (JSON access), `hatch.ts`, `merge.ts`, `save.ts` (serialise/validate saves).
  - `src/data/` — species, types, and balance JSON.
  - `src/screens/` — UI: `EggScreen.tsx` (slice-1 flow), `CreatureCard.tsx` (placeholder art), `CollectionContext.tsx` (state + AsyncStorage persistence — the only file that touches storage).
  - `app/` — expo-router route files only; no logic.
- `artifacts/api-server/` — Express API scaffold. Only a `/api/healthz` endpoint so far; no game features use it yet, but it's real registered Replit deployment infrastructure (production build/run/health-check wired in its `.replit-artifact/artifact.toml`), not orphaned code — future server-authoritative features (battles, idle income, IAP validation) will likely build on it.
- `lib/` — API workspace packages backing `api-server`: `api-spec` (OpenAPI source of truth), `api-client-react` + `api-zod` (generated — regenerate via codegen, never hand-edit), `db` (Drizzle schema, currently empty, scaffolded ahead of need).
- `scripts/post-merge.sh` — the only thing left in `scripts/`. Run automatically by Replit after every pull (`.replit`'s `[postMerge]` hook): reinstalls deps and pushes DB schema changes. Not a pnpm package — invoked directly by path.

## Environment gotchas

- Package manager is **pnpm** (workspace). Replit runs `pnpm install --frozen-lockfile` after every pull, so any dependency change must include the updated `pnpm-lock.yaml` in the same commit.
- `react`/`react-dom` are pinned to exactly 19.1.0 (Expo requirement) and `@types/react`/`@types/react-dom` must stay on matching 19.1.x versions (catalog in `pnpm-workspace.yaml`).
- `pnpm-workspace.yaml` excludes most platform-specific binaries, but win32-x64 esbuild/rollup are deliberately kept for local Windows development — do not re-exclude them.
- Save data is versioned (`SAVE_VERSION` in `src/game/save.ts`, currently 2). **Changing the `Creature` shape requires a version bump AND a migration function in the same change**, or players lose their collections on update — `deserializeCollection` must keep accepting every old version it has ever shipped. See the v1→v2 migration in `save.ts` for the pattern to copy.
