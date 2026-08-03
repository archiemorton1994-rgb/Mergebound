# MergeBound

MergeBound is a mobile creature-merging RPG built with Expo / React Native and TypeScript, targeting an eventual App Store release via Replit. Players hatch creatures from eggs, merge two creatures into a stronger one, battle, earn idle income, forge gear, and buy currency — built in that order (see Build order). Slice 1 (hatch + merge + local save) and the core of slice 2 (party battles) are complete.

**The owner cannot read or write code.** Every change must come with a plain-English summary of what changed and why. Automated checks are the owner's only way to verify work — keep them passing and extend them with every logic change.

**Read [DESIGN.md](DESIGN.md) too.** This file covers what *is built*; `DESIGN.md` covers what was *decided, proposed, or deferred* — settled principles not to re-litigate, proposals awaiting sign-off, and known gaps. Together they are the whole project memory; neither is complete alone.

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

### Merge pity (guaranteed perfect roll)

`mergeWithPity(a, b, rng, mergesSincePerfectRoll)` in `merge.ts` wraps `merge()` with a pity counter: if `MERGE_PITY_THRESHOLD` (10) merges pass with no stat naturally rolling a 100, the next merge forces one randomly-chosen stat to a perfect (100) roll and resets the counter. A natural 100 also resets the counter early, whether or not pity was close to triggering. The counter is account-wide (not per-creature) and persists in the save file (`SaveData.mergePity`) — `CollectionContext.tsx` owns it, `EggScreen.tsx` reads/writes it around every merge and shows a countdown. The forcing mechanism itself is a `forcedPerfectStat` parameter on `merge()`/`mergedStats()` — every other stat still rolls normally, only the chosen one is guaranteed.

## Stats

Every creature has eight stats (`STAT_KEYS` in `models.ts` is the single source of truth for the list): `hp`, `atk`, `spAtk` (special attack), `def`, `spDef` (special defence), `spd`, `critChance` (%), `critDamage` (% damage multiplier on a crit). Species lean physical or special in `species.json`'s `baseStats` on purpose, ahead of battles being built.

Every stat also carries a persisted **roll quality** (`statRolls`, 0-100 per stat, alongside `stats`) recording where that stat's most recent roll landed in its ±15% band — 100 is the best possible roll. This is what makes hunting a "perfect roll" a real, visible thing: a creature can have a 98 on `critChance` and a 6 on `hp` at the same time, because every stat rolls independently on every hatch or merge. `CreatureCard.tsx` colours a stat's displayed value by its roll quality (gold ≥90, dim ≤15) so this is visible without extra UI chrome.

## Creature portraits

Creatures are drawn as **vector art generated from their own data** — there are no image files, and there is no species artwork to go missing when a merge invents a combination nobody anticipated. Split in two, deliberately:

- `src/art/creatureArt.ts` decides **what a creature looks like** — pure TypeScript, no UI imports, fully unit-tested like the game rules. Species picks the silhouette (one of eight: flame, leaf, droplet, wing, boulder, spark, wisp, crystal), the primary type's colour becomes the body, the second type's colour becomes the accent, tier adds an aura, and a near-perfect stat roll adds a sparkle.
- `src/screens/CreatureSprite.tsx` **draws it** with `react-native-svg`, holding the path geometry for each silhouette.

Keep that split. Anything that could be described as a rule ("high tiers glow", "dual types look richer") belongs in the pure module where it can be tested; only path data and SVG belong in the component.

Two things that look like details but are not:

- A **single-typed** creature gets a lightened version of its own colour as its accent, so a **dual-typed** creature is visibly richer. That is intentional reinforcement of merging as the way to get there.
- The sparkle threshold is the same 90 that `CreatureCard` already uses to colour a stat gold, so a creature whose numbers are gold also visibly sparkles. Chasing perfect rolls has to be readable at a glance, not by reading eight numbers.

SVG gradient ids are document-global, so `CreatureSprite` namespaces its `<Defs>` ids with the creature's id — two sprites on one screen would otherwise fight over one definition. Keep that if you add gradients.

## Type system

Nine types, defined in `src/data/types.json`, each with a `rarity` (`common` | `rare` | `mythic`) that drives real hatch odds via `balance.json`'s `typeRarityWeights` (`pickWeighted` in `rng.ts`) — rare and mythic types are meaningfully harder to hatch, not just labelled differently:

- Six **common** types in a weakness ring, each **strong against the next**: Ember → Bloom → Tide → Gale → Crag → Volt → Ember (and correspondingly weak against the previous).
- Two **rare** types: **Umbra** and **Lumen**, strong against each other only.
- One **mythic** type, rarer than either rare type: **Aether**. No effectiveness interactions defined yet — deliberately left neutral until battles are designed rather than guessed at now.

Rarity is not meant to be raw combat power: a common-type creature should still be able to beat a rare/mythic one. Rarity should show up as better base stats and better special attacks on the species that roll those types, not as a hard combat trump — keep this in mind when battles get built.

The effectiveness table in `types.json` (2 = strong, 0.5 = weak) is now live — battles read it. Hatched creatures get exactly one type; two types only ever come from merging.

## Battle system

Party format: up to 3 player creatures vs. a generated enemy party of the same size. One engine, two ways to play it (`battle.ts`):

- **Auto**: `runBattle()` simulates the whole thing instantly and returns a complete event log to play back at any speed.
- **Manual**: `startBattle()` + `currentActor()` + `takeTurn()` / `takeAutoTurn()` let a caller (the UI) drive one action at a time. The player picks move + target for their own creatures' turns; enemy turns always resolve via the built-in AI. `runBattle()` is itself just `startBattle()` driven entirely by `takeAutoTurn()` in a loop — auto mode is not a separate code path, it's the same manual primitives run without a human in between.

Rules, shared by both modes:

- **Moves come from types, not species** (`src/data/moves.json`, `movesForCreature` in `content.ts`): a creature's available moves are the union of its 1-2 types' movepools. Every type grants 2 physical + 2 special damage moves — a reliable one (higher accuracy, lower power) and a heavy one (lower accuracy, higher power) per category, so manual play has a real risk/reward choice between them, not one obviously-best move. Bloom, Umbra and Lumen additionally grant a support move.
- **Hybrid moves are the reward for a specific dual type** (`src/data/hybridMoves.json`, `hybridMoveFor` / `effectivenessForMove` in `content.ts`): every one of the 36 possible type pairs has one authored, named signature move (e.g. Tide+Ember → "Steam Eruption"), granted only to a creature with exactly those two types. This means a cross-tier merge done purely to change a creature's types (see the merge Types rule) can hand it a move neither parent type had alone — the actual "perk of merging" the owner asked for. A hybrid move's effectiveness *averages* its two component types' multipliers against the defender rather than stacking them, so it's reliably decent instead of a coin flip between a blowout and a dud.
- **Physical vs special**: a move's `category` decides which stat pair resolves it — `physical` uses the attacker's `atk` vs the defender's `def`; `special` uses `spAtk` vs `spDef`. This is why species lean physical or special in their base stats — that was built ahead of this on purpose.
- **Damage formula** (`computeDamage` in `battle.ts`): `power × (attackStat / defenceStat) × typeEffectiveness × critMultiplier × (±combatDamageVariance roll)`, floored at 1. `critChance`/`critDamage` are the creature's own stats — no separate combat-only crit system.
- **Support moves**: Bloom heals whichever living ally (including itself) is lowest on HP, Lumen heals the whole party a smaller amount, Umbra deals damage and heals itself for a fraction of it (`drain`). Heals and drain never overheal past max HP. This is deliberately data-driven (a move's `kind`), not a `role` field on `Creature` — role is emergent from typing.
- **AI** (same heuristic both sides, `chooseAction`): if a living ally's HP is below 50% of max and the actor knows a heal move, heal the neediest ally. Otherwise, attack the lowest-HP living enemy with whichever move (damage, drain, or hybrid) has the best type-effectiveness multiplier against it. Turn order is every living combatant on both sides, fastest `spd` first, recomputed each round. In Manual mode, the player overrides this for their own creatures only — enemies are always AI.
- **Enemies are generated, not authored** (`encounter.ts`): `generateEnemyParty(rng, tier, size)` reuses the exact same stat-rolling pipeline as hatching (`rollAllStats` + the honest `cumulativeStatMultiplier`), so an enemy at tier T is built the way a player creature that legitimately reached tier T would be — no separate enemy-balance system to keep in sync.
- Battle HP is **ephemeral** — a `Combatant` wrapper (`{ creature, currentHp, side }`) tracks HP for the duration of one battle only; the persisted `Creature.stats.hp` (max HP) is never mutated.
- **Not implemented yet, deliberately**: no rewards/currency payout (currencies don't exist yet — see below), no PvP, no stat buffs/debuffs beyond heal/drain, no enemy roster variety beyond tier-scaled random generation, no accuracy-vs-heal-move balance pass. All fine to add later; don't invent them speculatively.

## Currencies (planned)

- **Gold** — earned from battles and idle income; spent forging gear.
- **Merge stones** — spent to merge creatures.
- **Gems** — bought with real money; can buy the other two.

None are implemented yet. When they are, their amounts and prices belong in `src/data/`, not in code.

## Build order

1. ✅ Creatures and merging (slice 1)
2. ✅ Battles (slice 2 core loop — party format, moves, AI, generated enemies; rewards/PvP/roster variety still open)
3. Idle income
4. Gear and the forge
5. Shop and IAP — last

Do not build ahead of this order without the owner asking for it.

## Where things live

- `artifacts/mobile/` — the Expo app (the game).
  - `src/game/` — pure game logic: `models.ts` (types), `rng.ts` (seeded RNG), `content.ts` (JSON access), `hatch.ts`, `merge.ts`, `save.ts` (serialise/validate saves), `battle.ts` (party battle resolution), `encounter.ts` (enemy generation).
  - `src/data/` — species, types, moves, hybrid moves, and balance JSON.
  - `src/art/` — pure, tested **visual** derivation (`creatureArt.ts`). Same no-UI-imports rule as `src/game/`; the difference is that `src/game/` decides what is *true* and `src/art/` decides what is *shown*.
  - `src/screens/` — UI: `EggScreen.tsx` (slice-1 flow), `BattleScreen.tsx` (slice-2 flow), `CreatureCard.tsx` (portrait + stats), `CreatureSprite.tsx` (SVG creature art), `CollectionContext.tsx` (state + AsyncStorage persistence — the only file that touches storage).
  - `app/` — expo-router route files only; no logic. `index.tsx` → Hatchery, `battle.tsx` → Battle.
- `artifacts/api-server/` — Express API scaffold. Only a `/api/healthz` endpoint so far; no game features use it yet, but it's real registered Replit deployment infrastructure (production build/run/health-check wired in its `.replit-artifact/artifact.toml`), not orphaned code — future server-authoritative features (battles, idle income, IAP validation) will likely build on it.
- `lib/` — API workspace packages backing `api-server`: `api-spec` (OpenAPI source of truth), `api-client-react` + `api-zod` (generated — regenerate via codegen, never hand-edit), `db` (Drizzle schema, currently empty, scaffolded ahead of need).
- `scripts/post-merge.sh` — the only thing left in `scripts/`. Run automatically by Replit after every pull (`.replit`'s `[postMerge]` hook): reinstalls deps and pushes DB schema changes. Not a pnpm package — invoked directly by path.

## Environment gotchas

- Package manager is **pnpm** (workspace). Replit runs `pnpm install --frozen-lockfile` after every pull, so any dependency change must include the updated `pnpm-lock.yaml` in the same commit.
- `react`/`react-dom` are pinned to exactly 19.1.0 (Expo requirement) and `@types/react`/`@types/react-dom` must stay on matching 19.1.x versions (catalog in `pnpm-workspace.yaml`).
- `pnpm-workspace.yaml` excludes most platform-specific binaries, but win32-x64 esbuild/rollup are deliberately kept for local Windows development — do not re-exclude them.
- Save data is versioned (`SAVE_VERSION` in `src/game/save.ts`, currently 3 — `SaveData` is now `{ collection, mergePity }`, not just an array). **Changing what's saved requires a version bump AND a migration function in the same change**, or players lose their collections/pity progress on update — `deserializeCollection` must keep accepting every old version it has ever shipped. See the v1→v2 and v2→v3 migrations in `save.ts` for the pattern to copy.
- Local web preview (`expo start --web`) could not be driven from this Windows dev box in this Claude Code session: the browser preview tool is bound to the session's original working directory (`Grow`, a *different* project this box also has open), not wherever a Bash/PowerShell call has `cd`'d to — so `preview_start` silently launches Grow's own dev server instead of MergeBound's, no matter what `.claude/launch.json` says here. `.claude/launch.json` + `.claude/mobile-web-wrapper.js` are still worth keeping for a session actually rooted in this repo. Until then, verify with `pnpm run check` and say so plainly rather than claiming a visual check that didn't happen — real UI verification for this project happens in Replit's own preview.
