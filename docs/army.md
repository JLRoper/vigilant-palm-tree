# Army & Tactical Battlefield

**Combat status (today):** the server runs the **temporary default auto-resolver** at [`shared/combat/resolveBattle.ts`](../shared/combat/resolveBattle.ts) via the `ResolveBattle` command on `POST /api/games/:name/commands` whenever two heroes collide on the adventure map — it replaces the old "delete the defender outright" behavior with a turn-loop, type-advantage math, counterattacks, and retreat policies, but **no player input** is involved. The eventual target is the **tactical (manual) resolver** ([`shared/combat/manualBattle.ts`](../shared/combat/manualBattle.ts) + the dev Test Battle arena at [`src/views/manualBattleArena.ts`](../src/views/manualBattleArena.ts)) and it is **in progress** — the engine and dev arena have shipped, but wiring the adventure-map hero-collision trigger into the manual arena UI is still pending. The simple ±20% swing auto-resolve formula described below was the original v1 plan, was never implemented, and is kept only as a fallback / preview design in case a quicker non-tactical mode is wanted later. Documented here so that design intent isn't lost and the schema anticipates it.

## Why this was originally deferred

The player chose to skip the full army model for v1 to keep the resource/settlement system focused. Food is also deferred — it returns here, not in the [resources](./resources.md) doc.

## Scope (when we build this)

A second screen/mode that opens when two heroes meet on the adventure map. Combat becomes **tactical** — units on a grid, turn-based actions, manual positioning.

## Unit roster — placeholder names only

⚠️ **The roster table below is a placeholder sketch.** It is **not** the locked v1 unit list — the final roster, costs, and stats will be designed when this system lands. The code today contains a separate set of placeholder unit names (`swordsman`, `archer`, `cavalry`, `crossbowman`, `griffin` in [`src/data/unitCatalog.ts`](../src/data/unitCatalog.ts)) used only to make the UI and battle flow exercisable; **neither list is authoritative**.

When this system is designed for real:

5 unit types. Every **human** army type costs **1 food/day** for upkeep.

| Unit | Cost | Upkeep | Role |
|------|------|--------|------|
| Peasant | 10g | 1 food | Cheap filler, scout |
| Militia | 20g, 10w | 1 food | Basic infantry |
| Archer | 35g, 15w | 1 food | Ranged |
| Knight | 80g, 20w, 10i | 2 food | Heavy melee |
| Mage | 100g, 10i, 5a | 2 food | Spell support, fragile |

(`g`=gold, `w`=wood, `i`=iron, `a`=arcane dust)

## Recruitment

- Instant, at any friendly [settlement](./settlements.md).
- Click hero at settlement → recruit menu → unit appears immediately in hero's stack.
- No build queue, no town screen.

## Hero unit cap

**Base 10 + 1 per owned [settlement](./settlements.md).** With 3 settlements, a hero can field 13 units.

## Combat resolution

**Current default (temporary):** `shared/combat/resolveBattle.ts` runs server-side as an auto-resolver with no player input — damage formula, type-advantage chart, counterattack chains, and self/hero retreat policies (full design in [`feature-plans/CombatResolutionEngine.md`](../feature-plans/CombatResolutionEngine.md) and the in-progress technical write-up in [`docs/CombatResolutionEngine-TechnicalDesign.md`](./CombatResolutionEngine-TechnicalDesign.md)).

**Target (in progress):** the tactical (manual) resolver at `shared/combat/manualBattle.ts` + `src/views/manualBattleArena.ts`. The dev Test Battle arena exercises it today; the adventure-map hero-collision trigger wiring is the remaining piece.

**Fallback / historical (never implemented):** the simple **auto-resolve formula** below was the original v1 plan. Kept here only so design intent isn't lost and the schema continues to anticipate a non-tactical mode if one is wanted later.

- `attack` and `defense` derived from unit types + counts.
- Random ±20% swing per engagement.
- Instant outcome, no per-unit positioning in v1.

## Hero death

✅ **Locked:** **captured for ransom.**

- Ransom: fixed amount (TBD), paid from inventory.
- Hero released immediately with 1 peasant.
- Settlements stay with the player.

## Food (deferred)

- Every **human** army type costs **1 food/day** for upkeep.
- When this system ships, [Food](./resources.md#open-questions) returns to the resource list.
- Net food production vs upkeep determines whether units starve (lose units) or the player can grow.

## DB schema preview

```sql
-- on heroes table (new)
army JSONB NOT NULL DEFAULT '[]'::jsonb
-- each entry: { unit_type, count }

captured_until_turn INTEGER  -- NULL if free, else turn number when ransom auto-expires (future)
```

## Cross-references

- Hero state and movement: [heroes.md](./heroes.md)
- Where recruitment happens: [settlements.md](./settlements.md)
- What units cost: [resources.md](./resources.md)

[← Back to index](./README.md)
