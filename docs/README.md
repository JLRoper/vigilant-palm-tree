# Heroes JS — Docs

Game design and architecture documentation for the Heroes of Might & Magic-inspired hex adventure game. This is the index. Every doc lives in this folder and links back here.

## Status legend

- ✅ **Locked** — decision made, won't revisit
- 🟡 **Open question** — needs an answer before implementation
- 📋 **Planned (not started)** — scope agreed, implementation pending
- ⏸️ **Deferred** — explicitly postponed to a later milestone

## Game vision (one paragraph)

A turn-based hex adventure map where the player moves a hero, claims resource tiles by building settlements on them, and defends them against enemy heroes that wander the map. Resources accumulate per turn and fund growth. New settlements are founded via charter expeditions (hero travels to target and constructs for 10 days). Deeper systems (full army roster, tactical battlefield, capture-for-ransom) are layered on later milestones without re-architecting the base.

## The design docs

| Doc | Covers | Status |
|-----|--------|--------|
| [resources.md](./resources.md) | 5 resource types, tile distribution, yields | ✅ Locked |
| [settlements.md](./settlements.md) | Build cost, charter expeditions, settlement limits, capture, levels | ✅ Locked |
| [city-view-impl-plan.md](./city-view-impl-plan.md) | Tiered (5×5/10×10/15×15) isometric settlement interior, mines, per-resource yield | ✅ Shipped (buildings + mines live; mine upgrades above Level 1 not in UI) |
| [heroes.md](./heroes.md) | Hero movement, chartering, capture-for-ransom | ✅ Locked (movement) / 🟡 Charter implemented / ⏸️ Ransom deferred |
| [army.md](./army.md) | Unit roster, recruitment, food/upkeep, tactical combat | ⏸️ Deferred |
| [economy.md](./economy.md) | Per-turn economy flow tying resources + settlements | ✅ Locked |
| [resource-gathering.md](./resource-gathering.md) | As-built resource collection & building economy: pools, rate computation, per-turn pipeline, all sinks, wired-vs-dormant building effects, findings F1–F10; plus the shipped producer-mine & deterministic cell-multiplier design | ✅ Current |
| [wagons-stockpiles-trade-routes-plan.md](./wagons-stockpiles-trade-routes-plan.md) | Design: stockpile caps (settlements by warehouse buildings, heroes by wagons), hero cargo, player wagon pool, distance-throttled trade routes; formulas, open questions, phased implementation | 📝 Proposed |
| [map.md](./map.md) | Map generation, terrain, camera, fog of war (shipped) | ✅ Locked |
| [map-gen.md](./map-gen.md) | Procedural terrain generation: current blob-growth algorithm (`gameMap.ts`) + ranked alternatives | ✅ Current |
| [art-style.md](./art-style.md) | Sprite art direction: alchemical rune-stone resource icons, procedural castles/heroes; composition + palette rules | ✅ Current |
| [ui-top-panel-plan.md](./ui-top-panel-plan.md) | Global top bar (turn/wealth/economy summary) + selection-driven contextual detail panels | 📋 Planned |
| [morale-fatigue-plan.md](./morale-fatigue-plan.md) | Real morale/fatigue combat stats on the manual battle engine (`Combatant.morale`/`fatigue`, `morale_change` log entries) | ✅ Shipped (2026-09-27; tunables flagged for owner tuning) |
| [spellcasting-plan.md](./spellcasting-plan.md) | Real hero spellcasting behind the arena's disabled Cast Spell stub, same `CombatEffect` seams | ✅ Shipped (2026-09-27; persistent HeroState mana, Int = pool / Arcane = power, AI casting v1.1, mana-only limiter — see the as-built section) |
| [terrain-plan.md](./terrain-plan.md) | Battle-grid terrain: per-hex combat bonus / movement cost (greenfield — no terrain concept in code today) | 📋 Planned |

## Code & architecture

| Doc | Covers | Status |
|-----|--------|--------|
| [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) | Module-by-module dependency map for `src/`, `server/`, `shared/`, `test/`, `tools/`, `scripts/` | 📋 Planned |
| [architecture.md](./architecture.md) | Executed layout plan that established the current `src/` structure | ✅ Locked |
| [auth-model.md](./auth-model.md) | Magic-link auth (`server/auth.ts`) + per-game seat middleware (`attachPlayerSeat`); sign-in optional everywhere | ✅ Current |
| [battle-view-architecture.md](./battle-view-architecture.md) | Battle view surface: trigger → state → UI → server resolver; auto-resolve vs. Test-Battle paths, arena UI, invariants | ✅ Current |
| [CombatResolutionEngine-TechnicalDesign.md](./CombatResolutionEngine-TechnicalDesign.md) | As-built auto-resolver behind the `ResolveBattle` command: 8-slot platoons, type advantages, counterattacks, retreat policies | 🟡 In progress |
| [dev-console.md](./dev-console.md) | `src/debug/` event log + modal/footer console for inspecting bus + hook events in real time | ✅ Current |
| [pr-13-dev-console.md](./pr-13-dev-console.md) | PR record (merged) for the dev console: ring-buffer event log + pin/persist; float follow-up reverted pre-merge | ✅ Current |
| [network-map.md](./network-map.md) | Dev overlay showing live client↔API routing topology (RTT, poll-failure rate, throughput); what each metric really measures and why three of four are proxies | ✅ Current |
| [event-system.md](./event-system.md) | Planned `core/eventBus` refactor and event catalog (Phases 1–6) | 🟡 Partially shipped — typed bus + full `GameEvent` catalog live (2026-09-27); Phase-2+ listener migration still planned |
| [multiplayer.md](./multiplayer.md) | LAN multiplayer design: lobby/seat identity, event-cursor sync (SSE push + 2s poll backstop, 2026-09-28), and session policy — no turn timer in v1, shipped drop policy (60s disconnect detection, grace-then-skip with server auto-EndTurn), email rejoin reclaim, no AI seats | ✅ Current |
| [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) | **Multiplayer (LAN):** lobby seat claim + `lobby` jsonb column (§3), SSE push + 2s poll backstop sync (§5.9), lobby UI (§5.12), local seat identity (§5.16) | 🟡 Built, no design doc |
| [../.kilo/plan/](../.kilo/plan/) | Architecture plans: walkthrough + Tailscale, bloat/scalability review, module expansion plan, modal viewport overflow, fight-screen redesign, combat reveal / fog of war | 📋 Planned |


## How to read these

Read top-to-bottom if you're new. The dependency order is:

```
map.md → resources.md → settlements.md → city-view.md
                            ↓                  ↓
                        economy.md ←-----------┘
                            ↓
                       heroes.md → army.md
```

`map.md` defines the world. `resources.md` defines what's in it. `settlements.md` defines how the player claims them (both initial castles and charter-founded settlements). `city-view.md` defines what happens inside them. `economy.md` defines the per-turn loop. `heroes.md` and `army.md` cover the actors.

## Open questions across all docs

All major questions resolved. Remaining minor ones:

1. **Ransom amount** — TBD when [army system](./army.md) ships.
2. **City view mine upgrades** — schema supports Level 1–3, UI ships Level 1 only.
3. **Map fog of war** — resolved, shipped: heroes reveal a 4-hex vision ring and castles reveal by control range (`src/render/fog.ts`); unexplored tiles render under fog, and resource tiles appear only inside a vision ring.
4. **AI chartering** — deferred; only human player can charter settlements currently.
5. **Multiplayer design doc** — ~~never written down~~ now exists and matches the build: [multiplayer.md](./multiplayer.md) records the mechanics plus the 2026-09-27 policy decisions (no turn timer in v1; dropped seats get ~60s disconnect detection + ~2min active-turn grace, then the server auto-EndTurns — shipped 2026-09-27; no AI seats).
6. **~~`src/factions/` is staged but unwired~~** — resolved 2026-09-27: the directory was **deleted** (zero imports, overlapped the DB `unit_types` seed — the repo's "unwired parallel implementation" lesson). The live unit data remains the server catalog (`data/unitCatalog.ts`) and `state/units.ts`. If multi-faction rosters ship later, the concept should be resurrected in `packages/engine` + DB seed, not as client-side staged data.
7. **Combat reveal / fog of war in battle** — the Spy action and its `scoutedBy`/`markContacted` fog were removed as half-baked; the parked idea is written up in [../.kilo/plan/2026-08-15-combat-reveal-fog-of-war.md](../.kilo/plan/2026-08-15-combat-reveal-fog-of-war.md).

## Locked decisions (quick reference)

Full details in the individual docs, but the big ones:

- **5 resources:** Gold, Wood, Stone, Iron Ore, Arcane Dust
- **Settlements:** initial castles at game start + charter-founded settlements via hero expeditions
- **Charter cost:** 2500g (hero purse) + 20 wood + 15 stone (from provisioning settlement warehouse)
- **Charter process:** hero auto-paths to target hex, then constructs for 10 days; defeat at any point forfeits all costs
- **Charter limits:** no cap on number of settlements; min 4 hexes from any existing settlement; any passable terrain
- **Initial castles:** pre-placed at game start (2–5, depending on config)
- **Settlement capture:** enemy walking on settlement flips ownership (no destruction in v1)
- **Settlement destruction:** none in v1 — only capture changes ownership
- **Resources revealed by vision** — fog of war is live; resource tiles show once a hero/castle vision ring covers their hex
- **Yield timing:** resources tick per round (all players act, then advanceRound)
- **Schema anticipates 3 levels** but only Level 1 ships in v1 for player-founded settlements
- **City view:** double-click settlement → city grid → build mines on resource spots
- **Combat (current / in progress):** hero collisions on the adventure map run the **temporary default auto-resolver** at [`packages/engine/src/combat/resolveBattle.ts`](../packages/engine/src/combat/resolveBattle.ts): collision → BATTLE phase → `GameActions.maybeAutoResolveBattle()` → battle modal → `ResolveBattle` command on `POST /api/games/:name/commands`. The **tactical (manual) resolver** at [`packages/engine/src/combat/manualBattle.ts`](../packages/engine/src/combat/manualBattle.ts) + [`src/screens/combat/manualBattleArena.ts`](../src/screens/combat/manualBattleArena.ts) is the target; engine + dev Test Battle arena shipped, and wiring the manual arena in as the collision outcome is pending (the arena is dev-only today). See [`docs/army.md`](./army.md).
- **Recruitment (future):** instant at friendly settlement
- **Hero death (future):** captured for ransom
- **Unit cap (future):** base 10 + 1 per owned settlement
- **No food in v1** — returns with army system, where every human unit costs 1 food/day
- **Multiplayer (LAN) policy:** no turn timer in v1; a dropped seat gets ~60s disconnect detection + ~2min active-turn grace, then the server auto-EndTurns (shipped 2026-09-27, `server/app/dropPolicy.ts`); no AI seats — unclaimed seats stay empty. See [multiplayer.md](./multiplayer.md).
