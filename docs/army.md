# Army & Tactical Battlefield

**Combat status:** hero-vs-hero collisions on the adventure map open the **manual arena** by default (the 2026-09-27 wiring: `GameActions.startBattleFlow` → Fight / Quick Resolve / Flee modal → `src/screens/combat/arena/`, driven by [`shared/combat/manualBattle.ts`](../shared/combat/manualBattle.ts); Quick Resolve falls back to the server auto-resolver at [`shared/combat/resolveBattle.ts`](../shared/combat/resolveBattle.ts) via the `ResolveBattle` command). Settlements with troops also **defend themselves**: walking a hero onto an enemy settlement with a non-empty garrison enters the `SETTLEMENT_BATTLE` phase and plays out in the same arena — attacker vs *"<name> Garrison"* — resolved via `SubmitSettlementBattleResult`. The unit-recruitment/garrison milestone added the 13-unit catalog, building-gated recruitment into settlement garrisons, hero↔garrison transfer, and weekly garrison upkeep. The simple ±20% swing auto-resolve formula at the bottom of this doc was the original v1 plan, was never implemented, and is kept only as a historical design note.

## Unit roster (✅ live catalog)

The `unit_types` table is the authoritative roster — **13 units** after migration `015_unit_catalog_v1`, which added the `tier` / `upkeep_gold` / `upkeep_food` / `range` columns and the 13th unit, **mage** (6 atk / 3 def / 6 hp / 4 spd, ranged, arcane specialty ×1.2). The client caches it via [`src/data/unitCatalog.ts`](../src/data/unitCatalog.ts) (`GET /api/units`).

Purchasable units (building-gated; `minLevel` = lowest building level offering the unit):

| Unit | Recruited at | Cost | Min level | Range |
|------|--------------|------|-----------|-------|
| Peasant | Farmhouse | 25g | 1 | 1 |
| Swordsman | Barracks | 200g | 1 | 1 |
| Archer | Archery Range | 250g, 2w | 1 | 5 |
| Monk | Mage Guild | 300g, 1a | 1 | 4 |
| Pikeman | Barracks | 250g, 3i | 2 | 1 |
| Crossbowman | Archery Range | 350g, 2i | 2 | 6 |
| Cavalry | Stables | 400g, 2i | 1 | 1 |
| Mage | Mage Guild | 500g, 2a | 2 | 6 |
| Crusader | Barracks | 500g, 5i | 3 | 1 |

(`w`=wood, `i`=iron, `a`=arcane dust)

The other four catalog entries — **griffin, hydra, wisp, black_dragon** — are **monsters**: catalog-only (tier 3), never offered by any building's `recruits` list, range 1.

**Upkeep is flat 1 gold + 1 food per troop per week** for every unit type (`upkeep_gold`/`upkeep_food` all ship at 1); per-type tuning is deferred until the engine consumes those catalog columns (see [Upkeep](#upkeep-implemented-flat) below).

## Recruitment (✅ implemented)

- **Building-gated, garrison-first.** The `RecruitUnits` command (`buildingKind` + `gx`/`gy` + `unitTypeId` + `count`) validates against the building's `recruits` entries in the registry (unit offered? settlement level ≥ `minLevel`? affordable from the settlement treasury/warehouse?) and lands the units in the **settlement garrison** (`SettlementState.stacks`), not directly on a hero. Engine: `recruitUnits` + `depositIntoGarrison` in `packages/engine/src/settlement/recruitUnits.ts`.
- **Stables** is the newest recruit building: placement 350g + 10 wood + 5 stone, recruits cavalry (400g + 2 iron), `defenseBonus: 1`.
- **Transfer to hero.** `TransferUnits` (`toHero`/`toGarrison`, per unit type + count) moves stacks between the garrison and a hero's platoons — the hero **must stand on the settlement**. Engine: `packages/engine/src/settlement/transferUnits.ts`.
- **UI:** the settlement info panel's **Garrison** accordion has per-type "→ Hero" / "→ Garrison" transfer buttons; the building menu renders generic recruit rows for any registry building with `recruits` (minLevel-filtered, quantity picker, live cost check).
- No build queue, no town screen — recruitment is instant.

## Hero unit cap

**Base 10 + 1 per owned [settlement](./settlements.md).** With 3 settlements, a hero can field 13 units.

## Combat resolution

**Hero vs hero (live):** an adventure-map collision opens the Fight / Quick Resolve / Flee modal. Fight plays out in the manual arena (`manualBattle.ts`; per-platoon attack range via `platoonRange` — the minimum per-unit `range` stat across the platoon's entries, replacing the old flat `RANGED_ATTACK_RANGE`) and submits `SubmitBattleResult`; Quick Resolve runs the server auto-resolver `shared/combat/resolveBattle.ts`. Both paths share the same server-side post-battle helpers (loot, charter cleanup, dual-write). **AI-involved exception (2026-09-29):** when the attacker is not the local human — AI-vs-AI, or an AI attacking you — the collision quick-resolves silently through the same `ResolveBattle` path (`maybeAutoResolveBattle`'s predicate keys on the local seat vs. the attacker); only the result card shows. A human attacker keeps the modal even against an AI.

**Garrison defense (live):** attacking a settlement whose garrison has troops enters `SETTLEMENT_BATTLE` (`startSettlementBattle`); the garrison fights in the same arena under the *"<name> Garrison"* label, and the played-out result applies via `applySettlementBattleResult` (`SubmitSettlementBattleResult`). An emptied garrison lets the standing attacker capture — see [settlements.md](./settlements.md) → Capture.

**Fallback / historical (never implemented):** the simple **auto-resolve formula** — `attack` and `defense` derived from unit types + counts, a random ±20% swing per engagement, instant outcome with no per-unit positioning. Kept only so design intent isn't lost and the schema continues to anticipate a non-tactical mode if one is wanted later.

## Hero death

✅ **Locked:** **captured for ransom.**

- Ransom: fixed amount (TBD), paid from inventory.
- Hero released immediately with 1 peasant.
- Settlements stay with the player.

## Upkeep (✅ implemented, flat)

- **Heroes:** weekly (`applyWeeklyUpkeep`, day % 7 === 0), 1 gold per troop from the hero purse (existing `applyHeroUpkeep`).
- **Garrisons:** weekly in the same pass via `applyGarrisonUpkeep` (`packages/engine/src/settlement/garrisonUpkeep.ts`) — 1 gold per troop from the settlement **treasury** and 1 food per troop from its **warehouse**; when a pool runs short, stacks are **trimmed from the end**.
- Per-type upkeep values exist in `unit_types` (`upkeep_gold`/`upkeep_food`) but all ship at 1/1; wiring the engine to consume them per type is deferred.

## DB schema

Granular platoon tables (the old `army JSONB` preview is gone):

```sql
-- migration 009: hero stacks, one row per (hero, stack, unit type)
hero_platoons (hero_id, stack_index, unit_type_id, count)

-- migration 016: settlement garrison stacks, same flattening
settlement_platoons (settlement_id, stack_index, unit_type_id, count)
```

Both are dual-written by their repos (`heroRepo` / `settlementRepo`) and reassembled by the granular hydrate path; `unit_types` carries `tier`/`upkeep_gold`/`upkeep_food`/`range` (migration 015).

## Cross-references

- Hero state and movement: [heroes.md](./heroes.md)
- Where recruitment happens: [settlements.md](./settlements.md)
- What units cost: [resources.md](./resources.md)

[← Back to index](./README.md)
