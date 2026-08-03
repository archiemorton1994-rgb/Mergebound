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
- **Stats** — per-stat average of the parents, × the result tier's multiplier from `balance.json`, then a random roll of ±15% (`statRollVariance`), rounded, minimum 1.
- **Species** — inherited from the higher-tier parent. On a tier tie the "higher" parent is the one whose id sorts first (deterministic, no coin flip).
- **Consumption** — both parents are removed from the collection and the result added, in one atomic update (`applyMerge` in `src/screens/CollectionContext.tsx`). The pure `merge()` itself does not touch the collection; it records `parentIds`.

## Type system

Eight types, defined in `src/data/types.json`:

- Six core types in a weakness ring, each **strong against the next**: Ember → Bloom → Tide → Gale → Crag → Volt → Ember (and correspondingly weak against the previous).
- Two rare types: **Umbra** and **Lumen**, strong against each other only.

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
- `artifacts/api-server/` — Express API scaffold. Only a `/api/healthz` endpoint so far; no game features use it.
- `artifacts/mockup-sandbox/` — Replit's design-mockup harness (generated shadcn components). Not part of the game; don't edit by hand.
- `lib/` — API workspace packages: `api-spec` (OpenAPI source of truth), `api-client-react` + `api-zod` (generated — regenerate via codegen, never hand-edit), `db` (Drizzle schema, currently empty).
- `scripts/` — workspace scripts (placeholder only).

## Environment gotchas

- Package manager is **pnpm** (workspace). Replit runs `pnpm install --frozen-lockfile` after every pull, so any dependency change must include the updated `pnpm-lock.yaml` in the same commit.
- `react`/`react-dom` are pinned to exactly 19.1.0 (Expo requirement) and `@types/react`/`@types/react-dom` must stay on matching 19.1.x versions (catalog in `pnpm-workspace.yaml`).
- `pnpm-workspace.yaml` excludes most platform-specific binaries, but win32-x64 esbuild/rollup are deliberately kept for local Windows development — do not re-exclude them.
- Save data is versioned (`SAVE_VERSION` in `src/game/save.ts`). Changing the `Creature` shape requires a version bump **and** a migration path, or players lose their collections.
