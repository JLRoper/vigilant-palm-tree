# Heroes

The actors on the map. Heroes move tile-to-tile, claim [settlements](./settlements.md), lead armies, and can found new settlements via charter expeditions.

## What a hero is (v1)

- A single hero sprite on the hex map.
- A position (axial coordinate `q, r`).
- A faction (`player` or `enemy`).
- An ID, name, owner, and movement animation state.
- A personal **gold purse** (persists with the hero; captured on defeat).
- A set of **army stacks** (unit types + counts). Recruits land in the source settlement's **garrison** first; a hero pulls them onto its platoons with `TransferUnits` while standing on that settlement — see [army.md](./army.md).
- Movement points per turn (7 base, refreshed each `advanceRound`).
- A **trail** of visited hexes.
- **Chartering** state (`isChartering`, `charterId`) — see below.

## Movement

- Click a tile to plan a path. [A* pathfinding](../src/map/pathfinding.ts) computes the route.
- Path renders as a yellow line with dots on each step.
- Hero tweens between tiles at a configurable duration.
- Movement points: **7 per round**, consumed by terrain costs.
- Tile costs (see [map.md](./map.md)):
  - Grass = 1
  - Dirt = 1.2
  - Forest = 1.6
  - Water = impassable

## Chartering (✅ implemented)

A hero can found a new settlement via a **charter expedition**. See [settlements.md](./settlements.md) for costs and rules.

When chartering:
- `isChartering: true` — hero cannot be manually controlled or selected
- `charterId` links to the active `CharterState`
- **Traveling phase**: hero auto-paths toward target, one step per owner-turn
- **Constructing phase**: hero is stationary for 10 days
- Defeat at any point removes the hero, and the charter cleanup (`cleanupDefeatedHeroCharters`) cancels their charter — costs forfeited. Since the 2026-09-29 outcomes this runs for **every removed hero**, attacker or defender. A hero who **retreats or surrenders** keeps their active charter: nothing is forfeited, and auto-travel resumes from the relocated position (see [Combat](#combat)).

## Player turn

The game operates on a **round-based** cycle:
- Each player gets a `PLAYER_TURN` phase to move their heroes.
- Human player clicks to select hero, clicks map to move (A* pathfinding + terrain costs).
- Selected hero's gold/resources are shown in the hero info panel.
- Chartering heroes auto-move at turn start (no manual input).
- AI heroes move automatically during their `AI_TURN` phase via `pickAiMove` (`src/ai/aiBrain.ts`) — see [Enemy heroes](#enemy-heroes).
- After all players act, `advanceRound` runs: day increments, all heroes reset movement, settlements produce resources, morale decays, charters advance — and every 7th day the weekly upkeep applies: 1g/troop from each hero's purse plus the **garrison upkeep** (1g/troop from each settlement's treasury + 1 food/troop from its warehouse, trimming stacks from the end when short).

## Hero gold & economy

Each hero carries their own gold purse (`hero.gold`):
- Earned from combat (defeating enemies loots their gold).
- Spent on chartering (2500g cost from hero purse).
- Deposited to / withdrawn from settlement treasuries (hero must stand on matching settlement).

Settlements track gold separately in their treasury (`settlement.gold`).

## Combat

When a hero moves adjacent to an enemy hero, battle triggers:
- The Fight / Quick Resolve / Flee modal opens (see [army.md](./army.md)); garrison battles run through the same arena via the `SETTLEMENT_BATTLE` phase.
- **AI-involved battles auto-resolve** (2026-09-29): any battle whose attacker is not the local human — AI-vs-AI, or an AI attacking you — quick-resolves silently through the existing `maybeAutoResolveBattle` predicate; the result card still shows. A human attacker keeps the modal even against an AI.
- **Per-hero outcome** (2026-09-29): every battle ends in a verdict per side — `defeated` / `retreated` / `surrendered` / `stood`:

  | Verdict | How it happens | Hero on the map | Troops | Purse |
  |---|---|---|---|---|
  | **Defeated** | side wiped to zero troops (`lost_all_troops`) | **Removed** from the adventure map — state record, owner's `heroIds`, `hero_platoons` rows | gone | looted by the winner (wagon-capped, cargo included) |
  | **Retreated** | manual-arena retreat | Respawn at the nearest **owned** settlement; with none owned, stays at the cancelled position (edge D1) | **all lost** (stacks zeroed server-side — the arena's 15% pre-loss is subsumed) | kept |
  | **Surrendered** | manual-arena surrender | Teleport to the nearest **owned** settlement (same D1 edge) | kept | pays the surrender cost, rest kept |
  | **Stood** | won / survived (stalemate) | unchanged | survivors | kept |

- The auto-resolver never concedes (no retreat policies are passed server-side), so AI-involved battles only ever **remove** a loser or leave both standing — retreat/surrender are manual-arena actions.
- A defeated hero's charter is cancelled (costs forfeited); retreating/surrendering heroes keep theirs (see [Chartering](#chartering-implemented)).
- **Flee** is not an outcome: it cancels the attack before the battle starts.
- Verdicts ride the `BattleResolved` event and both command results (heroes are optional in results — absence means the hero was removed); the result card and AI toasts speak them ("slain" / "retreated to \<name\>" / "surrendered to \<name\>").
- Battle resolution persists via the `ResolveBattle` command (Quick Resolve) or `SubmitBattleResult` (played-out arena fights) on `/api/games/:name/commands`; settlement battles via `SubmitSettlementBattleResult`, whose result carries the same optional hero + verdict fields since the 2026-09-29 capture/garrison wave — `attackerHero` absent means the attacking hero was removed, and the verdict wording (card/toast) is shared with hero battles.

## Enemy heroes

Enemy heroes exist when the game was created with AI enemies — the New Game screens (home + toolbar) have an "AI enemies" chip row (0–3, default 0); `playerCount = humans + enemies` (clamped ≤ 10). AI seats spawn castles and **"Warlord"** heroes at game start. Their turns (`AI_TURN`) are driven by the primary client's tick (`turnController.tick`, local seat 0; non-primary browsers watch via sync):

- AI picks a move target via `pickAiMove` (`src/ai/aiBrain.ts`): enemy heroes within reach 7 (priority `1000 − dist·10`), then settlements within reach 8 — garrisoned ones it can beat (`GARRISON_ATTACK_RATIO = 1.5` on army **power** — per-unit attack + defence weights from the unit catalog, not raw troop counts; priority `700 − dist·5`), empty enemy-owned (`650 − dist·5`), neutral (`600 − dist·5`) — then unclaimed resources (reach 8), else wanders.
- **AI garrisons its own settlements** (2026-09-29 follow-ups, B1): at the start of each AI turn the tick submits a threat-sized garrison shopping list (`pickGarrisonRecruitment` — target power = 1.0 × nearby enemy-hero power, floor 4, gold reserve 100) through the existing `RecruitUnits` command path, so an unattended AI town holds troops instead of falling to the first walk-in.
- **Lost assaults back off** (2026-09-29 follow-ups, I1): after a non-win settlement assault the hero leaves that settlement alone for `GARRISON_BACKOFF_ROUNDS = 2` rounds (in-memory on the primary client, surviving controller rebuilds via `AiTurnMemory`).
- Walking onto an empty enemy/neutral settlement captures it (existing rule); since the 2026-09-29 capture/garrison wave, walking onto a garrisoned settlement it can beat ends the path there and starts a settlement battle (auto-resolved), while an unfavorable garrison is still refused as a step. AI walk-in captures serialize behind the move persist like the human path's.
- Post-move adjacency starts a battle — AI-involved battles auto-resolve (see [Combat](#combat)); a walk-in settlement battle resolves the same silent way via `TurnController.resolveSettlementBattle`, with the result card/toast instead of the arena.
- AI does not charter settlements in v1.
- AI heroes with `isChartering: true` are skipped in the tick loop (future-proofing).
- Known limitation: the AI actor is host-client only — if seat 0 is absent in a LAN game, AI turns stall.

## Hero death (capture-for-ransom plan superseded)

⏸️ The original plan — a hero whose army is destroyed is **captured for ransom** (fixed amount TBD, held off-map until paid, released with 1 peasant; settlements stay with the player) — was **superseded on 2026-09-29** by the shipped [outcome rules](#combat): a defeated hero is simply **removed** from the map (no capture state, no ransom). The manual arena's retreat/surrender are the escape valves instead. Hero death for non-battle causes remains out of scope.

## Future: hero stats

⏸️ **Deferred.** Will likely include:
- Attack / Defense (derived from army)
- Movement points per turn
- Hero level / XP
- Special abilities

## DB persistence (current)

Heroes are stored in the `heroes JSONB` column of the `games` table. Each hero includes all fields from `HeroState` in [`src/state/gameState.ts`](../src/state/gameState.ts).

## Cross-references

- Where heroes move: [map.md](./map.md)
- What they claim: [settlements.md](./settlements.md)
- What they see inside a settlement: [city-view-impl-plan.md](./city-view-impl-plan.md)
- What they fight with (future): [army.md](./army.md)

[← Back to index](./README.md)
