# Heroes

<!-- docs:verified 2026-10-21 -->

The actors on the map. Heroes move tile-to-tile, claim [settlements](./settlements.md), lead armies, and can found new settlements via charter expeditions.

## What a hero is (v1)

- A single hero sprite on the hex map.
- A position (axial coordinate `q, r`).
- A faction (`player` or `enemy`).
- An ID, name, owner, and movement animation state.
- A personal **gold purse** (persists with the hero; captured on defeat).
- A set of **army stacks** (unit types + counts). Recruits land in the source settlement's **garrison** first; a hero pulls them onto its platoons with `TransferUnits` while standing on that settlement — see [army.md](./army.md).
- Movement points per turn (7 base, refreshed each `advanceRound`; 0 while a retreat stun is active — see [Combat](#combat)).
- A **trail** of visited hexes.
- **Chartering** state (`isChartering`, `charterId`) — see below.

## Movement

- Click a tile to plan a path. [A* pathfinding](../src/map/pathfinding.ts) computes the route.
- Path renders as a yellow line with dots on each step.
- Hero tweens between tiles at a configurable duration.
- Movement points: **7 per round**, consumed by terrain costs. `startMove` validates the cost against `movementRemaining`; the cost of entering a tile comes from `GameMap.cost`, which folds in the river overlay layer (see [map.md](./map.md#rivers-map-gen-v5-overlay-layer)): a small river costs a full day (7 — the entire round budget), and a wide river is impassable except at a baked bridge (cost 1).
- Tile costs (see [map.md](./map.md)):
  - Grass = 1
  - Dirt = 1.2
  - Forest = 1.6
  - Water = impassable
  - Small river = 7 (full day), wide river = impassable (bridges = 1)

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
- AI heroes move automatically during `AI_TURN` via the engine brain. New games with AI enemies are server-driven; only unflagged legacy games use the primary client's tick — see [Enemy heroes](#enemy-heroes).
- After all players act, `advanceRound` runs: day increments, all heroes reset movement (retreat-stunned heroes get 0), settlements produce resources, morale decays, charters advance — and every 7th day the weekly upkeep applies: **caravan maintenance first** (`wagons × (1g + 1 food)` per trade route, `economy/caravanUpkeep.ts`), then the per-unit catalog bill for heroes (gold from the purse, food from the larder + the settlement physically under the hero — see [army.md](./army.md) → Upkeep) and garrisons (treasury + warehouse).

## Hero gold & economy

Each hero carries their own gold purse (`hero.gold`), capped by **treasury carts**: `heroGoldCap = treasuryWagons × 500` (`packages/engine/src/settlement/capacity.ts`; soft default 5 carts, migration `023_treasury_wagons.sql`). The carts are a separate slot from the army `wagons` that cap cargo at ×50 per resource — `BuyWagons`/`AssignWagons` take `slot: "cargo" | "treasury"`, and `recruitHero` allocates 5 + 5 from the player's two pools. The cap clamps all three gold landing sites (loot, capture reward, treasury withdrawal — excess stays put, nothing destroyed).

The designer's four ways gold reaches a purse:

- **Pick up at a city** — deposit/withdraw against a settlement treasury (`transferGold`, same-hex only).
- **Battle or find on the map** — defeating a hero loots their purse (wagon-capped, cargo included); capturing a settlement pays a reward, clamped to `heroGoldCap`.
- **Treasure caravans** — a trade route with payload `{ kind: "gold" }` (`wagons × 500` per load, headroom-clamped) delivers into the destination purse or treasury; see [economy.md](./economy.md) → Trade routes & caravans.
- **Hand it to another hero in the field** — `TradeHeroes` moves gold, cargo and whole platoons between two adjacent heroes of the same seat in one swap (below).

Purse gold is spent on chartering (2500g cost from hero purse). Settlements track gold separately in their treasury (`settlement.gold`).

### Feeding the army (larder & the weekly bill)

The hero info panel's food row is the hero's larder (food in its wagon cargo) and its tooltip states the cadence in the player's terms — the weekly bill, in-game days until the next charge, and weeks of larder coverage (`heroLarderTitle`, [`src/screens/shared/heroUpkeepCost.ts`](../src/screens/shared/heroUpkeepCost.ts)). The bill is charged weekly only (`day % 7 === 0`), so a larder refilled between charge days is never charged. The panel's upkeep badge — like the End Turn "unfed troops" toast — reads the persisted unpaid-streak fields and is now suppressed while the hero is currently affordable (purse + larder, plus the settlement physically under the hero); a streak stamped on an earlier charge day stops warning once the larder is restocked. The streak itself, the morale bleed and the desertion ladder are unchanged (see [army.md](./army.md) → Upkeep).

## Trading in the field (✅ implemented)

Two heroes of the **same seat** hand gold, cargo and troops to each other where they stand — no settlement, no caravan, no trip home. Heroes can never share a hex (`startMove` refuses `occupied`), so a trade is between **adjacent** heroes, and it is **all-or-nothing**: the whole offer is validated (both sides hold what they give, both have room for what they receive) before anything moves, so a refused trade writes nothing rather than moving a partial amount. That is deliberately unlike `TransferResources`' clamp-to-headroom, which has no counterparty to shortchange.

- **Command.** `TradeHeroes { heroId, partnerId, give, take }` (`packages/contracts/src/commands/tradeHeroes.ts`). Each side is a `HeroTradeOffer`: optional `gold`, optional per-resource `resources`, optional `units` (`{ unitTypeId, count }` pairs, duplicate types summed). `give` leaves `heroId`, `take` leaves `partnerId`. The server checks both heroes exist and belong to the acting seat (the generic turn guard already pinned the actor to the active player); ownership, `not_adjacent` (exactly one hex — the same six directions `detectAdjacentEnemy` walks), affordability, and capacity are the engine reducer's own gates.
- **Engine.** `tradeHeroes` in `packages/engine/src/hero/tradeHeroes.ts`. Capacity refusals name the side that failed with a `partner_` prefix — `not_enough_gold_space` / `not_enough_cargo_space` / `not_enough_unit_space` (and `partner_…` twins), against `heroGoldCap` (treasury carts × 500) and `heroResourceCap` (cargo wagons × 50 per resource). Units are removed from each side **before** the incoming ones are deposited, so a same-type swap both ways is not a false `platoon_full`. `canTradeHeroes` / `tradePartnersFor` are the read-only halves the UI gates on.
- **A hero always keeps troops.** A swap whose post-trade army would be empty on either side is refused (`would_be_left_without_troops` / `partner_would_be_left_without_troops`): an army-less hero cannot fight or defend itself. The rule is checked on the RESULT, so sending your last platoon in exchange for one back is legal, and it is unconditional — a hero that somehow holds no troops must be given some before it can hand goods over. The panel mirrors the guard: **Confirm trade** greys out and the status line names the hero that would be emptied, before you click. Unloading a hero's last troops into a settlement garrison is refused by the same rule (see [army.md](./army.md) → Recruitment), so the whole army can only ever be *moved*, never deleted.
- **Event.** `HeroesTraded` (`actor`, both hero ids, both offers) — the client's sync class is **applied**, a straight re-run of the reducer; a replay that no longer applies (a hero moved off, spent the goods, or died) falls back to the `TurnEnded` resync boundary. See [event-system.md](./event-system.md) §5.1.
- **UI.** A hero standing next to a friendly hero gets a **Trade with `<name>`…** button in its info panel. It opens the **Trade** panel (`src/screens/heroes/heroTradePanel.ts`) — the two heroes side by side with their live purse, the five cargo resources (the same bubbly pile sprites the settlement panel uses) and their 4×2 army grids (the shared `SquadGrid`). There is a second, faster way in: with one of your heroes selected, **click the hex the adjacent hero is standing on** — walking one hero into another is impossible (heroes never share a tile), so that click is the trade gesture and opens the same panel for the pair, leaving the acting hero selected. The click only trades when the two really are adjacent (the resolver asks the engine's `canTradeHeroes`, the same rule the command enforces); a hero of yours two or more hexes away is out of range, so clicking him still just switches selection. **Drag** a chip or platoon tile from one column onto the other and it is staged as THAT hero's offer; drag it back onto its own column (or press the row's `×`) to take it off the table. A staged row's `−`/`+` steps the amount (a tenth of the holding, one unit for troops) so a partial handover is `wood 250 → 25` rather than all-or-nothing at the chip level, and **Confirm trade** commits both offers as one command. Everything verbal lives in tooltips; the panel closes itself the moment the pair stops being adjacent (a hero walked off or died), because there is nothing left to trade. Pure client surface: it reads live state through `getState()` and commits through `TurnController.tradeHeroes` → `TradeHeroes` (the DOM-free model is `src/screens/heroes/heroTradeModel.ts`).

## Combat

When a hero moves adjacent to an enemy hero, battle triggers:
- The Fight / Quick Resolve / Flee modal opens (see [army.md](./army.md)); garrison battles run through the same arena via the `SETTLEMENT_BATTLE` phase.
- **Who gets the modal** (2026-10-04, `resolveBattleChoice` in `src/screens/combat/battleChoicePolicy.ts`): the local **attacker or defender** — a defending seat's modal hides **Flee** (fleeing cancels the attacker's move). A server-driven non-participant spectates; the driving client auto-resolves AI-vs-AI and remote-human PvP silently (the result card still shows). An **AI attacking you no longer auto-resolves** (amending the 2026-09-29 rule): the server's driver dispatches `EnterBattle`, the server stamps `games.lobby.pendingBattle` + appends `BattleOffered`, and you resolve from your own seat during the AI's turn (`ResolveBattle`/`SubmitBattleResult`; the turn-ownership guard exempts the battle pair). The AI driver waits ≤ 300 s (`AI_DEFENDER_WAIT_TIMEOUT_MS`), then force-resolves and audits `ai_defender_wait_expired`. The offer's `BattleOffered` delta flips your client into `BATTLE`, and the `state:committed` listener's `maybeAutoResolveBattle()` call is what opens the modal (the bridge's `replaceState` bypasses the rAF loop's change detection); the modal is deliberately non-dismissible while the choice is pending. A reload or resync mid-offer re-derives the phase from the nested `lobby.pendingBattle` marker (`src/io/hydrateClientGame.ts`), so the modal re-opens.
- **Per-hero outcome** (2026-09-29): every battle ends in a verdict per side — `defeated` / `retreated` / `surrendered` / `stood`:

  | Verdict | How it happens | Hero on the map | Troops | Purse |
  |---|---|---|---|---|
  | **Defeated** | side wiped to zero troops (`lost_all_troops`) | **Removed** from the adventure map — state record, owner's `heroIds`, `hero_platoons` rows | gone | looted by the winner (wagon-capped, cargo included) |
  | **Retreated** | hero retreat — manual arena, or the auto-resolver's `outmatched` policy (2026-10-21) | Respawn at the nearest **owned** settlement; with none owned, stays at the cancelled position (edge D1). **0 movement** for the rest of the day and **stunned** through the next day (`movementLockedThroughDay`) | only platoons on the side's **starting edge column** escape, intact; every other platoon is **left behind** and lost | kept |
  | **Surrendered** | manual-arena surrender | Teleport to the nearest **owned** settlement (same D1 edge); **0 movement** for the rest of the day, no stun | kept | pays the surrender cost, rest kept |
  | **Stood** | won / survived (stalemate) | unchanged | survivors | kept |

- **Retreat rules** (2026-10-21, [`plan/2026-10-21-battle-retreat-rules.md`](../plan/2026-10-21-battle-retreat-rules.md)): retreat opens at battle round **2** for hero battles (`HERO_BATTLE_MIN_RETREAT_ROUND`) and round **3** for settlement assaults (`SETTLEMENT_BATTLE_MIN_RETREAT_ROUND`); before that the arena's Retreat button is disabled ("Retreat opens in round N."). Only platoons standing on their side's starting edge column escape (no 15% loss); the rest are logged `left_behind` and lost. Relocation (both concessions) leaves 0 movement today; a retreat also sets `movementLockedThroughDay = day + RETREAT_MOVEMENT_LOCK_DAYS` (1), so `resetHeroMovement` grants 0 the next day and drops the field once it has passed — a defender who retreats on the enemy's turn misses their own next turn. Shared by server and settlement reducer via `applyHeroConcession` (`packages/engine/src/combat/battleOutcome.ts`); persisted in the nullable `heroes.movement_locked_through_day` column (migration 032).
- The auto-resolver (Quick Resolve, AI hero battles, AI settlement assaults) concedes under the `outmatched` retreat policy: once retreat is open, a side whose remaining total health is below `AI_RETREAT_STRENGTH_RATIO` (0.4) of the enemy's retreats its hero. Auto-resolved platoons never move, so one counts as off its edge once it has made melee contact. Surrender remains a manual-arena action.
- A defeated hero's charter is cancelled (costs forfeited); retreating/surrendering heroes keep theirs (see [Chartering](#chartering-implemented)).
- **Flee** is not an outcome: it cancels the attack before the battle starts.
- Verdicts ride the `BattleResolved` event and both command results (heroes are optional in results — absence means the hero was removed); the result card and AI toasts speak them ("slain" / "retreated to \<name\>" / "surrendered to \<name\>").
- Battle resolution persists via the `ResolveBattle` command (Quick Resolve) or `SubmitBattleResult` (played-out arena fights) on `/api/games/:name/commands`; settlement battles via `SubmitSettlementBattleResult`, whose result carries the same optional hero + verdict fields since the 2026-09-29 capture/garrison wave — `attackerHero` absent means the attacking hero was removed, and the verdict wording (card/toast) is shared with hero battles.

## Enemy heroes

Enemy heroes exist when the game was created with AI enemies — New Game supports 0–3; `playerCount = humans + enemies` (clamped to the player limit). AI seats spawn castles and **"Warlord"** heroes. New games with `enemySlots > 0` are flagged `lobby.aiDriver: "server"`; the server scanner owns their turns and the browser is a spectator. Only unflagged legacy games retain the primary-client tick:

- AI picks a move target via `pickAiMove` (`packages/engine/src/ai/aiBrain.ts`; `src/ai/aiBrain.ts` is a compatibility re-export): reachable enemies, beatable garrisons, empty settlements, and resources are prioritized before wandering.
- **AI garrisons its own settlements** (2026-09-29 follow-ups, B1): at the start of each AI turn the tick submits a threat-sized garrison shopping list (`pickGarrisonRecruitment` — target power = 1.0 × nearby enemy-hero power, floor 4, gold reserve 100) through the existing `RecruitUnits` command path, so an unattended AI town holds troops instead of falling to the first walk-in.
- **Lost assaults back off** (2026-09-29 follow-ups, I1): after a non-win settlement assault the hero leaves that settlement alone for `GARRISON_BACKOFF_ROUNDS = 2` rounds (in-memory on the primary client, surviving controller rebuilds via `AiTurnMemory`).
- Walking onto an empty enemy/neutral settlement captures it (existing rule); since the 2026-09-29 capture/garrison wave, walking onto a garrisoned settlement it can beat ends the path there and starts a settlement battle (auto-resolved), while an unfavorable garrison is still refused as a step. AI walk-in captures serialize behind the move persist like the human path's.
- Post-move adjacency starts a battle — AI-vs-AI auto-resolves; a battle against **you** is now *offered* to you instead (`EnterBattle` → `BattleOffered`, see [Combat](#combat)); a walk-in settlement battle still resolves the same silent way via `TurnController.resolveSettlementBattle`, with the result card/toast instead of the arena. While an offer is pending the driver's pass sits in `waiting_for_defender` (no `EndTurn`), force-resolving after the 300 s wait deadline.
- **AI chartering is live (B3).** The server brain uses `pickCharterAction` to start charters with the ordinary purse/warehouse requirements and advances charter travel through the same engine commands; construction completes on the normal round/day boundary. A chartering AI hero is not treated as a manual move target.
- At the start of eligible turns the driver also recruits threatened AI garrisons and accepts up to three recommended trade routes per round/seat. Phase 3 heartbeat/watchdog and pool hardening, per-boot token ownership, and per-game advisory locks are live; see [multiplayer.md](./multiplayer.md).
- Known stall limitation applies only to unflagged legacy games still using the browser-driven AI tick. Newly created games with AI enemies are server-driven; client-origin AI-seat commands are rejected by the server.
- **Settlers mode: the AI seat is a covered wagon, and it founds instead of charting** (SETTLERS-PLAN.md §4 W5). A settlers seat owns no castle and no commander — the start pass gives every seat, human or AI, one covered wagon whose identity is its id (`p<seat>-wagon`, `isCoveredWagonId`) — so the AI's whole job in the mode is founding. Four consequences:
  - The decision is the engine's: `pickSettlersWagonAction` (`packages/engine/src/ai/aiBrain.ts`) founds where the wagon stands the moment `canFoundSettlement` admits it (no rng draw), and otherwise takes one step toward the nearest hex the same predicate would admit. The AI can therefore never found where a human's button could not, and no mode tunable is restated in the AI path — the numbers come from `gameModeSettings(mode)`.
  - The command is the human one: the server driver dispatches `FoundSettlement`, the same command the client's button sends, through the same handler case; the engine renames the wagon into the seat's hero (`p<seat>-hero`) and hands its cargo to the new town.
  - **A wagon has no army**, so the AI never gives it an army-only order: `pickAiMove` offers a wagon no enemy hero, garrison, settlement or resource target (its only target is the hex it would found on, and settlement hexes are path obstacles for it), and the driver's wagon branch bypasses the walk-in gates, the adjacency battle, the charter travel and every capture. A wagon is never recruited into and never fights a battle.
  - **After it founds, the entity is a HERO, not a wagon**, so it leaves the wagon branch and takes the ordinary hero path — with `troops: 0` that means it targets nothing it cannot beat and, in practice, wanders; an undefended rival town is the one thing it can walk onto and capture, which is the ordinary hero rule rather than a settlers one. This is the consequence of `wagonBecomesFirstHero` being the mode's answer: the seat keeps a mobile entity after founding instead of being left with none.
  - **In a classic game nothing changes at all**: `pickCharterAction` is mode-gated (settlers does not charter), and every wagon branch is gated on `mode === "settlers"` or `isCoveredWagonId(heroId)`, so a classic seat charters, captures, fights and moves exactly as before — pinned byte-for-byte by `test/server/aiDriver.test.ts` and the `npm run test:aiCharter` regression.

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
