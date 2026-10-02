# Army & Tactical Battlefield

**Combat status:** hero-vs-hero collisions on the adventure map open the **manual arena** by default (the 2026-09-27 wiring: `GameActions.startBattleFlow` → Fight / Quick Resolve / Flee modal → `src/screens/combat/arena/`, driven by [`shared/combat/manualBattle.ts`](../shared/combat/manualBattle.ts); Quick Resolve falls back to the server auto-resolver at [`shared/combat/resolveBattle.ts`](../shared/combat/resolveBattle.ts) via the `ResolveBattle` command). Settlements with troops also **defend themselves**: walking a hero onto an enemy — or neutral — settlement with a non-empty garrison enters the `SETTLEMENT_BATTLE` phase. A local-human attacker confirms in the assault modal first (Assault / Auto-resolve / Cancel — 2026-09-29 follow-ups, B5; Cancel leaves the hero on the tile with the garrison holding), then plays out in the same arena — attacker vs *"<name> Garrison"* (title bar: "Assault on \<name\>") — resolved via `SubmitSettlementBattleResult`. Since the 2026-09-29 capture/garrison wave the settlement battle applies the same hero outcomes as a hero battle (defeat removes the hero, retreat/surrender relocate — see Combat resolution below), and a battle whose attacker is not the local human auto-resolves instead of opening the arena. The unit-recruitment/garrison milestone added the original 13-unit catalog, building-gated recruitment into settlement garrisons, hero↔garrison transfer, and weekly garrison upkeep. The simple ±20% swing auto-resolve formula at the bottom of this doc was the original v1 plan, was never implemented, and is kept only as a historical design note.

## Unit roster (✅ live catalog)

The `unit_types` table is the authoritative roster — **16 units** after migrations `015_unit_catalog_v1` (the `tier` / `upkeep_gold` / `upkeep_food` / `range` columns + the 13th unit, **mage**: 6 atk / 3 def / 6 hp / 4 spd, ranged, arcane specialty ×1.2) and `020_faction_ladder_units` (**warhound**, **giant_eagle**, **eagle_prince** + the tier redefinition below). The client caches it via [`src/data/unitCatalog.ts`](../src/data/unitCatalog.ts) (`GET /api/units`). Migration 020 also **redefined `tier`**: it is no longer "lowest building level offering the unit" (that's the registry's per-entry `minLevel` on building levels 1–3) but the unit's faction power-band classification, 1–7.

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

The other four catalog entries — **griffin, hydra, wisp, black_dragon** — are **monsters**: catalog-only neutral content with a **NULL tier** (outside the 1–7 faction ladder since migration 020), never offered by any building's `recruits` list, range 1. Griffin deliberately remains non-recruitable.

**Upkeep is billed from the per-unit catalog** (`upkeep_gold`/`upkeep_food`, all currently shipping at 1, so 1 gold + 1 food per troop per week) and the engine now consumes those columns. How a shortfall is punished is *not* a flat trim — see [Upkeep](#upkeep-implemented-per-unit-catalog-bill) below.

## Recruitment (✅ implemented)

- **Building-gated, garrison-first.** The `RecruitUnits` command (`buildingKind` + `gx`/`gy` + `unitTypeId` + `count`) validates against the building's `recruits` entries in the registry (unit offered? settlement level ≥ `minLevel`? affordable from the settlement treasury/warehouse?) and lands the units in the **settlement garrison** (`SettlementState.stacks`), not directly on a hero. Engine: `recruitUnits` + `depositIntoGarrison` in `packages/engine/src/settlement/recruitUnits.ts`.
- **Hunting Lodge** and **Eagle Eyrie** are the newest recruit buildings (2026-09-30 roster expansion): the lodge is 250g + 8 wood over 3 days (recruits warhound 180g, `defenseBonus: 1`); the eyrie is 500g + 12 wood + 8 stone over 6 days (giant_eagle 1400g + 2 arcane at L1, eagle_prince 2400g + 4 arcane at L2).
- **Transfer to hero.** `TransferUnits` (`toHero`/`toGarrison`, per unit type + count) moves stacks between the garrison and a hero's platoons — the hero **must stand on the settlement**. Engine: `packages/engine/src/settlement/transferUnits.ts`.
- **UI:** the settlement info panel's **Garrison** accordion has per-type "→ Hero" / "→ Garrison" transfer buttons; the building menu renders generic recruit rows for any registry building with `recruits` (minLevel-filtered, quantity picker, live cost check).
- No build queue, no town screen — recruitment is instant.

## Hero unit cap

**Base 10 + 1 per owned [settlement](./settlements.md).** With 3 settlements, a hero can field 13 units.

## Combat resolution

**Hero vs hero (live):** an adventure-map collision opens the Fight / Quick Resolve / Flee modal. Fight plays out in the manual arena (`manualBattle.ts`; per-platoon attack range via `platoonRange` — the minimum per-unit `range` stat across the platoon's entries, replacing the old flat `RANGED_ATTACK_RANGE`) and submits `SubmitBattleResult`; Quick Resolve runs the server auto-resolver `shared/combat/resolveBattle.ts`. Both paths share the same server-side post-battle helpers (loot, hero outcomes, charter cleanup, dual-write). **Hero outcomes (2026-09-29):** the server maps each side's result to a verdict — a side wiped to zero troops is **defeated** and removed from the map entirely (heroes record + `player.heroIds` + `hero_platoons` rows; winner-takes-loot and charter cleanup apply to any removed hero); an arena **retreat** empties the hero's stacks server-side (subsuming the arena's 15% pre-loss) and respawns them at the nearest owned settlement; a **surrender** teleports there keeping troops (the surrender gold deduction is unchanged); with no owned settlement, a retreating/surrendering hero stays at its cancelled position instead. The auto-resolver never concedes, so AI-involved losses are always removals. See [heroes.md](./heroes.md) → Combat. **AI-involved exception (2026-09-29):** when the attacker is not the local human — AI-vs-AI, or an AI attacking you — the collision quick-resolves silently through the same `ResolveBattle` path (`maybeAutoResolveBattle`'s predicate keys on the local seat vs. the attacker); only the result card shows. A human attacker keeps the modal even against an AI.

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
