# MergeBound — design decisions and open threads

`CLAUDE.md` describes what **is built**. This file records what was **decided, proposed, or deliberately deferred** — the reasoning that would otherwise live only in a chat log and be lost when a session ends or a machine changes.

Keep this file honest: when something here gets built, move it to `CLAUDE.md` and delete it from here. When something here is rejected, say so rather than deleting it, so it doesn't get re-proposed.

---

## Settled principles (do not re-litigate without the owner)

**Explosive growth is intentional.** Compounding same-tier merges (tier 6 ≈ 2800× tier 0) is the point — big numbers are the appeal of merge/idle games. The balance table was made honest rather than made smaller. See `cumulativeStatMultiplier`.

**Merge like with like.** Cross-tier merging deliberately dilutes stats (no tier multiplier). It survives as a *type-reroll* tool — you consciously trade stats to change a creature's types, and therefore its whole moveset and its hybrid move. That trade is a feature, not an oversight.

**Rarity ≠ raw power.** A common-type creature should be able to beat a rare/mythic one. Rarity shows up as better base stats and better special attacks, never as a hard combat trump.

**Perfect rolls are the long-term chase.** Every stat rolls independently and its roll quality is persisted, so a creature can be exceptional on one stat and terrible on another. This is the "keep merging" engine. Pity (10 merges) turns bad luck into a visible countdown instead of an unbounded grind.

**Never sell power directly.** No selling finished creatures, gear, or stat outcomes for real money. Sell *time* (energy/refills, materials) and *vanity* (cosmetics), plus eventually a seasonal pass. The moment a player can buy a max-roll tier-6 creature, the merge loop — the thing that makes this game its own thing — stops mattering, grinders feel obsolete, and churn cascades. This also keeps clear of loot-box regulation (Belgium/Netherlands bans, app-store odds-disclosure rules).

---

## Proposed, not yet built

### Story premise (proposed, awaiting sign-off)

The nine elements once flowed from a single source, **the Wellspring**. A cataclysm — **the Sundering** — shattered it, scattering the **Wardens** that lived in harmony with it as unstable single-typed hatchlings. That is what eggs *are*: debris of the Sundering.

The player is a **Binder**, someone who has relearned the old Warden-magic of fusion (merging) — how the Wellspring's power originally worked. Each region cleared is a fragment of the world stabilising. Each boss is a **Discordant**: a corrupted apex Warden born of concentrated imbalance, guarding a Wellspring shard.

Why this premise earns its keep: it explains mechanics that already exist rather than decorating them. Aether is rarest *because* it is a shard of the Wellspring itself — which is also why it sits outside the eight-type effectiveness wheel. Gear exists because a Binder needs tools to channel fusion. Umbra/Lumen counter only each other because of a duality older than the break.

### The player character — the Binder (⚠️ needs a decision)

**Proposal: the Binder is a fourth combatant, not a spectator.** Player side becomes Binder + up to 3 Wardens. The Binder is just another `Combatant` running through the existing, already-tested battle engine.

- **Weapon class = basic attack style**, reusing the reliable/heavy pattern already built for creature moves: Sword (balanced physical), Axe (heavy physical), Bow (reliable physical), Staff (opens the special/spell line). No new combat maths.
- **Spells**: a small Binder-only moveset (2–4 slots), same `MoveDef` shape creatures use.
- **Potions**: consumables that *cost the Binder's turn*, so healing stays a real tradeoff rather than a free action.
- **Gear slots** (weapon, armor, accessory) grant stat bonuses exactly like a species' `baseStats` — forged and upgraded via the "Gear and the forge" phase already on the build order.

**Open question the owner has not answered yet:** is the Binder a combatant (above), or a non-combatant commander who buffs/supports from outside the party? This choice ripples through gear, spells, campaign difficulty tuning and UI, so settle it before building any of it.

### Campaign structure (proposed)

World Map → **Region** (themed to a type, e.g. an Ember region "Cinderreach") → chain of **Stages** (one battle each, reusing `runBattle` / `generateEnemyParty` nearly as-is) → **Boss Stage** (hand-authored, deliberately tougher than anything procedurally generated) → **Chest** → next Region unlocks.

- **1–3 stars per stage**, derivable from data the engine already produces: cleared at all / no Wardens fainted / cleared within N rounds.
- **Chest quality scales with stars earned.** Chest-opening reuses the reveal moment egg-hatching already does well — no new UX pattern, just a new thing being revealed.

### Retention mechanics (proposed, ordered by cost-to-build vs payoff)

1. **Pity on rare/mythic hatches** — same shape as the merge pity already shipped; a visible counter turns bad luck into a countdown. Cheap.
2. **Streaks / daily rewards** — escalating value, loss-aversion on breaking the streak. Data table + claim screen.
3. **Compendium** — every species×type combo ever obtained. Targets completionism and the goal-gradient effect, which is what sustains engagement over weeks rather than minutes.
4. **Limited-time banners** — hatching is already rarity-weighted, so a "featured type" event is a temporary weight override plus a countdown. Direct reuse.
5. **Reveal-moment polish** — slow, suspenseful per-stat reveal with a sting on any roll ≥90 rather than slamming all 8 numbers in at once. The roll system is already a near-miss engine; this amplifies something already built for near-zero engineering cost.
6. **Energy/stamina gating** — ⚠️ the easiest system here to make players resent. Tune generously; treat as a monetisation lever (sell refills), never as a wall.

---

## Known gaps in what's built

- No rewards or currency payout from battles — currencies don't exist yet.
- No PvP, no stat buffs/debuffs beyond heal/drain.
- No enemy roster variety beyond tier-scaled random generation.
- No accuracy-vs-heal-move balance pass; move power/accuracy numbers are first-draft.
- No formal **level** system. Tier is currently the only progression axis. If levelling separate from tier is ever wanted, that is a real design conversation, not an incremental addition.
- Aether has no effectiveness entries — deliberately neutral until battles were designed. Now that they are, this is worth revisiting.
