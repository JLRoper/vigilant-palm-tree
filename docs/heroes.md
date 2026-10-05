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
- After all players act, `advanceRound` runs: day increments, all heroes reset movement, settlements produce resources, morale decays, charters advance — and every 7th day the weekly upkeep applies: **caravan maintenance first** (`wagons × (1g + 1 food)` per trade route, `economy/caravanUpkeep.ts`), then the per-unit catalog bill for heroes (gold from the purse, food from the larder + the settlement physically under the hero — see [army.md](./army.md) → Upkeep) and garrisons (treasury + warehouse).

## Hero gold & economy

Each hero carries their own gold purse (`hero.gold`), capped by **treasury carts**: `heroGoldCap = treasuryWagons × 500` (`packages/engine/src/settlement/capacity.ts`; soft default 5 carts, migration `023_treasury_wagons.sql`). The carts are a separate slot from the army `wagons` that cap cargo at ×50 per resource — `BuyWagons`/`AssignWagons` take `slot: "cargo" | "treasury"`, and `recruitHero` allocates 5 + 5 from the player's two pools. The cap clamps all three gold landing sites (loot, capture reward, treasury withdrawal — excess stays put, nothing destroyed).

The designer's three ways gold reaches a purse:

- **Pick up at a city** — deposit/withdraw against a settlement treasury (`transferGold`, same-hex only).
- **Battle or find on the map** — defeating a hero loots their purse (wagon-capped, cargo included); capturing a settlement pays a reward, clamped to `heroGoldCap`.
- **Treasure caravans** — a trade route with payload `{ kind: "gold" }` (`wagons × 500` per load, headroom-clamped) delivers into the destination purse or treasury; see [economy.md](./economy.md) → Trade routes & caravans.

Purse gold is spent on chartering (2500g cost from hero purse). Settlements track gold separately in their treasury (`settlement.gold`).

## Combat

When a hero moves adjacent to an enemy hero, battle triggers:
- The Fight / Quick Resolve / Flee modal opens (see [army.md](./army.md)); garrison battles run through the same arena via the `SETTLEMENT_BATTLE` phase.
- **Who gets the modal** (2026-10-04, `resolveBattleChoice` in `src/screens/combat/battleChoicePolicy.ts`): the local **attacker or defender** — a defending seat's modal hides **Flee** (fleeing cancels the attacker's move). A server-driven non-participant spectates; the driving client auto-resolves AI-vs-AI and remote-human PvP silently (the result card still shows). An **AI attacking you no longer auto-resolves** (amending the 2026-09-29 rule): the server's driver dispatches `EnterBattle`, the server stamps `games.lobby.pendingBattle` + appends `BattleOffered`, and you resolve from your own seat during the AI's turn (`ResolveBattle`/`SubmitBattleResult`; the turn-ownership guard exempts the battle pair). The AI driver waits ≤ 300 s (`AI_DEFENDER_WAIT_TIMEOUT_MS`), then force-resolves and audits `ai_defender_wait_expired`. The offer's `BattleOffered` delta flips your client into `BATTLE`, and the `state:committed` listener's `maybeAutoResolveBattle()` call is what opens the modal (the bridge's `replaceState` bypasses the rAF loop's change detection); the modal is deliberately non-dismissible while the choice is pending. A reload or resync mid-offer re-derives the phase from the nested `lobby.pendingBattle` marker (`src/io/hydrateClientGame.ts`), so the modal re-opens.
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

Enemy heroes exist when the game was created with AI enemies — the New Game screens (home + toolbar) have an "AI enemies" chip row (0–3, default 0); `playerCount = humans + enemies` (clamped ≤ 10). AI seats spawn castles and **"Warlord"** heroes at game start. Their turns (`AI_TURN`) are driven by the primary client's tick (`turnController.tick`, local seat 0; non-primary browsers watch via sync) on browser-driven games — **since 2026-09-30 (B2), any game created with `enemySlots > 0` is flagged `lobby.aiDriver: "server"` and the server's scanner drives its AI seats end-to-end instead** (seat 0's browser is a spectator; the known stall below is closed there):

- AI picks a move target via `pickAiMove` (`src/ai/aiBrain.ts`): enemy heroes within reach 7 (priority `1000 − dist·10`), then settlements within reach 8 — garrisoned ones it can beat (`GARRISON_ATTACK_RATIO = 1.5` on army **power** — per-unit attack + defence weights from the unit catalog, not raw troop counts; priority `700 − dist·5`), empty enemy-owned (`650 − dist·5`), neutral (`600 − dist·5`) — then unclaimed resources (reach 8), else wanders.
- **AI garrisons its own settlements** (2026-09-29 follow-ups, B1): at the start of each AI turn the tick submits a threat-sized garrison shopping list (`pickGarrisonRecruitment` — target power = 1.0 × nearby enemy-hero power, floor 4, gold reserve 100) through the existing `RecruitUnits` command path, so an unattended AI town holds troops instead of falling to the first walk-in.
- **Lost assaults back off** (2026-09-29 follow-ups, I1): after a non-win settlement assault the hero leaves that settlement alone for `GARRISON_BACKOFF_ROUNDS = 2` rounds (in-memory on the primary client, surviving controller rebuilds via `AiTurnMemory`).
- Walking onto an empty enemy/neutral settlement captures it (existing rule); since the 2026-09-29 capture/garrison wave, walking onto a garrisoned settlement it can beat ends the path there and starts a settlement battle (auto-resolved), while an unfavorable garrison is still refused as a step. AI walk-in captures serialize behind the move persist like the human path's.
- Post-move adjacency starts a battle — AI-vs-AI auto-resolves; a battle against **you** is now *offered* to you instead (`EnterBattle` → `BattleOffered`, see [Combat](#combat)); a walk-in settlement battle still resolves the same silent way via `TurnController.resolveSettlementBattle`, with the result card/toast instead of the arena. While an offer is pending the driver's pass sits in `waiting_for_defender` (no `EndTurn`), force-resolving after the 300 s wait deadline.
- AI does not charter settlements in v1.
- AI heroes with `isChartering: true` are skipped in the tick loop (future-proofing).
- Known limitation: the AI actor is host-client only — if seat 0 is absent in a LAN game, AI turns stall. **Closed 2026-09-30 (B2) for flagged games** (`lobby.aiDriver: "server"`, persisted whenever a game is created with `enemySlots > 0`): the server's scanner drives those turns, client-origin AI-seat commands are rejected `403 ai_seat_command_forbidden`, and only unflagged games keep the stall.

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
