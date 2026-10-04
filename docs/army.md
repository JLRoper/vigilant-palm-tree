# Army & Tactical Battlefield

**Combat status:** hero-vs-hero collisions on the adventure map open the **manual arena** by default (the 2026-09-27 wiring: `GameActions.startBattleFlow` → Fight / Quick Resolve / Flee modal → `src/screens/combat/arena/`, driven by [`shared/combat/manualBattle.ts`](../shared/combat/manualBattle.ts); Quick Resolve falls back to the server auto-resolver at [`shared/combat/resolveBattle.ts`](../shared/combat/resolveBattle.ts) via the `ResolveBattle` command). **AI-defender battle choice (2026-10-04):** a battle the AI *offers* you no longer auto-resolves — the server's driver dispatches `EnterBattle` (`games.lobby.pendingBattle` + the `BattleOffered` event) and you resolve it from your own seat via the Fight/Quick-Resolve modal (no Flee — see Combat resolution below). Settlements with troops also **defend themselves**: walking a hero onto an enemy — or neutral — settlement with a non-empty garrison enters the `SETTLEMENT_BATTLE` phase. A local-human attacker confirms in the assault modal first (Assault / Auto-resolve / Cancel — 2026-09-29 follow-ups, B5; Cancel leaves the hero on the tile with the garrison holding), then plays out in the same arena — attacker vs *"<name> Garrison"* (title bar: "Assault on \<name\>") — resolved via `SubmitSettlementBattleResult`. Since the 2026-09-29 capture/garrison wave the settlement battle applies the same hero outcomes as a hero battle (defeat removes the hero, retreat/surrender relocate — see Combat resolution below), and a settlement battle whose attacker is not the local human still auto-resolves instead of opening the arena. The unit-recruitment/garrison milestone added the original 13-unit catalog, building-gated recruitment into settlement garrisons, hero↔garrison transfer, and weekly garrison upkeep. The simple ±20% swing auto-resolve formula at the bottom of this doc was the original v1 plan, was never implemented, and is kept only as a historical design note.

## Unit roster (✅ live catalog)

The `unit_types` table is the authoritative roster — **37 units** after migrations `015_unit_catalog_v1` (the `tier` / `upkeep_gold` / `upkeep_food` / `range` columns + the 13th unit, **mage**: 6 atk / 3 def / 6 hp / 4 spd, ranged, arcane specialty ×1.2), `020_faction_ladder_units` (**warhound**, **giant_eagle**, **eagle_prince** + the tier redefinition below), `024_ashen_court` (the seven Ashen Court units below), `025_ironmark_holds` (the seven Ironmark units below), and `026_verdant_wild` (the seven Verdant Wild units below). The client caches it via [`src/data/unitCatalog.ts`](../src/data/unitCatalog.ts) (`GET /api/units`). Migration 020 also **redefined `tier`**: it is no longer "lowest building level offering the unit" (that's the registry's per-entry `minLevel` on building levels 1–3) but the unit's faction power-band classification, 1–7.

Purchasable units (building-gated; `minLevel` = lowest building level offering the unit):

| Unit | Tier | Recruited at | Cost | Min level | Range |
|------|------|--------------|------|-----------|-------|
| Peasant | 1 | Farmhouse | 25g | 1 | 1 |
| Swordsman | 2 | Barracks | 200g | 1 | 1 |
| Archer | 4 | Archery Range | 250g, 2w | 1 | 5 |
| Monk | 6 | Mage Guild | 300g, 1a | 1 | 4 |
| Pikeman | 3 | Barracks | 250g, 3i | 2 | 1 |
| Crossbowman | 4 | Archery Range | 350g, 2i | 2 | 6 |
| Cavalry | 5 | Stables | 400g, 2i | 1 | 1 |
| Mage | 6 | Mage Guild | 500g, 2a | 2 | 6 |
| Crusader | 2 | Barracks | 500g, 5i | 3 | 1 |
| Warhound | 3 | Hunting Lodge | 180g | 1 | 1 |
| Giant Eagle | 7 | Eagle Eyrie | 1400g, 2a | 1 | 1 |
| Eagle Prince | 7 | Eagle Eyrie | 2400g, 4a | 2 | 1 |

(`w`=wood, `i`=iron, `a`=arcane dust)

### The Ironmark Holds roster (✅ migration `025`, 2026-10-02)

The mountain-hold dwarves — slow, armored, gold/stone/iron-heavy, the anti-thesis of fast swarms. Ranged comes from gunpowder (the faction's one innovation), elites from runeforged tradition. All seven are tagged `faction_id = 'ironmark'`, so only an ironmark seat can recruit them (the `RecruitUnits` gate); the faction's banner is `faction-banner-ironmark.png`.

| Unit | Tier | Recruited at | Cost | Min level | Range |
|------|------|--------------|------|-----------|-------|
| Dwarf Axeman | 2 | Forge Hall | 220g | 1 | 1 |
| Shield Bearer | 3 | Forge Hall | 280g, 2i | 2 | 1 |
| Hand Gunner | 4 | Gunners' Redoubt | 380g, 2i | 1 | 6 |
| Ironsworn | 5 | Golem Foundry | 550g, 4i | 1 | 1 |
| Iron Golem | 6 | Golem Foundry | 1200g, 4s, 4i | 2 | 1 |
| Runesmith | 6 | Deep Anvil | 550g, 3a | 1 | 4 |
| Forge Lord | 7 | Deep Anvil | 2200g, 6i, 2a | 2 | 1 |

(`s`=stone) Notes: `iron_golem` rides the **monster advantage type** (`advantage_type = 'monster'`, the always-advantaged attacker per `005_unit_counters.sql`) — deliberate for a construct, and consistent with how `warhound`/`giant_eagle` already ride it inside the Crownlands roster. Upkeep is the roster-wide flat 1g + 1f per troop per week.

The other four catalog entries — **griffin, hydra, wisp, black_dragon** — are **monsters**: catalog-only neutral content with a **NULL tier** (outside the 1–7 faction ladder since migration 020), never offered by any building's `recruits` list, range 1. Griffin deliberately remains non-recruitable.

**Roster factions (2026-10-02 foundation).** Migration `006_faction_rosters.sql` adds `unit_types.faction_id` — the roster-faction tag from the `FactionId` union (`human | ashen | ironmark | verdant | neutral`, CHECK-constrained): the 12 purchasable units are tagged `human` (the Crownlands roster), the four monsters `neutral` (DEFAULT `'neutral'` is fail-safe — an untagged future unit is recruitable by nobody, not by everyone), the seven Ashen Court units `ashen` (migration 024), the seven Ironmark units `ironmark` (migration 025), and the seven Verdant Wild units `verdant` (migration 026). Do **not** confuse it with `advantage_type`: that column is the combat triangle (`infantry/cavalry/ranged/monster`, unchanged) — a Pikeman is `infantry` on the triangle and `human` on the roster, a Warhound is `monster` on the triangle but a Crownlands ladder-3 unit on the roster, and the Iron Golem is `monster` on the triangle but an Ironmark ladder-6 unit on the roster. The engine-side registry is `packages/engine/src/factionRegistry.ts` (`FACTION_REGISTRY`: label/motto/palette/roster per faction — ashen, ironmark, and verdant all ship their seven-unit rosters, so a seat only leaves the human roster when a creator assigns it a faction). Seats pick a faction via `Player.factionId` (optional; absent = human) and the `RecruitUnits` command gates on it through `eligibleRecruitSources`' faction seam — active for all three content factions since migrations 024/025/026 (a human seat recruiting `ghoul`, `dwarf_axeman`, or `forest_scout` is rejected `unit_not_in_seat_faction`). The parity test `test/data/unitCatalogParity.test.ts` pins rosters ↔ the DB column and requires a banner file per non-neutral faction.

**The Ashen Court (2026-10-02, the game's second playable faction).** Migration `024_ashen_court.sql` fills the `ashen` roster with seven undead units — the catalog grows to **23 units** — and `FACTION_REGISTRY.ashen` ships its roster ("What death releases, the Court reclaims."): a necropolis-confederacy of cheap fast infantry swarms, spectral ranged, and an elite undead aristocracy; even its bowmen are revenants. A seat playing `ashen` sees **only** these units in its recruit lists (the `unitAllowedForSeatFaction` gate, active on both the server's `RecruitUnits` command and the client's building menu), and a `human` seat can neither see nor recruit any of them:

| Unit | Tier | Recruited at | Cost | Min level | Range |
|------|------|--------------|------|-----------|-------|
| Ghoul | 1 | Crypt | 40g | 1 | 1 |
| Bone Pikeman | 3 | Ossuary | 260g, 3i | 2 | 1 |
| Bone Archer | 4 | Ossuary | 260g, 2w | 1 | 5 |
| Wraith | 4 | Wraith Barrows | 380g, 2a | 1 | 4 |
| Blood Knight | 5 | Wraith Barrows | 480g, 2i | 2 | 1 |
| Vampire Lord | 6 | Spire of Ash | 850g, 4a | 1 | 1 |
| Lich | 7 | Spire of Ash | 1900g, 5a | 2 | 6 |

The Court's four recruit buildings are **Crypt** (150g + 4w, 2 days, `defenseBonus: 1`), **Ossuary** (300g + 10w + 6s, 4 days, `defenseBonus: 1`), **Wraith Barrows** (350g + 8w + 6s + 1a, 5 days, `defenseBonus: 2`), and **Spire of Ash** (500g + 12w + 8s + 2a, 6 days, `defenseBonus: 1`) — all 1×1 footprints, buildable by anyone but only recruiting for an `ashen` seat. All seven units ship at the roster-flat upkeep 1/1, on the same 1–7 ladder tiers as the Crownlands (ghoul 1, bone_pikeman 3, bone_archer/wraith 4, blood_knight 5, vampire_lord 6, lich 7). Seats choose their faction on New Game ("Your faction" chip row; options = registry factions with non-empty rosters); only the creator's seat 0 takes the pick in v1 — AI seats and other human seats stay `human` (documented limitation, same spirit as "no AI chartering"), and picking `human` sends no `seatFactions` at all so the legacy game shape is unchanged.

**The Verdant Wild (✅ migration `026_verdant_wild.sql`).** The forest faction's seven-unit roster, tiers 2–7, all tagged `faction_id = 'verdant'` — recruitable only by a seat whose `Player.factionId` is `verdant` (the `RecruitUnits` faction gate). Speed is the identity: elk_rider (spd 8) and stag_knight (spd 9) are the fastest units in the game, and the costs are wood-forward (only the stag_knight pays arcane). `warbeast`/`treant_elder` are `monster` on the combat triangle, the same ladder pattern as the Crownlands' warhound.

| Unit | Tier | Recruited at | Cost | Min level | Range |
|------|------|--------------|------|-----------|-------|
| Forest Scout | 2 | Grove Sanctum | 180g, 1w | 1 | 4 |
| Briar Warden | 3 | Warren Lodge | 260g, 2w | 1 | 1 |
| Warbeast | 3 | Warren Lodge | 300g | 2 | 1 |
| Thorn Archer | 4 | Grove Sanctum | 280g, 2w | 2 | 5 |
| Elk Rider | 5 | Sylvan Stables | 450g, 2w | 1 | 1 |
| Treant Elder | 6 | Worldroot Grove | 900g, 3w | 1 | 1 |
| Stag Knight | 7 | Sylvan Stables | 2000g, 3a | 2 | 1 |

All seven ship hero-panel icon busts and arena **idle** sprites (attack/move poses are the deferred Phase B art wave; the painter falls back to the idle/circle rendering for missing poses).

**Upkeep is billed from the per-unit catalog** (`upkeep_gold`/`upkeep_food`, all currently shipping at 1, so 1 gold + 1 food per troop per week) and the engine now consumes those columns. How a shortfall is punished is *not* a flat trim — see [Upkeep](#upkeep-implemented-per-unit-catalog-bill) below.

## Recruitment (✅ implemented)

- **Building-gated, garrison-first.** The `RecruitUnits` command (`buildingKind` + `gx`/`gy` + `unitTypeId` + `count`) validates against the building's `recruits` entries in the registry (unit offered? settlement level ≥ `minLevel`? affordable from the settlement treasury/warehouse?) and lands the units in the **settlement garrison** (`SettlementState.stacks`), not directly on a hero. Engine: `recruitUnits` + `depositIntoGarrison` in `packages/engine/src/settlement/recruitUnits.ts`.
- **Hunting Lodge** and **Eagle Eyrie** are the newest Crownlands recruit buildings (2026-09-30 roster expansion): the lodge is 250g + 8 wood over 3 days (recruits warhound 180g, `defenseBonus: 1`); the eyrie is 500g + 12 wood + 8 stone over 6 days (giant_eagle 1400g + 2 arcane at L1, eagle_prince 2400g + 4 arcane at L2).
- **The four Verdant Wild recruit buildings** (2026-10-02, migration 026): **Grove Sanctum** 300g + 8w + 5s over 4 days (forest_scout L1, thorn_archer L2), **Warren Lodge** 250g + 8w over 3 days (briar_warden L1, warbeast L2), **Sylvan Stables** 350g + 10w + 5s over 4 days (elk_rider L1, stag_knight L2), **Worldroot Grove** 500g + 12w + 8s over 6 days (treant_elder L1) — all 1×1, all `defenseBonus: 1`, wood-forward placement costs as the faction's economic flavor.
- **Transfer to hero.** `TransferUnits` (`toHero`/`toGarrison`, per unit type + count) moves stacks between the garrison and a hero's platoons — the hero **must stand on the settlement**. Engine: `packages/engine/src/settlement/transferUnits.ts`.
- **UI:** the settlement info panel's **Garrison** accordion has per-type "→ Hero" / "→ Garrison" transfer buttons; the building menu renders generic recruit rows for any registry building with `recruits` (minLevel-filtered, quantity picker, live cost check).
- No build queue, no town screen — recruitment is instant.

## Hero unit cap

**Base 10 + 1 per owned [settlement](./settlements.md).** With 3 settlements, a hero can field 13 units.

## Combat resolution

**Hero vs hero (live):** an adventure-map collision opens the Fight / Quick Resolve / Flee modal. Fight plays out in the manual arena (`manualBattle.ts`; per-platoon attack range via `platoonRange` — the minimum per-unit `range` stat across the platoon's entries, replacing the old flat `RANGED_ATTACK_RANGE`) and submits `SubmitBattleResult`; Quick Resolve runs the server auto-resolver `shared/combat/resolveBattle.ts`. Both paths share the same server-side post-battle helpers (loot, hero outcomes, charter cleanup, dual-write). **Hero outcomes (2026-09-29):** the server maps each side's result to a verdict — a side wiped to zero troops is **defeated** and removed from the map entirely (heroes record + `player.heroIds` + `hero_platoons` rows; winner-takes-loot and charter cleanup apply to any removed hero); an arena **retreat** empties the hero's stacks server-side (subsuming the arena's 15% pre-loss) and respawns them at the nearest owned settlement; a **surrender** teleports there keeping troops (the surrender gold deduction is unchanged); with no owned settlement, a retreating/surrendering hero stays at its cancelled position instead. The auto-resolver never concedes, so AI-involved losses are always removals. See [heroes.md](./heroes.md) → Combat. **AI-involved exception (2026-09-29, amended 2026-10-04):** AI-vs-AI collisions still quick-resolve silently through the same `ResolveBattle` path on the driving client (only the result card shows). An **AI attacking you** no longer auto-resolves: `resolveBattleChoice` (`battleChoicePolicy.ts`) replaces the old `pvp` predicate that mis-classified that case as PvP — the server's driver dispatches `EnterBattle`, the server stamps `games.lobby.pendingBattle` + appends `BattleOffered` (an apply-class delta), and the defender's client opens the Fight/Quick-Resolve modal (Flee hidden — it cancels the *attacker's* move) and submits from its own seat during the AI's turn; the driver waits up to `AI_DEFENDER_WAIT_TIMEOUT_MS` (300 s), then force-resolves and audits `ai_defender_wait_expired`. A human attacker keeps the modal even against an AI.

**Garrison defense (live):** attacking a settlement whose garrison has troops — enemy-owned **or neutral** (the `unowned_settlement` gate was removed in the 2026-09-29 capture/garrison wave) — enters `SETTLEMENT_BATTLE` (`startSettlementBattle`). A local-human attacker confirms in the assault modal (`assaultConfirmModal.ts`, B5) then fights the garrison in the same arena under the *"<name> Garrison"* label (arena titled "Assault on \<name\>" via `openManualBattleArena`'s `title` opt); the played-out result applies via `applySettlementBattleResult` (`SubmitSettlementBattleResult`). A non-local attacker auto-resolves through `TurnController.resolveSettlementBattle` (engine auto-resolver, result applied + POSTed, card/toast only), and since the follow-ups wave (B1) AI seats also **garrison their own settlements** during their turns — `pickGarrisonRecruitment` sizes threat = Σ enemy-hero `platoonPower` within reach 8 (target ratio 1.0, floor 4, gold reserve 100) and buys the best power-per-gold units the shared `eligibleRecruitSources` gate admits. Either way the attacker's outcome follows the hero-battle verdict rules — **defeat** removes the hero (charter folded, `heroIds` pruned), **retreat** zeroes the stacks and relocates to the nearest owned settlement (D1 stay-put), **surrender** relocates keeping troops — and `SubmitSettlementBattleResultResult` carries optional `attackerHero` (absence = removal) + `attackerVerdict` so every transport speaks the same wording. An emptied garrison lets the standing attacker capture — see [settlements.md](./settlements.md) → Capture.

**Fallback / historical (never implemented):** the simple **auto-resolve formula** — `attack` and `defense` derived from unit types + counts, a random ±20% swing per engagement, instant outcome with no per-unit positioning. Kept only so design intent isn't lost and the schema continues to anticipate a non-tactical mode if one is wanted later.

## Hero death

✅ **Implemented (2026-09-29): defeat removes the hero.** The previously locked plan — **captured for ransom** (fixed amount, released on payment with 1 peasant; settlements stay with the player) — is **superseded**:

- A hero whose army is wiped in battle is **deleted** from the adventure map: the state heroes record, their owner's `heroIds`, and their `hero_platoons` rows (orphan sweep in `heroRepo`'s full-sync upsert).
- Winner takes the loser's purse (wagon-capped) and cargo; a chartering loser's charter is cancelled, costs forfeited.
- The manual arena's **Retreat** (respawn at the nearest owned settlement, all troops lost, purse kept) and **Surrender** (teleport there, troops kept, gold cost paid) are the escape valves — full table in [heroes.md](./heroes.md) → Combat.
- No capture state exists; hero death for non-battle causes remains out of scope.

## Upkeep (✅ implemented, per-unit catalog bill)

Heroes and garrisons run the **same** rule through one module — `resolveTroopUpkeep` in [`packages/engine/src/economy/troopUpkeep.ts`](../packages/engine/src/economy/troopUpkeep.ts); the two call sites (`hero/upkeep.ts`, `settlement/garrisonUpkeep.ts`) only map their own entity fields in and out, so the two copies cannot drift. The charge is weekly (`day % 7 === 0`).

1. **Bill from the per-unit catalog**, never a flat 1g/1f: `costGold = Σ count × unitUpkeepGold(unit)`, same for food (`unit_types.upkeep_gold`/`upkeep_food`; the server path always passes `EngineCtx.catalog.unitTypes`, and a catalog-less caller falls back to the per-unit 1g/1f defaults). **Funding sources (narrowed 2026-10-02):** a hero pays from its **purse** + its **larder** (wagon-cargo food), and food only from the settlement **physically under the hero** — same hex, own-owned; the old owner-wide warehouse pool is gone (it fed the auto-trade teleport this rework removed), so a hero in the field or on a foreign town funds nothing beyond its own stores. A settlement's garrison is unchanged: **treasury** + warehouse food. Caravan maintenance (`packages/engine/src/economy/caravanUpkeep.ts`) is charged **before** this ladder in `applyWeeklyUpkeep` — `wagons × (1 gold + 1 food)` per route out of the route's origin store, sharing the same grace/desertion constants below, so on a shortage week the caravans are paid and the hero is the one going short.
2. **Shortfall by cost, not headcount.** Gold and food each starve their own count, cheapest-units-first and whole units only, and the **worse of the two wins** — one unfed soldier is one unfed soldier whichever shortage caused it. No debt is carried across charges (both pools clamp at 0).
3. **Paid in full** → shortfall bookkeeping cleared, morale unchanged.
4. **Short** → the first-unpaid day is stamped, morale bleeds in proportion to how much weekly *cost* went unpaid (1-point floor, `MORALE_UNPAID_LOSS_MAX = 25` ceiling), and whatever is there is paid.
5. **Desertion** only after `DESERT_GRACE_WEEKS = 2` unpaid charges, and then only `DESERT_COST_SHARE = 0.2` of the unfed shortfall's **cost** per week — expressed in cost rather than headcount, so an Eagle Prince counts as many peasants, and the draw is seeded from `castleSeed ^ round ^ day ^ entityId` so the server replays a charge bit-for-bit.

The unpaid-streak bookkeeping lives on the entity: `upkeepUnpaidSinceDay`/`upkeepUnpaidTroops`/`upkeepUnpaidGold` on a hero, `garrisonUnpaidSinceDay`/`garrisonUnpaidTroops`/`garrisonUnpaidGold` on a settlement. The catalog's own `upkeep_gold`/`upkeep_food` columns still all ship at 1/1, so the *numbers* are currently 1 gold + 1 food per troop per week — but the engine consumes those columns now, and the shortfall handling is no longer a flat trim-from-the-end.

## DB schema

Granular platoon tables (the old `army JSONB` preview is gone):

```sql
-- migration 009: hero stacks, one row per (hero, stack, unit type)
hero_platoons (hero_id, stack_index, unit_type_id, count)

-- migration 016: settlement garrison stacks, same flattening
settlement_platoons (settlement_id, stack_index, unit_type_id, count)
```

Both are dual-written by their repos (`heroRepo` / `settlementRepo`) and reassembled by the granular hydrate path; `unit_types` carries `tier`/`upkeep_gold`/`upkeep_food`/`range` (migration 015; 020 redefined `tier` as the 1–7 faction ladder and made it nullable for the neutral monsters).

## Cross-references

- Hero state and movement: [heroes.md](./heroes.md)
- Where recruitment happens: [settlements.md](./settlements.md)
- What units cost: [resources.md](./resources.md)

[← Back to index](./README.md)
