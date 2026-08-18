# Heroes JS — Docs

Game design and architecture documentation for the Heroes of Might & Magic-inspired hex adventure game. This is the index. Every doc lives in this folder and links back here.

## Status legend

- ✅ **Locked** — decision made, won't revisit
- 🟡 **Open question** — needs an answer before implementation
- 📋 **Planned (not started)** — scope agreed, implementation pending
- ⏸️ **Deferred** — explicitly postponed to a later milestone

## Game vision (one paragraph)

A turn-based hex adventure map where the player moves a hero, claims resource tiles by building settlements on them, and defends them against enemy heroes that wander the map. Resources accumulate per turn and fund growth. New settlements are founded via charter expeditions (hero travels to target and constructs for 10 days). Deeper systems (full army roster, tactical battlefield, fog of war, capture-for-ransom) are layered on later milestones without re-architecting the base.

## The design docs

| Doc | Covers | Status |
|-----|--------|--------|
| [resources.md](./resources.md) | 5 resource types, tile distribution, yields | ✅ Locked |
| [settlements.md](./settlements.md) | Build cost, charter expeditions, settlement limits, capture, levels | ✅ Locked |
| [city-view-impl-plan.md](./city-view-impl-plan.md) | 10×10 settlement interior, mines, per-resource yield | 📋 Planned |
| [heroes.md](./heroes.md) | Hero movement, chartering, capture-for-ransom | ✅ Locked (movement) / 🟡 Charter implemented / ⏸️ Ransom deferred |
| [army.md](./army.md) | Unit roster, recruitment, food/upkeep, tactical combat | ⏸️ Deferred |
| [economy.md](./economy.md) | Per-turn economy flow tying resources + settlements | ✅ Locked |
| [map.md](./map.md) | Map generation, terrain, camera, fog of war (future) | ✅ Locked |

## Code & architecture

| Doc | Covers | Status |
|-----|--------|--------|
| [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) | Module-by-module dependency map for `src/`, `server/`, `shared/`, `test/`, `tools/`, `scripts/` | 📋 Planned |
| [architecture.md](./architecture.md) | Executed layout plan that established the current `src/` structure | ✅ Locked |
| [battle-view-architecture.md](./battle-view-architecture.md) | Battle view surface: trigger → state → UI → server resolver; auto-resolve vs. Test-Battle paths, arena UI, invariants | ✅ Current |
| [dev-console.md](./dev-console.md) | `src/debug/` event log + modal/footer console for inspecting bus + hook events in real time | 🟡 Open question |
| [network-map.md](./network-map.md) | Dev overlay showing live client↔API routing topology (RTT, poll-failure rate, throughput); what each metric really measures and why three of four are proxies | ✅ Current |
| [event-system.md](./event-system.md) | Planned `core/eventBus` refactor and event catalog (Phases 1–6) | 📋 Planned |
| [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) | **Multiplayer (LAN):** lobby seat claim + `lobby` jsonb column (§3), 2s polling sync (§5.9), lobby UI (§5.12), local seat identity (§5.16) | 🟡 Built, no design doc |
| [../plan/](../plan/) | Architecture plans: walkthrough + Tailscale, bloat/scalability review, module expansion plan, modal viewport overflow, fight-screen redesign, combat reveal / fog of war | 📋 Planned |


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
3. **Map fog of war** — deferred entirely; resource tiles stay always-visible for now.
4. **AI chartering** — deferred; only human player can charter settlements currently.
5. **Multiplayer has no design doc** — the LAN lobby + polling sync are built and are described mechanically in the module map, but the *design* (how many players, turn-timeout policy, what happens when a seat drops mid-game, whether AI fills empty seats) was never written down.
6. **`src/factions/` is staged but unwired** — `FactionUnit` roster data for the humans exists at `src/factions/humans/` and nothing imports it. The live unit data still comes from the server catalog (`data/unitCatalog.ts`) and `state/units.ts`. Decide whether factions becomes the source of truth or the directory gets dropped.
7. **Combat reveal / fog of war in battle** — the Spy action and its `scoutedBy`/`markContacted` fog were removed as half-baked; the parked idea is written up in [../plan/2026-08-15-combat-reveal-fog-of-war.md](../plan/2026-08-15-combat-reveal-fog-of-war.md).

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
- **Resources always visible** — no fog of war hiding them
- **Yield timing:** resources tick per round (all players act, then advanceRound)
- **Schema anticipates 3 levels** but only Level 1 ships in v1 for player-founded settlements
- **City view:** double-click settlement → city grid → build mines on resource spots
- **Combat (current / in progress):** the server runs the **temporary default auto-resolver** at [`packages/engine/src/combat/resolveBattle.ts`](../packages/engine/src/combat/resolveBattle.ts) via the `ResolveBattle` command on `POST /api/games/:name/commands` when heroes collide on the adventure map. The **tactical (manual) resolver** at [`packages/engine/src/combat/manualBattle.ts`](../packages/engine/src/combat/manualBattle.ts) + [`src/screens/combat/manualBattleArena.ts`](../src/screens/combat/manualBattleArena.ts) is the target and is **in progress** — engine + dev Test Battle arena shipped, adventure-map trigger wiring pending. See [`docs/army.md`](./army.md).
- **Recruitment (future):** instant at friendly settlement
- **Hero death (future):** captured for ransom
- **Unit cap (future):** base 10 + 1 per owned settlement
- **No food in v1** — returns with army system, where every human unit costs 1 food/day
