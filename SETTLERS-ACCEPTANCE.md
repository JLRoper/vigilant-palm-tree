# Settlers Mode — Acceptance Spec

<!-- docs:verified 2026-10-24 -->

> **Status.** This is an acceptance spec: the user-visible flow the Settlers-mode
> implementation must produce, followed by the numbered cases that prove it.
> Every claim about *today's* behaviour was read from the file named beside it:
> `src/screens/home/newGameScreen.ts` and `src/screens/shared/newGameModal.ts`
> (the two New Game surfaces), `src/managers/GameSessionManager.ts` (the create
> path), `src/io/api.ts` + `server/routes.ts` (`POST /games` and the `lobby`
> flag pattern), `packages/engine/src/init.ts` (starting state),
> `packages/engine/src/charter/{requirements,start}.ts` (the placement rule and
> price), `packages/engine/src/reveal.ts` (fog), `packages/engine/src/ai/aiBrain.ts`
> (the AI charter planner), `server/app/aiDriver.ts` (the server-side AI actor),
> and `tools/run-test.mjs` (suite registration). Anything the code leaves open is
> called out with **Flag:** inline.

---

## 1. The flow the implementation must produce

### 1.1 The New Game window

Settlers mode is a per-game option chosen at creation, on both surfaces that can
create a game:

- **Create-Game screen** — the landing page's `New Game` button opens it
  (`src/screens/home/newGameScreen.ts`, reached from `homeView.openNewGameModal`).
- **Toolbar New-Game modal** — the in-game `New Game` action opens
  `src/screens/shared/newGameModal.ts`.

Each surface gains one new field row, `Settlers mode`, holding a checkbox that
defaults **off**, with the hint `Start with a wagon in the wilderness and found
your first settlement`. While it is checked the surface reveals the settlers
knobs below and forces two of the existing controls:

| Knob | Control | Default | Mirrors |
|---|---|---|---|
| Founding supplies — gold | number | **2500** | `CHARTER_GOLD_COST` |
| Founding supplies — wood | number | **20** | `CHARTER_WAREHOUSE_COST.wood` |
| Founding supplies — stone | number | **15** | `CHARTER_WAREHOUSE_COST.stone` |
| Wagon movement per turn | number | **7** | `MOVEMENT_PER_TURN` |
| Founding reach (hexes) | number | **8** | `CHARTER_TARGET_REACH` |
| Wagons per seat | *(no control this slice — always 1)* | 1 | — |

- `Uncharted mode` is forced **checked and disabled** while Settlers mode is on
  (hint: `Settlers mode always starts uncharted`), and returns to the user's own
  value when the checkbox is cleared.
- On the toolbar modal, `Castle seed` and `Castle count` are hidden (or disabled)
  while Settlers mode is on: a settlers game places no castles.
- `Game name`, `Your faction`, `Map size`, `Number of human players`,
  `Number of AI enemies` and `Map seed` are unchanged, and `Number of AI enemies`
  may be **0** (a solitaire settlers game is legal).
- Submitting posts the existing body plus `settlers: true` and
  `settlersOptions: { supplies: { gold, wood, stone }, movementPerTurn, reach }`.
  With the checkbox off, neither key is sent and the request is byte-identical to
  today's.
- **Flag:** the create path picks `hero_q` / `hero_r` / `enemy_positions` by
  generating castles *client-side* (`GameSessionManager.handleNewGame`); a
  settlers game must skip that generation rather than post coordinates for
  castles that will not exist.

### 1.2 Wagon spawn on bare wilderness

- A settlers game is created with **no castles, no settlements and no heroes for
  any seat**. The map itself (terrain, resources, rivers) is generated exactly as
  today.
- Every seat — human and AI — gets exactly **one wagon**, placed on a bare
  wilderness hex:
  - passable land (never `water` or `mountain`), inside the map interior (the
    edge buffer castle placement already respects),
  - **no resource tile**, no settlement, no other unit,
  - at least 3 hexes from every other seat's wagon,
  - deterministic for the same `seed` + `mapSize` + seat count.
- The wagon carries the seat's founding kit (gold/wood/stone from the knobs
  above), has a per-round movement allowance (default 7) refilled by the same
  round/day reset pass that refills heroes, and is the seat's **only** mobile
  unit.
- Settlers games are always uncharted, and the seat's initial reveal is the
  wagon's vision ring (`HERO_VISION_RANGE`, 4) and nothing else.
- **Flag:** today the only mobile map entity is a hero (`state.heroes`,
  `MoveHero`, `turnController`, vision rings, `aiBrain`). The implementation may
  add a wagon record (`state.wagons`) or represent the wagon as a hero-shaped
  record with a wagon sprite and no horse. The observables in §2 are the
  contract; the storage shape is not. Movement is named `MoveWagon` below, and
  may instead ride the existing `MoveHero` kind accepting a wagon id, provided
  the observables are unchanged.

### 1.3 Wagon movement and fog reveal

- Clicking the wagon's hex selects it (the seat has exactly one movable unit, so
  selection is unambiguous); hovering an in-range destination draws the same path
  preview a hero gets; a real click moves it.
- Each step costs the map's terrain cost, drawn from the wagon's remaining
  allowance; a destination beyond the allowance is clamped to the reachable
  prefix, exactly as hero movement clamps today. `water`/`mountain` are never
  entered.
- Moving reveals fog: the destination's vision ring **and the corridor of every
  hex walked** merge into that seat's `players[N].revealedTiles`
  (the uncharted-mode pipeline), server-side, on the move command.
- The reveal and the wagon's position survive a reload: hydrating the games row
  restores both.
- **Flag:** whether a wagon pays terrain cost with the same modifiers heroes do
  (roads, rivers, bridges) is not decided by this spec; the default allowance is
  7 either way.

### 1.4 The found-settlement action

- With the wagon selected, the adventure hero-panel action slot shows
  **`Found Settlement`** (`data-found-settlement="true"`). It is enabled only
  while the wagon can actually found; when it cannot, it is disabled and carries
  the reason list (`data-found-missing="supplies-gold,reach"` etc.), mirroring how
  the charter gate reports `missing`.
- Clicking it enters founding placement mode; the map highlights the legal
  founding hexes. Clicking a **legal** hex opens the founding modal
  (`Found Settlement at (q, r)`, cost line, editable settlement name,
  `data-found-confirm`); confirming sends the found command. Clicking an illegal
  hex exits placement mode with a rejection, exactly as charter placement
  rejects (`charter_invalid` precedent).
- **Placement rule** (the target hex must satisfy all of):
  - within map bounds and passable,
  - free of any settlement, hero, wagon, or active charter target,
  - at least `CHARTER_MIN_SETTLEMENT_DISTANCE` (**4**) hexes from every existing
    settlement,
  - within the wagon's **founding reach** (default 8, hex distance) of the
    wagon's current hex.
- **What it consumes:** the **wagon itself** and its carried founding kit
  (default **2500g + 20 wood + 15 stone** — the charter price). A shortfall or an
  illegal hex refuses the action: the client keeps the panel disabled with the
  missing rows, and the server answers the forced command with a 409 and a
  reason.
- **What it produces:** a **level-1 settlement** at the target hex owned by the
  acting seat, named from the modal, seeded with the same standard starter set a
  starting level-1 settlement gets. The wagon is removed from the map, and the
  seat's reveal re-seeds from the new settlement's control range.
- One founding per wagon; a seat that has spent its wagon cannot found again in
  this slice. Afterwards the settlement is a normal settlement: the city view
  opens on it, it produces resources on the daily/weekly ticks, and the upgrade
  paths are available.
- **Flag:** founding is **immediate** here, whereas chartering runs a
  `CHARTER_CONSTRUCTION_DAYS` (10) `constructing` phase with an `activeCharters`
  row. The spec picks immediate (the wagon *is* the construction crew); parity
  with charter would instead mean a travelling phase.
- **Flag:** what the founding seat gets as its mobile/army unit after the wagon
  is spent (nothing this slice, a starter hero spawned in the new settlement, or
  the standard starter platoons in the new settlement's `stacks` garrison) is not
  decided by the code and is left to the implementation.

### 1.5 AI founding

- Every AI seat spawns its own wagon on the same terms as the human seat, and is
  driven by the existing server-side AI actor (`lobby.aiDriver = "server"` plus
  the boot token) — the actor that already plays AI heroes.
- On its turn the AI wagon walks toward the best legal founding hex and founds as
  soon as one is within reach and the kit is paid. "Best" is the ranking the AI
  already uses for chartering: highest chartered-city production rate sum, then
  nearest, then lowest `(q, r)` — and the legal set is the **same** evaluator the
  human's placement overlay uses, so the AI is held to exactly the human's rule.
- The AI never founds on an illegal hex, never founds twice, and consumes the
  same price.
- Deterministic: the same seed and seat layout produce the same AI founding hex
  on the same round. No wall-clock or `Math.random` in the planner.
- Observable: after that seat's turn, the settlement exists in the games row
  owned by the AI seat, and its wagon is gone.

### 1.6 What stays untouched

With the checkbox off, nothing in this flow is observable: `POST /games` carries
no new keys, the games row carries no `settlers`/`wagons` key, castles and
settlements seed exactly as they do today, and `Uncharted mode` keeps its current
independent default (on). No change to the lobby protocol beyond the flag, to
chartering, to trade, or to the AI actor's existing hero playbook.

---

## 2. Acceptance cases

Test surfaces are fixed by this spec so the cases can be written before the
implementation:

| Surface | Path / name | Registration |
|---|---|---|
| Engine unit | `test/engine/settlersMode.test.ts` | none needed — `npm run test:unit` globs `test/engine/*.test.ts` |
| Server command | `test/server/settlersModeRoute.test.ts` | none needed — the same glob covers `test/server/*.test.ts` |
| Playwright e2e | `test/settlersMode.e2e.ts`, entry name `settlers` | `tools/run-test.mjs` `ENTRIES.settlers`, plus `settlers` in `ALL_ORDER` before `visual`, plus the usage string |
| Game row | `GET /api/games/:name` | new `wagons` jsonb on the games row; `lobby.settlers` boolean |
| Client state | `__gameDebug.getState().wagons` | record keyed by wagon id |
| Debug accessors | `__gameDebug.getWagons()`, `.wagonFoundHexes(id?)`, `.getFoundState()`, `.foundSettlement(wagonId, q, r, name?)` | `src/io/debugCommands.ts`, alongside `getHeroes()`/`getSettlements()`/`lastClick` |
| DOM hooks | `data-settlers-mode`, `data-settlers-knob="gold\|wood\|stone\|movement\|reach"`, `data-found-settlement`, `data-found-missing`, `data-found-confirm` | new; the map itself is one canvas, so *map* observables are asserted through `__gameDebug`, never through DOM |

### 2.1 Engine unit — `test/engine/settlersMode.test.ts`

- **E1 — spawn placement.** With `settlers: true`, the seat count equals the
  wagon count, every wagon stands on a passable non-resource hex with no
  settlement/unit under it, and no two wagons are closer than 3 hexes.
  *Observable:* the wagon records built by the init path.
  *Hook:* the builders' return value / `__gameDebug.getWagons()` shape, asserted
  directly in-process.
- **E2 — determinism and back-compat.** The same `(seed, mapSize, seatCount)`
  produces identical wagon positions twice; a call without `settlers` produces
  the current castles + settlements + heroes result byte-for-byte.
  *Observable:* deep equality of two state builds, and absence of any `wagons`
  key.
  *Hook:* engine return value.
- **E3 — knob defaults.** Omitting `settlersOptions` yields supplies
  2500/20/15, `movementPerTurn` 7 and reach 8; junk values (negative, fractional,
  non-numeric) fall back to those defaults rather than throwing.
  *Observable:* the resolved option values on the built state.
  *Hook:* engine return value.
- **E4 — movement budget and passability.** A wagon move spends terrain cost from
  `movementRemaining`, clamps at the reachable prefix when the destination is too
  far, refuses a `water`/`mountain` destination, and returns to the full
  allowance on the next round reset.
  *Observable:* `movementRemaining`, `q`/`r`, `trail` and the refusal reason.
  *Hook:* the movement reducer's result.
- **E5 — legal founding hexes.** The legal set excludes out-of-bounds and
  impassable hexes, every hex carrying a settlement/hero/wagon/charter target,
  everything within `CHARTER_MIN_SETTLEMENT_DISTANCE - 1` hexes of an existing
  settlement, and everything beyond the founding reach of the wagon.
  *Observable:* the key set.
  *Hook:* `__gameDebug.wagonFoundHexes()` (engine `validFoundHexes`).
- **E6 — founding reducer.** A legal founding consumes the wagon and exactly the
  kit (2500g/20 wood/15 stone leave with it), creates a level-1 settlement at the
  target owned by the seat with the standard starter set, and refuses a second
  founding from the same wagon, a hex failing E5, and a wagon whose kit is short —
  each with a distinct reason.
  *Observable:* `state.settlements`, `state.wagons`, the kit deltas, the refusal
  reason strings.
  *Hook:* the reducer's result / `__gameDebug.getState()`.
- **E7 — reveal.** The creation-time reveal of a settlers game is exactly the
  wagon ring (4) for each human seat, and a wagon move merges the destination ring
  plus a trail-only corridor hex more than 4 from both endpoints.
  *Observable:* `players[N].revealedTiles` keys, sorted by `(q, r)`.
  *Hook:* engine reveal helpers / `__gameDebug.getState().players`.
- **E8 — AI parity and determinism.** The AI founding planner returns the same
  best-hex ranking a human sees (production sum, then distance, then `(q, r)`),
  returns `null` when no legal hex is in reach or the kit is short, and returns
  the identical choice across two runs on the same seeded state.
  *Observable:* the planned `(q, r)` / `null`, and the planner's legal set equal
  to E5's.
  *Hook:* planner return value.

### 2.2 Server command — `test/server/settlersModeRoute.test.ts`

Over real Express + real Postgres, the harness pattern of `createGameRoute.test.ts`
/ `commandsRoute.test.ts` / `unchartedReveal.test.ts`.

- **S1 — create writes the flag and the wagons.** `POST /games` with
  `settlers: true` returns 201 with `lobby.settlers === true`,
  `lobby.uncharted === true`, zero settlements, zero heroes and one `wagons` entry
  per seat, each on a passable non-resource hex.
  *Observable:* the 201 body and the row re-read from the database.
  *Hook:* `GET /api/games/:name` → `lobby.settlers`, `wagons`, `settlements`,
  `heroes`.
- **S2 — absent and junk stay today's game.** A create without `settlers`, and a
  create with `settlers: "yes"`, both return `lobby.settlers === false`, no
  `wagons` key and the normal castles/settlements/heroes; `lobby.uncharted` keeps
  its own independent value.
  *Observable:* the created row's keys, byte-compared against the current shape.
  *Hook:* `GET /api/games/:name` → the same fields as `createGameRoute.test.ts`
  asserts today (`t("legacy path ...")`, `t("... uncharted = false unless the
  body opts in")`).
- **S3 — founder pays the price.** `POST /api/games/:name/commands
  {"kind":"FoundSettlement", actor, wagonId, targetQ, targetR, settlementName}`
  returns 200, and the row then shows the new level-1 settlement owned by the
  actor at that hex, the wagon gone, and the kit deducted.
  *Observable:* the response status and the persisted row.
  *Hook:* `GET /api/games/:name` → `settlements`, `wagons`.
- **S4 — refusals are 4xx and touch nothing.** An illegal target (within 3 hexes
  of a settlement, on an occupied hex, impassable, or out of reach), a short kit,
  and a wagon belonging to another seat all fail — the first two with 409 and a
  reason, the foreign wagon with the route's actor-mismatch refusal — and the row
  is unchanged afterwards.
  *Observable:* status codes, error bodies, an unchanged row.
  *Hook:* the commands route response; `parseCommand`'s branch in
  `server/http/routes/commands.ts` must exist or every request 400s
  (the `UpgradeBuilding` regression this suite family exists to catch).
- **S5 — a wagon move merges the reveal.** With `lobby.settlers` (hence
  uncharted) true, a wagon move merges the destination ring and a trail-only
  corridor hex into `players[0].revealedTiles`, sorted; the same move in a
  non-settlers game adds no key.
  *Observable:* the persisted reveal keys, before and after.
  *Hook:* `GET /api/games/:name` → `players[0].revealedTiles`.
- **S6 — the server AI founds.** In a settlers game with one AI enemy, driving the
  turns through the server actor leaves the AI seat owning a settlement and no
  wagon, while the human seat's wagon is untouched.
  *Observable:* ownership of settlements per seat, wagon roster per seat.
  *Hook:* the row via `GET /api/games/:name` after the AI actor's turns
  (`test/server/aiDriver.test.ts`'s drive pattern).

### 2.3 Playwright e2e — `test/settlersMode.e2e.ts`

Real browser, real API, real DB, and **real gestures**: the UI is driven by clicks
and typing (the `unchartedMode.e2e.ts` New-Game flow), and the map — one canvas —
is driven by `__gameDebug.screenFor(q, r)` + `page.mouse.move`/`click`
(`heroTrade.e2e.ts`'s `clickHex`). The game is created and deleted by exact name,
never by a table sweep.

- **P1 — the New Game window.** From the landing page, click `New Game`, check the
  `Settlers mode` row with a real click, type a small kit into the knob inputs,
  fill the name, click `Create Game`; the API then reports `lobby.settlers`,
  `lobby.uncharted` and one wagon per seat, and the game opens in the browser.
  *Observable:* the created row's flags and wagon roster.
  *Hook:* `data-settlers-mode` (checked), `data-settlers-knob="gold|wood|stone"`,
  then `GET /api/games/:name` → `lobby`, `wagons`.
- **P2 — the wagon starts on bare wilderness, in the dark.** The map opens with
  the wagon visible, no settlements and no heroes for any seat, and a
  `countBlackPixels` probe over `#game` shows a large opaque-black unrevealed
  region while a non-settlers control game of the same seed shows almost none
  (the `unchartedMode.e2e.ts` [C] thresholds).
  *Observable:* wagon position/roster, settlement count, pure-black pixel count
  for the settlers game vs. the control.
  *Hook:* `__gameDebug.getWagons()` / `.getSettlements()`, then
  `document.getElementById("game").getContext("2d").getImageData`.
- **P3 — real mouse movement reveals fog, and it persists.** With the wagon
  selected, a real click on a destination hex (hover first, then click) moves it;
  the row then shows the wagon at the destination and `players[0].revealedTiles`
  containing the destination plus a tile more than 4 hexes from both endpoints;
  after a full reload the client's hydrated reveal and the wagon position are
  unchanged.
  *Observable:* server-side wagon position and reveal keys; the same keys in
  `__gameDebug.getState()` after reload.
  *Hook:* the click helper built on `__gameDebug.screenFor`,
  `GET /api/games/:name`, `__gameDebug.getWagons()`.
- **P4 — found settlement, by real gestures.** Click the wagon, click
  `[data-found-settlement]`, confirm that the legal-hex highlight is non-empty,
  click a legal hex, then click `[data-found-confirm]`; a level-1 settlement now
  exists at that hex owned by the seat, the wagon is gone, and the last click was
  recorded as the founding.
  *Observable:* settlement ownership/position/level, wagon gone, click reason.
  *Hook:* `[data-found-settlement]`, `[data-found-confirm]`,
  `__gameDebug.wagonFoundHexes()`, `__gameDebug.getSettlements()`,
  `__gameDebug.lastClick.reason === "settlement_founded"`.
- **P5 — refusals are visible and harmless.** With the kit knob typed below the
  price, the action button is disabled and reports the missing entries
  (`[data-found-missing]` naming the supplies); with a full kit, a real click on
  an illegal hex leaves placement mode with the invalid reason and creates no
  settlement.
  *Observable:* the disabled button plus its missing list, the click reason, an
  unchanged settlement count.
  *Hook:* `[data-found-settlement][disabled]`, `[data-found-missing]`,
  `__gameDebug.lastClick.reason === "found_invalid"`, `GET /api/games/:name` →
  `settlements`.
- **P6 — the AI founds end-to-end.** In a settlers game with one AI enemy, drive
  the turns (`__gameDebug.endTurn()`, or the End Turn control) until the AI seat
  owns a settlement, within a bounded wait; assert the AI wagon is gone and the
  human wagon untouched.
  *Observable:* settlement ownership per seat and wagon roster per seat.
  *Hook:* `__gameDebug.getSettlements()` / `.getWagons()` and the DB row.
- **P7 — the control game is untouched.** A game created through the same window
  with the checkbox left alone has castles, settlements and heroes, no `wagons`
  key, no `lobby.settlers` key, and no forced darkness.
  *Observable:* the row's shape and the pure-black pixel count.
  *Hook:* `GET /api/games/:name`, `__gameDebug.getSettlements()`, the
  `countBlackPixels` probe.
