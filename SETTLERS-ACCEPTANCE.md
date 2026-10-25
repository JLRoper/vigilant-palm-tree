# Settlers Mode — Acceptance Spec

<!-- docs:verified 2026-10-25 -->

> **Status: AS-BUILT, reconciled.** This file was first written as a *forward*
> spec, before settlers mode existed (commit `90005b5`, off `f1dff81`). The mode
> has since landed on `main` (PR #262, `5da73ed`, version 0.34.0), and the
> shipped contract differs from that draft in eleven material ways — §3 lists
> every one of them. What follows is the *acceptance record of what shipped*:
> the user-visible flow, then the numbered cases that prove it, each naming the
> suite that asserts it, the observable, and the hook a test reads.
>
> Every claim below was read from the file named beside it, and every case in §2
> was **run on `main` at `5da73ed` on 2026-10-25** — 63 tests, all green (§2.0).
> Vocabulary that is not in the code is not in this file: `settlers: true`,
> `settlersOptions`, `state.wagons`, a `wagons` jsonb, `getWagons()`,
> `wagonFoundHexes()`, `data-settlers-mode`, `data-found-settlement` and a
> founding modal with an editable name **do not exist**; §3 says what does.

Sources: `packages/contracts/src/gameMode.ts` (the mode union, the settings keys,
the wagon id convention), `packages/engine/src/settlers/startPlacement.ts`,
`packages/engine/src/settlers/found.ts` and `packages/engine/src/settlers/supplies.ts`
(placement, the founding rule, the cargo), `packages/engine/src/init.ts` (the mode
gate in the entity-seeding pass), `packages/engine/src/ai/aiBrain.ts` and
`server/app/aiDriver.ts` (the AI seat), `server/routes.ts` (`POST /games`),
`server/http/routes/commands.ts` and `server/app/commandHandler.ts` (the command),
`src/state/settings.ts`, `src/io/gameModes.ts`, `src/io/api.ts`,
`src/io/commands.ts`, `src/io/hydrateClientGame.ts`,
`src/screens/home/newGameScreen.ts`, `src/screens/shared/newGameModal.ts`,
`src/screens/adventure/clickIntent.ts`, `src/managers/GameEngine.ts`,
`src/state/turnController.ts`, `src/io/debugCommands.ts`, and `SETTLERS-PLAN.md`
(the plan the slices built against).

---

## 1. The flow that shipped

### 1.1 Choosing the mode — the New Game window

Both creation surfaces carry one **`Game mode`** field row, holding a two-chip
row driven by the same option list (`src/state/settings.ts`'s
`gameModeOptions()` and `gameModeHint()`), so the two surfaces cannot drift:

- **Create-Game screen** — `src/screens/home/newGameScreen.ts`, the landing
  page's `New Game` button.
- **Toolbar New-Game modal** — `src/screens/shared/newGameModal.ts`, the
  in-game `New Game` action.

| Chip | `data-mode` | Label | Hint (the chip's `title`) |
|---|---|---|---|
| classic | `classic` | `Classic (charter founding)` | the `gameModeHint("classic")` sentence |
| settlers | `settlers` | `Settlers (wagon founding)` | the `gameModeHint("settlers")` sentence |

- The initial pick is the **stored** `gameMode` key (`DEFAULT_GAME_MODE` is
  `"classic"`, and the settings store migrated to schema v3 exactly once, so a
  store written before the key existed follows along rather than resetting a
  later deliberate choice). Neither surface writes the store: a mode picked for
  one game is a property of that game, not a preference.
- There are **no per-game settlers knobs**. Supplies, spacing, consumption and
  the free-buildings answer are the mode's constants
  (`SETTLERS_MODE_DEFAULTS` in `packages/contracts/src/gameMode.ts`), and the
  test layer asserts against those constants so a second literal anywhere is a
  bug:

  | Key | Value | Means |
  |---|---|---|
  | `wagonConsumedOnFounding` | `true` | the wagon is spent by the town it founds |
  | `minFoundingDistance` | `3` | axial `hexDistance` from **every** settlement, neutrals included |
  | `wagonSupplies` | `200 wood, 100 stone, 50 iron, 0 arcane, 50 food` | the wagon's cargo |
  | `freeStarterBuildings` | `false` | no free city for founding |
  | `neutralCastles` | `true` | neutrals still spawn in the wilderness |
  | `monsterLairs` | `true` | read by no rule yet (no lair generator exists) |

- `Uncharted mode` stays its **own independent** control (default: on, both
  surfaces). The mode does not force it, disable it, or read it:
  `server/routes.ts` writes `uncharted: uncharted === true` from the body.
- The create call carries the picked mode (`src/io/api.ts`'s `createGame(...,
  gameMode)`), and the server resolves it: absent reads as classic, while a
  value that is **present but not a known mode** is a `400` —
  `` gameMode must be one of classic, settlers `` — so a typo is never silently a
  classic game.
- The mode rides the **existing** lobby jsonb (`games.lobby.gameMode`, the
  `uncharted` / `legacyAutoTrade` precedent). No column, no migration, and the
  client reads it back through `src/io/gameModes.ts`'s per-game registry
  (`gameModeFor`, `isSettlersGame`), fed on load.

### 1.2 The wagon start — bare wilderness

- A settlers game seeds **no castles, no settlements and no heroes for any
  seat**: `packages/engine/src/init.ts`'s entity pass takes the mode gate and
  calls `placeSettlersStarts` instead of `makeCastles` → `makeSettlements` →
  `makeHeroes`. Terrain, rivers and resource tiles are generated exactly as
  today (`MapGenVersion` untouched).
- Each seat — human and AI — gets **one covered wagon**: a `HeroState` in
  `state.heroes` whose id is `coveredWagonIdFor(seat)` = `p<seat>-wagon`. The
  wagon record (not a column) is how it survives a reload: `games.heroes` and
  the granular heroes table already carry it, and `players[id].heroIds` names
  it. It carries `wagonSupplies` as its cargo and has no army.
- Placement is deterministic from `(mapSeed, seat)` alone, on its **own** RNG
  stream `settlers:<mapSeed>:p<seat>-wagon` (`settlers/startPlacement.ts`), one
  draw per seat (the scan offset), so adding a seat never moves a placed one and
  no existing seed's names, horse variants or city spots move:
  - candidates: passable, not a river tile, not a resource deposit, inside the
    map's `EDGE_BUFFER` frame;
  - at least `minFoundingDistance` (3) from every other start **and** from every
    settlement already on the board (the wilderness neutrals included);
  - a pass that finds no legal hex **throws** rather than returning a short list
    or a plausible duplicate.
- Neutral castles keep spawning (`neutralCastles: true`), so the wilderness is
  not left empty of objectives.
- The seat's initial reveal under uncharted is the wagon's own vision ring, by
  the unmodified hero pipeline (the wagon is a hero).

### 1.3 Movement and fog

- Movement and vision are the **hero rules, unchanged**: the wagon is a
  `HeroState`, so terrain cost, the movement allowance, the round/day reset pass
  that refills it, the path preview and the vision ring (`HERO_VISION_RANGE`)
  are code that already existed. Clicking the wagon's hex selects it; a click on
  a reachable hex moves it, clamped to the reachable prefix exactly as a hero is.
- Under uncharted, a move merges the walked corridor and the destination's ring
  into `players[N].revealedTiles` on the server, by the same reveal pipeline
  heroes use.

### 1.4 Founding

- The settle button is **one slot, two modes** (`src/managers/GameEngine.ts`):
  in a settlers game it reads `⛺ Found Settlement` and arms the founding
  gesture; in a classic game it keeps `Charter Settlement` and opens the charter
  requirements modal. Which copy applies comes from the per-game registry, never
  a build flag.
- Arming the gesture asks the **engine's own predicate** for the hex set
  (`foundSettlementTarget` → `canFoundSettlement`): the legal set is the
  **founder's own hex**, or empty. A wagon plants its town where it stands —
  highlighting more would lie about the gesture, since the rule refuses every
  other hex. With no wagon selected (or one that is not the local seat's), arming
  shows the refusal's own sentence instead.
- Clicking the highlighted hex sends `{ kind: "FoundSettlement", founderId, q, r }`
  (`src/io/commands.ts`); clicking anywhere else while the gesture is armed is
  refused as `found_invalid` and the gesture stays armed.
- **The rule** (`canFoundSettlement`, `packages/engine/src/settlers/found.ts`),
  checked in this order, in one vocabulary shared by engine, server and client
  (`FOUND_SETTLEMENT_REFUSALS`):

  | Refusal | When |
  |---|---|
  | `not_settlers_mode` | the game is classic; founding goes through chartering |
  | `founder_not_at_tile` | the founder (or no such founder) is not standing on the target hex |
  | `occupied` | a settlement already stands there |
  | `tile_impassable` | water/mountain, a river tile, or a resource deposit |
  | `too_close_to_settlement` | within `minFoundingDistance` (3) of **any** settlement, neutral castles included |

- **What it consumes:** the wagon itself (`wagonConsumedOnFounding`) — removed
  from `state.heroes`, from `players[id].heroIds`, and from any charter it held —
  and its **cargo at the moment of founding** (`carriedSupplies`), which becomes
  the new town's warehouse. The wagon's gold moves into the settlement's
  treasury rather than vanishing. There is no gold price and no kit constant read
  at founding time: a wagon that spent or traded its stock founds a poorer town,
  which is the point of the supplies being cargo.
- **What it produces:** a level-1 settlement at the target hex owned by the
  acting seat: id `s<nextSettlementId>` (the charter allocation rule), name and
  city spots derived from the founder's own streams
  (`settlers:<castleSeed>:<founderId>:*`), terrain-derived rates from the map,
  `buildings: []` (no free starter city — `freeStarterBuildings: false`), and
  the same starting fields a seeded town gets. Nothing is taken from a client
  payload, so two foundings by the same wagon reproduce identical content.
- Founding is **immediate** (the wagon is the construction crew): no
  `constructing` phase, no `activeCharters` row. The event is
  `SettlementFounded`.
- Under uncharted, the founding seat's reveal is refreshed for the new town's
  control range.
- Refusals: the server's own authority checks (`no_hero`,
  `forbidden_not_your_hero`) answer first, then the engine's refusal vocabulary
  is relayed **verbatim** as a `409` whose `error` is the code; a malformed
  payload (non-string `founderId`, non-integer `q`/`r`) is a `400` from
  `parseCommand` before any handler runs.
- The seat has **no mobile unit afterwards** — the wagon is spent and no hero
  spawns. The town is then an ordinary settlement: city view, daily/weekly
  production, upgrade paths.

### 1.5 The AI seat

- In settlers mode the server actor (`server/app/aiDriver.ts`, gated on
  `resolveGameMode` plus `isCoveredWagonId`) drives each AI wagon, and it issues
  the **same** `FoundSettlement` command a human's gesture sends.
- The decision is the engine brain's (`pickSettlersWagonAction` and
  `pickFoundingHex` in `packages/engine/src/ai/aiBrain.ts`), and every hex it
  considers is asked about through `canFoundSettlement` — the predicate the
  human's highlight uses — so the AI can never found where a human could not:
  - found on the hex it stands on when the rule admits it (no RNG draw, so a
    founding never moves a stream);
  - otherwise one step toward the nearest legal hex within a search radius of 12,
    probing the nearest 16 candidates with `findPath` so "nearest legal" cannot
    mean "unreachable", ties broken by hex distance then record order `(q, r)`;
  - otherwise the same deterministic wander step every hero's empty target list
    falls back to. A wagon is never given an army-only action.
- The charter planner returns `null` in settlers mode: the mode founds, it does
  not charter.

### 1.6 What stays untouched

- With the mode absent or `classic`, nothing above is observable: the entity
  seeding pass is byte-for-byte today's (pinned by test), no wagon exists,
  `POST /games` carries no new key, and the games row grows no new column — only
  the `lobby.gameMode` bag already in use.
- No `MapGenVersion` is added and no generation pass changes; no migration runs;
  chartering, trade and the AI actor's hero playbook are unchanged.

---

## 2. Acceptance cases

### 2.0 The surfaces, and how they were run

| Surface | File | Registration |
|---|---|---|
| Engine unit | `test/engine/settlersMode.test.ts` | `npm run test:unit` (globs `test/engine/*.test.ts`) |
| Server, creation | `test/server/settlersGameModeRoute.test.ts` | the same glob (`test/server/*.test.ts`) |
| Server, command | `test/server/foundSettlement.test.ts` | the same glob |
| Client mode plumbing | `test/io/gameModes.test.ts`, `test/state/settings.test.ts` | the same glob |
| Mode chips (both surfaces) | `test/screens/home/newGameModeChoice.test.ts`, `test/screens/shared/newGameModeChoice.test.ts` | the same glob (`test/screens/**/*.test.ts`) |
| Playwright e2e | `test/settlers.e2e.ts`, entry `settlers` | `tools/run-test.mjs`'s `ENTRIES.settlers`, in `ALL_ORDER` before `visual`, in the usage string; `npm run test:settlers` |
| Game row | `GET /api/games/:name`, `GET /api/games/:name/tiles` | `lobby.gameMode`; `heroes` (the wagon); `players[].heroIds`; `settlements` |
| Event stream | `game_events` | `kind = 'SettlementFounded'` |
| Client state | `__gameDebug.getState()`, `.getHeroes()`, `.getSettlements()`, `.screenFor(q, r)`, `.lastClick`, `.endTurn()`, `.setSelectedHero(id)`, `.requestMove(id, q, r)`, `.activeGameName` | `src/io/debugCommands.ts` — the wagon appears in `.getHeroes()` as id `p<seat>-wagon`; there is **no** `getWagons()` |
| DOM hooks | `button[data-mode="classic"]` / `button[data-mode="settlers"]` on both new-game surfaces, and the settle button's label/title text | the map is one canvas, so map observables are asserted through `__gameDebug`, never through DOM |

Run on `main` at `5da73ed`, 2026-10-25, with Postgres up on `127.0.0.1:5432`
(`.env.test`'s `game_poc`), from `C:/ProjectDevelopment/heroes-js`:

```
node node_modules/tsx/dist/cli.mjs --test test/engine/settlersMode.test.ts
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 \
  test/server/settlersGameModeRoute.test.ts test/server/foundSettlement.test.ts
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 \
  test/io/gameModes.test.ts test/state/settings.test.ts \
  test/screens/home/newGameModeChoice.test.ts test/screens/shared/newGameModeChoice.test.ts
```

Result: **23 engine tests, 6 server tests, 34 client/plumbing tests — 63 pass, 0
fail.** `test/settlers.e2e.ts` (the browser layer) was **not** run in this pass;
§4 says so plainly. (`node_modules/.bin` is missing in the primary checkout, so
the commands name tsx's CLI entry directly rather than going through `npx`.)

### 2.1 Engine unit — `test/engine/settlersMode.test.ts` (23 tests)

- **E1 — existing seeds are pinned.** The generated grid and the seeded entities
  of an existing `(seed, size)` are byte-identical, so the mode added no draw to
  any existing stream. *Observable:* the two digests. *Tests:* "the generated
  grid of an existing seed is byte-identical", "the seeded entities of an
  existing seed are byte-identical".
- **E2 — the mode resolves safely.** An absent or unreadable mode reads as
  classic; hydration carries the mode, and a row without one stays a classic
  state key-for-key. *Tests:* "an absent or unreadable mode reads as classic",
  "hydration carries the mode, and a row without one stays a classic state
  key-for-key".
- **E3 — neutrals survive.** Neutral castles still spawn in the wilderness.
  *Observable:* the generated `PlacedCastle[]`. *Test:* "neutral castles still
  spawn in the wilderness (design answer 4)".
- **E4 — the settlers stream is its own.** Keyed
  `mulberry32(hashString("settlers:<seed>:<id>"))`, per-entity and per-seed,
  replaying identically, and not the map's or the castle seed's stream.
  *Tests:* the three "the settlers stream …" tests.
- **E5 — spawn placement.** A settlers game seeds bare wilderness: no seat owns a
  town and the neutrals remain; one covered wagon per seat carrying the starter
  supplies; every start on bare, spaced, reproducible terrain.
  *Observable:* `state.settlements`, `state.heroes` (ids `p<seat>-wagon`), and
  `placeSettlersStarts`' result. *Tests:* "a settlers game seeds bare
  wilderness…", "a settlers game seeds one covered wagon per seat…", "a settlers
  start is bare terrain, spaced apart, and reproducible from (mapSeed, seat)".
- **E6 — one refusal vocabulary.** `FOUND_SETTLEMENT_REFUSALS` is a single pinned
  list. *Test:* "the founding refusal vocabulary is one pinned list".
- **E7 — the rule refuses correctly.** A classic game refuses to found at all,
  and founding is refused off the founder's own hex, on occupied, impassable and
  too-close hexes. *Observable:* the returned refusal code. *Tests:* "a classic
  game refuses to found: founding is the settlers path", "founding is refused off
  the founder's own hex, on occupied, impassable and too-close hexes".
- **E8 — founding.** A legal founding consumes the wagon and plants the
  settlement holding its cargo; the rule reads the mode's keys; the content is
  derived from the founder's own streams rather than a payload. *Observable:*
  `state.settlements`, `state.heroes`, `players[].heroIds`, the returned
  `consumedFounder` and `suppliesGranted`. *Tests:* "founding consumes the wagon
  and plants the settlement holding its supplies", "the founding rule reads the
  mode's keys: consumption and supplies", "a founded settlement's content is
  derived from the founder's own streams, not from a payload".
- **E9 — every key flips its behaviour.** The key set is exactly the pinned list
  on both modes; flipping `minFoundingDistance` flips founding **and** start
  spacing, `wagonSupplies` flips the cargo and the founded warehouse,
  `freeStarterBuildings` hands the town the starter city, `neutralCastles` empties
  the wilderness while leaving classic alone, and `monsterLairs` is read by no
  rule yet. *Tests:* the six "flipping …" and "the key set is exactly the pinned
  list" tests. This is the layer that makes §1.1's constant table a contract
  rather than a comment.

### 2.2 Server — `settlersGameModeRoute.test.ts` (3) and `foundSettlement.test.ts` (3)

Real Express and real Postgres, the `createGameRoute.test.ts` harness shape.

- **S1 — create stores the mode.** `POST /games` with `gameMode: "settlers"`
  stores it and seeds bare wilderness with one wagon per seat. *Observable:* the
  201 body and the row re-read from the DB. *Test:* "POST /games with gameMode
  settlers stores the mode and seeds bare wilderness with one wagon per seat".
- **S2 — absent stays today's game.** `POST /games` without a `gameMode` creates
  a classic game with seat castles. *Test:* "POST /games without a gameMode still
  creates a classic game with seat castles".
- **S3 — junk is refused.** A `gameMode` that is not a known mode is rejected.
  *Observable:* the status and error body. *Test:* "POST /games rejects a
  gameMode that is not a known mode".
- **S4 — the founder pays.** `FoundSettlement` plants the settlement with the
  wagon's supplies and consumes the wagon. *Observable:* the response and the
  persisted row (`settlements`, `heroes`). *Test:* "FoundSettlement plants the
  settlement with the wagon's supplies and consumes the wagon".
- **S5 — mode and authority are refused.** A classic game, a foreign founder and
  an unknown founder are all refused — `not_settlers_mode`,
  `forbidden_not_your_hero` and `no_hero` respectively. *Test:* "FoundSettlement
  refuses a classic game, a foreign founder and an unknown one".
- **S6 — the engine's spacing refusal is relayed.** A founding inside a
  settlement's dead zone comes back as the engine's own code. *Test:*
  "FoundSettlement relays the engine's spacing refusal inside a settlement's dead
  zone".

### 2.3 Client and plumbing (34 tests)

- **C1 — the mode registry.** `src/io/gameModes.ts` maps a game name to its mode,
  resolves unknown names to classic, and answers `isSettlersGame`.
  *Suite:* `test/io/gameModes.test.ts`.
- **C2 — the stored default.** The new-game mode default is classic, unknown
  values normalize to it, a patch round-trips and writes the bumped schema
  version, and a store written before the key existed follows along **exactly
  once**. *Suite:* `test/state/settings.test.ts`.
- **C3 — both surfaces offer the same modes.** A stored settlers default
  preselects the settlers chip, a stored classic default preselects classic,
  picking a mode moves the active chip and reaches the create handler, the
  default pick is handed to the create handler unanswered, and each chip carries
  its own hint as a tooltip. *Suites:*
  `test/screens/home/newGameModeChoice.test.ts`,
  `test/screens/shared/newGameModeChoice.test.ts`.

### 2.4 Playwright e2e — `test/settlers.e2e.ts` (entry `settlers`)

Real browser, real API, real DB, and real gestures: the wagon is selected by
clicking its own hex, the gesture is armed by clicking the toolbar button, and
the settlement is planted by clicking that hex again — nothing dispatches a
synthetic event. Games are created and deleted by exact name, never a sweep.

- **(A) creation** — `POST /games {gameMode: "settlers"}` stores the mode and
  seeds bare wilderness with one wagon per seat.
- **(B) the toolbar tells the truth** — the settle button reads `Found Settlement`
  and arms the gesture instead of the classic charter flow.
- **(C) a refused click** — a click on a hex the gesture does not cover is
  refused with the engine's own `found_invalid`, and the gesture stays armed.
  *Hook:* `__gameDebug.lastClick.reason`.
- **(D) the founding** — a click on the wagon's own hex founds the settlement:
  the client state and the DB row both carry the town, the wagon is consumed
  (including its granular heroes row and the `p0-wagon` entry in
  `players[].heroIds`), the mode's supplies are its warehouse, and a
  `SettlementFounded` event exists. *Hooks:* `__gameDebug.getState()`,
  `.getSettlements()`, `game_events`, the DB row.
- **(E) the classic control** — the same button reads `Charter Settlement` and
  opens the charter requirements modal; no founding gesture exists in a classic
  game. *Observable:* the button's label and behaviour.

---

## 3. Reconciliation — the draft's claims vs. what shipped

The first commit of this file specified a contract the implementation then
answered differently: `SETTLERS-PLAN.md` §3's design questions were settled as
the constants in §1.1, not as form knobs. Every divergence, so a reader of the
old text is not misled:

1. **No mode checkbox with knobs.** The draft's `Settlers mode` checkbox plus
   gold/wood/stone/movement/reach inputs became a two-chip `Game mode` row, with
   every tunable a `SETTLERS_MODE_DEFAULTS` constant. There is no
   `settlersOptions` in the request body and no per-game override.
2. **The founding kit is not `2500g + 20 wood + 15 stone`.** The wagon carries
   `200 wood / 100 stone / 50 iron / 0 arcane / 50 food`, and what the new town
   receives is the founder's **cargo at that moment**, not a constant; there is
   no gold price at all.
3. **Uncharted is not forced.** The draft forced the checkbox checked and
   disabled for settlers; shipped keeps it the player's own independent control
   (default on both surfaces), and the server writes what the body said.
4. **There is no founding reach.** The draft's `reach: 8` does not exist: the
   founder must be standing on the hex, the client's gesture highlights only the
   founder's own hex, and the AI searches a 12-hex radius for a hex to walk to.
5. **The spacing is 3, not 4**, measured with `hexDistance` against **every**
   settlement (neutral castles included) — and the same key spaces the starts.
6. **No founding modal and no name prompt.** The engine derives the settlement's
   name, id and city spots from the founder's own streams; the gesture is a
   single click on the highlighted hex, and there is no `data-found-confirm`.
7. **The draft's DOM hooks do not exist**: `data-settlers-mode`,
   `data-settlers-knob`, `data-found-settlement`, `data-found-missing`. Shipped:
   `button[data-mode="…"]` on both surfaces, and the settle button's label/title.
8. **The draft's debug accessors do not exist**: `getWagons()`,
   `wagonFoundHexes()`, `getFoundState()`, `foundSettlement()`. Shipped: the
   wagon is read through `__gameDebug.getHeroes()` (or `.getState().heroes`) as
   `p<seat>-wagon`, and the gesture's refusal through `.lastClick.reason`.
9. **No `wagons` jsonb.** The draft's new column became a `HeroState` in the
   existing `games.heroes` (an id convention instead of a per-entity flag), which
   is what keeps the mode migration-free.
10. **The planned test files were renamed or folded**:
    `test/server/settlersModeRoute.test.ts` is now
    `settlersGameModeRoute.test.ts` plus `foundSettlement.test.ts`; the planned
    `test/engine/settlersStartPlacement.test.ts` and `settlersFounding.test.ts`
    were folded into `settlersMode.test.ts`; the e2e is `test/settlers.e2e.ts`
    under entry `settlers` with `npm run test:settlers`.
11. **The AI ranking is not production-rate-based.** The draft ranked by
    chartered-city production sum, then distance, then `(q, r)`; shipped ranks
    the legal hexes by **reachable distance**, then `(q, r)`, probing with
    `findPath` — and the founding choice itself consumes no RNG draw (the wander
    fallback does, from the driver's seeded memory).

Flags the draft raised, and how they resolved:

- *"the create path picks `hero_q` / `hero_r` / `enemy_positions` client-side"* —
  it still does (`src/managers/GameSessionManager.ts` generates castles and posts
  those coordinates, mode or not). The server ignores them for a settlers game,
  because `init.ts`'s gate places wagons instead; the redundancy is harmless but
  real, and it is the one piece of the draft's flag left standing.
- *"founding is immediate, unlike a 10-day charter"* — immediate shipped, with
  `SettlementFounded` as the event.
- *"what the founding seat gets afterwards"* — nothing mobile: the wagon is
  spent, no hero spawns, and the town starts with no free buildings
  (`freeStarterBuildings: false`); the city view's own free starter commit on
  first open is the only grant.
- *"whether a wagon pays terrain cost with the same modifiers heroes do"* — yes,
  identically: the wagon **is** a hero record on the unmodified movement path.

Still open (not settled by any shipped surface):

- The engine's founding rule has **no wagon-only gate**: a recruited hero
  standing on a legal hex would be admitted by `canFoundSettlement`. The shipped
  client offers founding only for a selected covered wagon
  (`GameEngine.selectedWagonId`) and the AI only for `isCoveredWagonId` ids, so
  no surface can reach the hero case today.
- `monsterLairs` is read by nothing (no lair generator exists).
- Wagon-specific markers/art and the mode's balance pass are outside these
  suites; this spec asserts nothing about them.

---

## 4. What was not verified in this pass

- `test/settlers.e2e.ts` was **not** run: it needs a browser plus the dev client
  and the API on their allocated ports. Its cases (§2.4) are the suite's own,
  read from the file, not from a run.
- The suites above ran against the primary checkout on `main`; no game fixture
  was created outside the server suites' own by-exact-name fixtures, and no sweep
  (`test/smoke.ts`, `test:all`) was run.
