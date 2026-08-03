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

**The Binder never attacks, but what they wear matters.** *Decided by the owner 2026-08-03, settling the open question that used to live in this file.* The Binder is a visible, customisable character who directs from the sidelines — never a combatant, never a target, never taking a turn. Their gear (swords, amulets, armour) grants stat bonuses **to the player's creatures**, exactly the way a species' `baseStats` do.

Why this is the right shape: battles keep the party format and AI that are already built and tested — no rebalancing around a fourth body, no Binder-only moveset, no potion-turn economy. Gear still has somewhere meaningful to go, so "Gear and the forge" keeps its place on the build order. And the creatures stay the stars of the screen, which is the whole point of a creature-collecting game.

**Currency roles are fixed.** *Decided by the owner 2026-08-03.*

- **Gold** — the everyday earned currency. Paid out by **battles** and by **idle income**. Spent on forging gear and on buying merge stones.
- **Merge stones** — spent to merge. Earned through play, **or** bought with gold. This is what stops merging being free and gives gold somewhere to go, without ever gating the merge loop behind real money.
- **Gems** — the premium currency. Bought with real money, and occasionally awarded in **small** amounts for completing challenges. Gems can buy the other two.

Note the chain this creates: gems → gold → merge stones → merges. That is a real-money path to *faster* merging, which is fine and intended — it sells time. It must never become a path to *better* outcomes: no gem purchase may improve a stat roll, guarantee a rare type, or skip the pity counter. That line is what keeps this on the right side of "never sell power directly".

**Art is drawn, not photographed.** *Decided by the owner 2026-08-03.* A hybrid approach: authored illustrations for the fixed, finite things (eggs, battle backdrops, region scenes, tutorial art), and **procedural vector art for creatures**, derived from the creature's own data. Creatures must stay procedural — merging can produce far more species/type combinations than anyone can hand-draw, and every one of them needs to look deliberate. See `src/art/creatureArt.ts`.

**Merge stone supply is capped per day, and money cannot raise the cap.** *Decided 2026-08-03.* 60 earned + 30 bought = 90 a day, keyed to a day counter that never runs backwards. This is the single number that bounds every currency exploit at once: a top-tier creature costs 162 stones, so it takes at least two real days for anybody — biggest spender, hardest grinder, or someone winding their device clock. Money buys speed *up to* the ceiling. Easy to raise later; very hard to impose once players are used to unlimited.

**Anything derived from the device clock may only ever pay gold.** *Decided 2026-08-03.* A purely local offline economy cannot be made tamper-proof, so the design makes tampering pointless rather than impossible: idle income pays gold and nothing else, and gold's only route to merge stones passes the daily purchase cap. The whole blast radius of a clock cheat is "that player has a big gold number".

**The perfect-roll countdown only advances on merges that were paid for.** *Decided 2026-08-03.* Tier-0 merges are free, so without this a player could farm free merges to force a guaranteed perfect roll — and, via gems → gold → stones, money would accelerate it. That would make real money buy a *better outcome*, which is the one line that must never be crossed. Free merges are simply invisible to the pity system.

**No energy or stamina system.** *Decided by the owner 2026-08-03, rejecting the proposal that used to sit below.* Merge stones already meter how fast a player progresses; energy would be a second brake on a car that already has one, and players feel a second brake as punishment rather than pacing. Recorded as rejected so it is not re-proposed. Monetisation comes from time-savers, cosmetics and an eventual pass.

**Real-money purchases are deferred; the store ships spend-only.** *Decided 2026-08-03.* No payments library is installed, `expo-in-app-purchases` is deprecated, and the live alternatives need a custom dev build that cannot run in the web preview — the owner's only way to see the game. Gold, merge stone and cosmetic sections all work for real; the gems tab stays behind a flag and simply does not render, so nothing looks broken.

---

## Proposed, not yet built

### Story premise — **APPROVED by the owner 2026-08-03**

*Signed off as written. Build the campaign against it. Keep all player-facing wording in a data file so it can be reworded without touching code.*

The nine elements once flowed from a single source, **the Wellspring**. A cataclysm — **the Sundering** — shattered it, scattering the **Wardens** that lived in harmony with it as unstable single-typed hatchlings. That is what eggs *are*: debris of the Sundering.

The player is a **Binder**, someone who has relearned the old Warden-magic of fusion (merging) — how the Wellspring's power originally worked. Each region cleared is a fragment of the world stabilising. Each boss is a **Discordant**: a corrupted apex Warden born of concentrated imbalance, guarding a Wellspring shard.

Why this premise earns its keep: it explains mechanics that already exist rather than decorating them. Aether is rarest *because* it is a shard of the Wellspring itself — which is also why it sits outside the eight-type effectiveness wheel. Gear exists because a Binder needs tools to channel fusion. Umbra/Lumen counter only each other because of a duality older than the break.

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
6. ~~**Energy/stamina gating**~~ — **REJECTED by the owner 2026-08-03.** See Settled principles. Do not re-propose.

All five surviving items are specified concretely in [PLAN.md](PLAN.md), along with which are in the current build slice and which are deliberately deferred (hatch pity and banners are deferred because both need hatch-time rolling, which would break the tutorial's resume).

---

## The owner's verdict on the current build (2026-08-03)

Archie played the Replit preview and was blunt about it: **"it's just basically a text game currently, which is quite underwhelming."** The systems underneath are sound — the merge loop, battles, hybrid moves and pity all work — but almost none of it is *presented*. This is the highest-priority thread in the project, ahead of finishing the build order.

What he asked for, in his words and roughly his order:

1. **A choosing-of-the-egg tutorial.** New players currently arrive with no guided first moment. The hatch reveal is the game's best beat and nothing sets it up.
2. **Design your character's appearance.** The Binder needs to be visible and customisable. (Combat role now settled — see Settled principles.)
3. **A clear campaign understanding.** A player should be able to see where they are, what they're working towards and what comes next. The campaign structure below is proposed but unbuilt, and its absence is felt.
4. **Scenes and graphics generally.** "There's no visuals to it, basically, it's all text."
5. Overall: **"make it as addictive as possible and fun."**

First step taken: creatures are now drawn as procedural vector portraits rather than coloured rectangles (`src/art/creatureArt.ts`). That is one screen's worth of the problem. The tutorial, the Binder's appearance, campaign presentation and battle/region backdrops are all still open.

**A working note for whoever picks this up:** verify visual work by actually looking at it. Real UI verification happens in Replit's preview, or in a local `expo start --web` from a session rooted at this repo. The creature portraits above were built without eyes on them and have never been visually reviewed — treat their shapes, proportions and colours as unconfirmed until someone looks.

## Known gaps in what's built

**Three combat bugs were found and fixed on 2026-08-03** during the design review, before any new feature work. Recorded here because two of them had been masking each other and re-introducing either one alone would break the game worse than both together:

1. **Critical-hit stats grew with tier.** By tier 4 every species was above 100% crit chance — every hit a critical — and a tier-6 creature hit for ~4400x normal damage. Percentages are not amounts; they now never take the tier multiplier.
2. **Damage did not grow with tier while health did.** The attack/defence ratio cancels in an even fight, so a tier-6 mirror match needed ~1516 hits against a 50-round cap: an unwinnable draw. Damage now scales on the attacker's cumulative multiplier. **Fixing bug 1 alone would have exposed this and made every high-tier battle a permanent stalemate** — the absurd crit multiplier was the only thing punching through the inflated health.
3. **The battle engine could freeze.** A round's turn order is fixed at the start of the round, so creatures killed mid-round stay queued; if every remaining entry was dead while both sides still had someone alive, the engine stopped producing an actor and never advanced the round, so `runBattle` span forever. Reachable in any 2-v-2 where both sides trade kills in one round. On a device that is a frozen game.

### A balance decision for the owner: what the perfect-roll countdown counts

*Raised by the 2026-08-03 review. Not a bug — the code does exactly what this file says — but worth a deliberate answer before the merge screen ships.*

The countdown to a guaranteed perfect roll counts **merges**, and now only merges that cost merge stones. It does not care how much they cost. A tier-1 merge costs 1 stone, so ten of them cost 10 stones and buy the guarantee — the same guarantee ten tier-5 merges (500 stones) would buy.

The review flagged this as an exploit. It was checked and it is not one: nine ordinary same-tier merges also cost 9 stones **and hand the player nine tier-2 creatures on top**, whereas grinding cheap junk merges hands them nothing. The cheap route is strictly worse than simply playing. It opens no path ordinary play does not already have.

But it is still a real question: *should ten cheap merges buy the same guarantee as ten expensive ones?* Both answers are defensible. Counting merges (today) makes pity a steady, legible promise at every tier. Counting stones spent would make the guarantee cost proportionally more the higher you climb.

**Recommendation: leave it counting merges.** It is what DESIGN.md's settled principles already describe, it is far easier to explain to a player, and the daily stone cap already bounds how fast anyone can reach it. Changing it would alter how quickly pity arrives at every tier — a re-litigation of a settled principle, which needs the owner, not a quiet patch.

**Found by an adversarial review on 2026-08-03 and still open.** None are live yet (idle income and the collection tools are not wired to any screen), but each is cheaper to fix before they are than after:

- **`idleRoster` picks who earns by `creaturePower` but pays them by tier.** Those two orderings can disagree, so the roster can bench a creature that would have paid more than the one keeping it out — and the player-facing "these are earning" list can show their biggest earner as not earning. Pick and pay must use the same ordering. Fix when idle income gets a screen.
- **`canMerge` and `suggestMergePartners` default `lockedIds` to an empty array**, so the padlock — the only guard on an irreversible action — fails OPEN if a caller forgets the argument. Make the parameter required so forgetting it is a compile error rather than a silently unlocked creature.
- **Idle income leaks to rounding on frequent collection.** Gold is floored per collect and the timer resets, so sixty one-minute collects pay noticeably less than one hourly collect. Direction is safe (it can never pay more), so it is a leak rather than an exploit — but `minCollectMinutes` at 1 does not actually prevent what its comment says it prevents.

A separate finding against `sanitizeBinderName` (splitting emoji, letting control characters through) was **checked and found to be wrong** — that module already handles surrogate pairs, the C1 block and zero-width characters. Recorded so it is not "fixed" twice. Agent reports are evidence, not verdicts; reproduce before acting.

Remaining gaps:

- No rewards or currency payout from battles — the wallet persists, but nothing earns or spends yet (PLAN.md Step 1).
- No PvP, no stat buffs/debuffs beyond heal/drain.
- No enemy roster variety beyond tier-scaled random generation.
- No accuracy-vs-heal-move balance pass; move power/accuracy numbers are first-draft.
- No formal **level** system. Tier is currently the only progression axis. If levelling separate from tier is ever wanted, that is a real design conversation, not an incremental addition.
- Aether has no effectiveness entries — deliberately neutral until battles were designed. Now that they are, this is worth revisiting.
