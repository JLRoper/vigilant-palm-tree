# Settlers Mode — Acceptance Spec

<!-- docs:verified 2026-10-25 -->

> **Status: AS-BUILT, reconciled twice.** This file was first written as a
> *forward* spec, before settlers mode existed (commit `90005b5`, off `f1dff81`).
> The mode landed on `main` in PR #262 (`5da73ed`, version 0.34.0), and this file
> was reconciled once to record what shipped. It then turned out that **three of
> the four design answers it recorded were wrong** — the shipped constants were
> the phase-0 defaults, never ratified — so the mode was audited against the
> reader's confirmed intentions (`.agentboard/settlers-reports/
> wtgui-investigate-the-settlers-mod-07e33b.md`) and fixed in five commits:
>
> | Commit | What it changed |
> |---|---|
> | `16ee264` | bare wilderness (`neutralCastles: false`), no prebuilt city (the key gates the city view too), `wagonBecomesFirstHero`, the wagon-only rule (`founder_not_a_wagon`) |
> | `b78f628` | the founding command carries no hex — the server derives it from the founder's row |
> | `0f63f3f` | one click founds in place: the armed gesture is deleted, not disabled |
> | `f70d7d0` | the selection follows the converted wagon (the repro's "The selected hero no longer exists") |
> | `36dc11e` | the e2e drives that flow end to end |
>
> Everything below is the **behaviour of that tip**, read from the file named
> beside each claim. §2.0 records exactly which suites were run and where, and §4
> records what was not.
>
> Vocabulary that is not in the code is not in this file: `settlers: true`,
> `settlersOptions`, `state.wagons`, a `wagons` jsonb, `getWagons()`,
> `wagonFoundHexes()`, `data-settlers-mode`, `data-found-settlement`,
> `data-found-confirm`, `validFoundHexes`, `found_invalid`,
> `foundSettlementTarget`, `foundPlacementMode`, `wagonConsumedOnFounding` and a
> founding modal with an editable name **do not exist**; §3 says what does.

Sources: `packages/contracts/src/gameMode.ts` (the mode union, the settings keys,
the wagon/hero id convention), `packages/contracts/src/commands/foundSettlement.ts`,
`packages/engine/src/settlers/startPlacement.ts`,
`packages/engine/src/settlers/found.ts` and `packages/engine/src/settlers/supplies.ts`
(placement, the founding rule, the cargo), `packages/engine/src/init.ts` (the mode
gate in the entity-seeding pass), `packages/engine/src/settlement/starterLayout.ts`
and `packages/engine/src/settlement/placeBuildings.ts` (the two halves of "no
prebuilt city"), `packages/engine/src/ai/aiBrain.ts` and `server/app/aiDriver.ts`
(the AI seat), `server/routes.ts` (`POST /games`),
`server/http/routes/commands.ts` and `server/app/commandHandler.ts` (the command),
`src/state/settings.ts`, `src/io/gameModes.ts`, `src/io/api.ts`,
`src/io/commands.ts`, `src/io/hydrateClientGame.ts`,
`src/screens/home/newGameScreen.ts`, `src/screens/shared/newGameModal.ts`,
`src/screens/adventure/clickIntent.ts`, `src/managers/GameEngine.ts`,
`src/screens/settlements/cityView/cityView.ts`, `src/state/turnController.ts`,
`src/io/debugCommands.ts`, `test/settlers.e2e.ts`, and `SETTLERS-PLAN.md`
§3 (the confirmed answers).

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
- There are **no per-game settlers knobs**. Supplies, spacing, the cargo's fate,
  the free-buildings answer and the wilderness are the mode's constants
  (`SETTLERS_MODE_DEFAULTS` in `packages/contracts/src/gameMode.ts`), and the
  test layer asserts against those constants so a second literal anywhere is a
  bug:

  | Key | Value | Means |
  |---|---|---|
  | `wagonBecomesFirstHero` | `true` | founding converts the wagon into the town's first hero; it is not spent |
  | `minFoundingDistance` | `3` | axial `hexDistance` from **every** settlement, neutrals included |
  | `wagonSupplies` | `200 wood, 100 stone, 50 iron, 0 arcane, 50 food` | the wagon's cargo |
  | `cargoStaysWithFounderHero` | `false` | the town takes the load; the hero rides on empty-handed |
  | `freeStarterBuildings` | `false` | no free city — at founding **or** when the city view opens |
  | `neutralCastles` | `false` | bare wilderness: no neutral castle, town, settlement or building |
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
  (`gameModeFor`, `isSettlersGame`), fed on load — while the ENGINE's rules read
  the state field, which `src/io/hydrateClientGame.ts` maps from the lobby.

### 1.2 The wagon start — bare wilderness

- A settlers game seeds **no settlement at all**: no seat castle, no neutral
  castle, and therefore no seeded starter buildings and no startup districts
  (both are downstream of the castle list). `packages/engine/src/init.ts`'s
  entity pass takes the mode gate and calls `placeSettlersStarts` instead of
  `makeCastles` → `makeSettlements` → `makeHeroes`, and its `modeCastles` filter
  drops every generated castle — owned ones always, neutrals because
  `neutralCastles` is `false`. Terrain, rivers and resource tiles are generated
  exactly as today (`MapGenVersion` untouched, no pass added or moved).
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
    settlement already on the board (a settlers board has none; the classic
    seeding is where a neutral is);
  - a pass that finds no legal hex **throws** rather than returning a short list
    or a plausible duplicate.
- The wilderness is left **empty of objectives**: no neutral town to capture, no
  furnished castle, no lair (that generator does not exist).
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

### 1.4 Founding — ONE gesture, in place, and the wagon becomes a hero

- The settle button is **one slot, two modes** (`src/managers/GameEngine.ts`):
  in a settlers game it reads `⛺ Found Settlement` with the title *"Plant your
  covered wagon's settlement where it stands (one per wagon)"*; in a classic game
  it keeps `Charter Settlement` and opens the charter requirements modal. Which
  copy applies comes from the per-game registry, never a build flag.
- The button is live **only while the seat's own covered wagon is selected**
  (`canOpenCharterFlow` → `selectedWagonId`), and clicking it founds
  **immediately**: there is no armed gesture, no highlighted hex, and no second
  click. A converted founder is `p<seat>-hero`, which the rule refuses, so the
  button goes quiet once its town exists.
- **No map click can found anything.** `resolveAdventureClick` has no founding
  branch: a click on the wagon's hex selects it, the next click puts it down, and
  a click on any other hex is an ordinary move. `found_invalid` and the
  `found-settlement` click intent do not exist.
- **The rule** (`canFoundSettlement`, `packages/engine/src/settlers/found.ts`),
  checked in this order, in one vocabulary shared by engine, server and client
  (`FOUND_SETTLEMENT_REFUSALS`):

  | Refusal | When |
  |---|---|
  | `not_settlers_mode` | the game is classic; founding goes through chartering |
  | `founder_not_at_tile` | the founder (or no such founder) is not standing on the target hex |
  | `founder_not_a_wagon` | the founder is not a covered wagon — a recruited hero, or a converted founder that already planted its town |
  | `occupied` | a settlement already stands there |
  | `tile_impassable` | water/mountain, a river tile, or a resource deposit |
  | `too_close_to_settlement` | within `minFoundingDistance` (3) of **any** settlement |

  The order is what makes "in place" true rather than a convention: the only hex
  the rule ever admits is the founder's OWN hex, so there is no reach to tune and
  no second gesture a client could ask for.
- **The wire carries WHO, not WHERE.** `FoundSettlementCommand`'s `q`/`r` are
  optional (`packages/contracts/src/commands/foundSettlement.ts`);
  `server/http/routes/commands.ts`'s `parseCommand` accepts a `founderId`-only
  payload and refuses a lone `q`, a half pair or a non-integer; and
  `server/app/commandHandler.ts` derives `(q, r)` from the founder's own row
  before handing the engine the integers it requires. An explicit hex is still
  honoured (the AI driver sends the one its brain chose, a replay sends what was
  recorded) and can never widen the rule, because the engine rejects any hex the
  founder is not standing on.
- **What it consumes:** nothing. The wagon **becomes the settlement's first
  hero** (`wagonBecomesFirstHero`) — the same entity, renamed `p<seat>-wagon` →
  `p<seat>-hero`, with the seat's `heroIds` rewritten and its selection carried
  across in the same apply (`selectedHeroId` follows the rename; a consumed
  founder would drop it, the rule `endBattlePhase` already applies). The
  conversion is migration-free because the id is the only carrier that survives a
  reload, and collision-free because `p<seat>-hero` is allocated only by
  `init.ts`'s `makeHeroes`, which never runs in this mode.
- **What it moves:** the cargo each entity holds. The founding writes the
  founder's cargo at that moment (`carriedSupplies`) into the new town's
  warehouse and leaves the surviving hero empty-handed
  (`cargoStaysWithFounderHero: false`): ONE stockpile, in the town. The wagon's
  gold moves into the settlement's treasury rather than vanishing. There is no
  gold price and no kit constant read at founding time: a wagon that spent or
  traded its stock founds a poorer town, which is the point of the supplies
  being cargo.
- **What it produces:** a level-1 settlement at the founder's own hex owned by
  the acting seat: id `s<nextSettlementId>` (the charter allocation rule), name
  and city spots derived from the founder's own streams
  (`settlers:<castleSeed>:<founderId>:*`), terrain-derived rates from the map,
  `buildings: []`, and the same starting fields a seeded town gets. Nothing is
  taken from a client payload, so two foundings by the same wagon reproduce
  identical content.
- **A founded town is never handed a prebuilt city.** `freeStarterBuildings:
  false` gates BOTH grants: the founding-time layout
  (`settlers/supplies.ts`'s `foundedSettlementBuildings`) and the city view's
  free commit on first open (`settlement/starterLayout.ts`'s
  `starterCityOnOpen` takes the game's mode and answers an empty, non-free set for
  settlers). `settlement/placeBuildings.ts` is the engine-side gate underneath
  it, so a stale or spoofed `initialLayout` cannot buy a free city either. What
  the player gets on first open is an empty 5×5 plot; the town hall's
  `placementCost` is `{}` and its `buildDays` 0, so the free first placement is
  the town hall, and everything else is paid for.
- Founding is **immediate** (no `constructing` phase, no `activeCharters` row).
  The event is `SettlementFounded`, and its `consumedFounder` field is `false`
  under this mode's answer.
- Under uncharted, the founding seat's reveal is refreshed for the new town's
  control range.
- Refusals: the server's own authority checks (`no_hero`,
  `forbidden_not_your_hero`) answer first, then the engine's refusal vocabulary
  is relayed **verbatim** as a `409` whose `error` is the code; a malformed
  payload (non-string `founderId`, a lone or non-integer `q`/`r`) is a `400` from
  `parseCommand` before any handler runs.
- **What the seat has afterwards:** one mobile entity — the town's own first
  hero, standing on the town's hex, with no army (`troops: 0`, `stacks: []`).
  The town is then an ordinary settlement: city view, daily/weekly production,
  upgrade paths.

### 1.5 The AI seat

- In settlers mode the server actor (`server/app/aiDriver.ts`, gated on
  `resolveGameMode` plus `isCoveredWagonId`) drives each AI wagon, and it issues
  the **same** `FoundSettlement` command a human's button sends.
- The decision is the engine brain's (`pickSettlersWagonAction` and
  `pickFoundingHex` in `packages/engine/src/ai/aiBrain.ts`), and every hex it
  considers is asked about through `canFoundSettlement` — the predicate the
  human's button uses — so the AI can never found where a human could not:
  - found on the hex it stands on when the rule admits it (no RNG draw, so a
    founding never moves a stream);
  - otherwise one step toward the nearest legal hex within a search radius of 12,
    probing the nearest 16 candidates with `findPath` so "nearest legal" cannot
    mean "unreachable", ties broken by hex distance then record order `(q, r)`;
  - otherwise the same deterministic wander step every hero's empty target list
    falls back to. A wagon is never given an army-only action.
- The charter planner returns `null` in settlers mode: the mode founds, it does
  not charter.
- **After a founding the converted hero is no longer a wagon**, so it leaves the
  wagon branch and takes the ordinary hero path. With `troops: 0` that means: no
  enemy hero is a target (0-troop enemies are skipped), a garrison it cannot beat
  is a path obstacle, and an undefended rival town is a target it can walk onto
  and capture. This is the ordinary hero rule, not a settlers-specific one, and
  it is the mode's only military action now that the wilderness holds no neutral
  objectives. It is recorded here because it is a consequence of the conversion,
  not something this spec asks for.

### 1.6 What stays untouched

- With the mode absent or `classic`, nothing above is observable: the entity
  seeding pass is byte-for-byte today's (pinned by digest), no wagon exists, the
  charter path keeps its own rules, and `POST /games` carries no new key — only
  the `lobby.gameMode` bag already in use.
- No `MapGenVersion` is added and no generation pass changes; no migration runs.
  The mode gates ENTITY seeding only, which is why a bare wilderness costs one
  constant and no engine work.
- Classic's free starter city is untouched in both halves: `starterCityOnOpen`
  still hands an empty classic settlement the free set, and `placeBuildings`
  still commits it uncharged (`mode` absent reads as classic).

---

## 2. Acceptance cases

### 2.0 The surfaces, and how they were run

| Surface | File | Registration |
|---|---|---|
| Engine unit | `test/engine/settlersMode.test.ts` | `npm run test:unit` (globs `test/engine/*.test.ts`) |
| Engine unit, the two city gates | `test/engine/starterLayout.test.ts`, `test/engine/placeBuildings.test.ts` | the same glob |
| Server, creation + command over HTTP | `test/server/settlersGameModeRoute.test.ts` | the same glob |
| Server, handler | `test/server/foundSettlement.test.ts` | the same glob |
| Server, driver | `test/server/aiDriver.test.ts` | the same glob |
| Client mode plumbing | `test/io/gameModes.test.ts`, `test/state/settings.test.ts` | the same glob |
| Mode chips (both surfaces) | `test/screens/home/newGameModeChoice.test.ts`, `test/screens/shared/newGameModeChoice.test.ts` | the same glob (`test/screens/**/*.test.ts`) |
| Click pipeline | `test/screens/adventure/clickIntent.test.ts` | the same glob |
| Scene builder | `test/render/adventureScene.test.ts` | the same glob |
| Playwright e2e | `test/settlers.e2e.ts`, entry `settlers` | `tools/run-test.mjs`'s `ENTRIES.settlers`, in `ALL_ORDER` before `visual`, in the usage string; `npm run test:settlers` |
| Game row | `GET /api/games/:name`, `GET /api/games/:name/tiles` | `lobby.gameMode`; `heroes` (the wagon); `players[].heroIds`; `settlements` |
| Event stream | `game_events` | `kind = 'SettlementFounded'`, and `kind = 'BuildingsPlaced'` for the city-view case |
| Client state | `__gameDebug.getState()`, `.getHeroes()`, `.getSettlements()`, `.screenFor(q, r)`, `.lastClick`, `.endTurn()`, `.setSelectedHero(id)`, `.requestMove(id, q, r)`, `.activeGameName` | `src/io/debugCommands.ts` — the wagon appears in `.getHeroes()` as id `p<seat>-wagon`; there is **no** `getWagons()`, and no founding-hex accessor |
| DOM hooks | `button[data-mode="classic"]` / `button[data-mode="settlers"]` on both new-game surfaces, and the settle button's label/title text | the map is one canvas, so map observables are asserted through `__gameDebug`, never through DOM |

Run on this branch's tip, 2026-10-25, with Postgres up on `127.0.0.1:5432`, a
per-worktree `PGDATABASE=game_poc_fix_settlers_mode_agains_035a86`, and the
client/API on the ports `scripts/allocate-ports.ts` writes:

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
npx tsx --env-file=.env --env-file=.env.test --test --test-concurrency=1 \
  test/engine/settlersMode.test.ts test/engine/starterLayout.test.ts \
  test/engine/placeBuildings.test.ts test/screens/adventure/clickIntent.test.ts \
  test/render/adventureScene.test.ts test/state/settings.test.ts \
  test/server/foundSettlement.test.ts test/server/settlersGameModeRoute.test.ts
PGDATABASE=game_poc_fix_settlers_mode_agains_035a86 npm run test:settlers
```

Result: **166 unit tests in those eight files, 0 fail**, and
`test/settlers.e2e.ts` **green end to end** (`run-test OK`, every step in §2.4
printed). The full-suite gate and what it did not cover: §4.

### 2.1 Engine unit — `test/engine/settlersMode.test.ts` and the two city gates

- **E1 — existing seeds are pinned.** The generated grid and the seeded entities
  of an existing `(seed, size)` are byte-identical, so the mode added no draw to
  any existing stream (the mode gates entity seeding, and these digests are
  classic seeding). *Observable:* the two digests. *Tests:* "the generated grid
  of an existing seed is byte-identical", "the seeded entities of an existing
  seed are byte-identical".
- **E2 — the mode resolves safely.** An absent or unreadable mode reads as
  classic; hydration carries the mode, and a row without one stays a classic
  state key-for-key. *Tests:* "an absent or unreadable mode reads as classic",
  "hydration carries the mode, and a row without one stays a classic state
  key-for-key".
- **E3 — bare wilderness.** A classic board keeps its neutral castles (and their
  buildings); a settlers board has **no settlement at all**. *Observable:* the
  seeded `settlements` record. *Tests:* "neutral castles are classic seeding: the
  classic board keeps them, a settlers board has none", "a settlers game seeds
  bare wilderness: no castle, town, settlement or building at all".
- **E4 — the settlers stream is its own.** Keyed
  `mulberry32(hashString("settlers:<seed>:<id>"))`, per-entity and per-seed,
  replaying identically, and not the map's or the castle seed's stream.
  *Tests:* the three "the settlers stream …" tests.
- **E5 — spawn placement.** One covered wagon per seat carrying the starter
  supplies; every start on bare, dry, deposit-free terrain, spaced by
  `minFoundingDistance` from its siblings and from a board with objectives, and
  reproducible from `(mapSeed, seat)`.
  *Observable:* `placeSettlersStarts`' result. *Tests:* "a settlers game seeds
  one covered wagon per seat, carrying the starter supplies", "a settlers start
  is bare terrain, spaced apart, and reproducible from (mapSeed, seat)".
- **E6 — one refusal vocabulary.** `FOUND_SETTLEMENT_REFUSALS` is a single pinned
  list, `founder_not_a_wagon` included. *Test:* "the founding refusal vocabulary
  is one pinned list".
- **E7 — the id convention.** `coveredWagonSeatOf` parses a wagon id (and refuses
  `p-wagon`, `p1-wagonx`, `p0-hero`), and `coveredWagonHeroIdFor` converts it to
  the seat's hero id. *Test:* "the wagon id convention names a seat, and the hero
  id it converts to".
- **E8 — the rule refuses correctly.** A classic game refuses to found at all; the
  rule admits only the founder's own hex; occupied, impassable and too-close hexes
  are refused; and a recruited hero standing on legal ground is refused as
  `founder_not_a_wagon`. *Observable:* the returned refusal code. *Tests:* "a
  classic game refuses to found: founding is the settlers path", "founding is
  refused off the founder's own hex, on occupied, impassable and too-close hexes",
  "only a covered wagon founds: a recruited hero standing on legal ground is
  refused".
- **E9 — founding, in place.** The town lands on the wagon's own hex; the wagon
  is converted (same record, new id, roster rewritten, cargo handed to the town);
  the converted hero can never found again and its old hex is occupied for
  everyone else; the selection follows; and a reload rebuilds the same picture.
  *Observable:* `state.settlements`, `state.heroes`, `players[].heroIds`,
  `state.selectedHeroId`, the returned `consumedFounder`. *Tests:* "founding in
  place turns the wagon into the town's first hero instead of deleting it", "the
  founding keeps the selection on the entity it converts, and clears it when the
  founder is consumed", "the converted founder survives a reload as the
  settlement's first hero".
- **E10 — never a prebuilt city.** The founded town's buildings are `[]`;
  `foundedSettlementBuildings("settlers", …)` is `[]`; `starterCityOnOpen` with
  `mode: "settlers"` answers `{ buildings: [], free: false }` for an empty town
  and hands an already-built one its own list back; classic still answers
  `free: true`; and `applyPlaceBuildings(…, true)` CHARGES a settlers town while
  the classic town is still free. *Tests:* "a founded settlers town is never
  handed a prebuilt city", "starterCityOnOpen: a settlers settlement is handed
  nothing, free or otherwise", "applyPlaceBuildings: initialLayout cannot hand a
  settlers town a free city".
- **E11 — content is derived, not sent.** The same founder on the same hex
  founds the same town, byte for byte. *Test:* "a founded settlement's content is
  derived from the founder's own streams, not from a payload".
- **E12 — every key flips its behaviour.** The key set is exactly the pinned list
  on both modes; `wagonBecomesFirstHero` flips conversion vs consumption (and the
  town is identical either way); `cargoStaysWithFounderHero` flips who holds the
  load; `minFoundingDistance` flips founding **and** start spacing;
  `wagonSupplies` flips the cargo and the founded warehouse;
  `freeStarterBuildings` flips both grants; `neutralCastles` fills the wilderness
  back in and leaves classic alone; `monsterLairs` is read by no rule yet.
  *Tests:* the "the key set is exactly the pinned list" test and the seven flip
  tests. This is the layer that makes §1.1's constant table a contract rather
  than a comment.

### 2.2 Server — creation, the command over HTTP, and the handler

Real Express and real Postgres for the route suite; mock repos for the handler
suite; both shaped like their siblings.

- **S1 — create stores the mode and seeds bare wilderness.** `POST /games` with
  `gameMode: "settlers"` stores it and seeds **zero settlements** with one wagon
  per seat. *Observable:* the 201 body and the row re-read from the DB. *Test:*
  "POST /games with gameMode settlers stores the mode and seeds BARE wilderness
  with one wagon per seat".
- **S2 — absent stays today's game.** `POST /games` without a `gameMode` creates
  a classic game with seat castles **and its neutrals**. *Test:* "POST /games
  without a gameMode still creates a classic game with seat castles".
- **S3 — junk is refused.** A `gameMode` that is not a known mode is rejected.
  *Test:* "POST /games rejects a gameMode that is not a known mode".
- **S4 — the founding is in place, over HTTP, with no hex on the wire.** A
  `founderId`-only `POST /games/:name/commands` plants the town on the wagon's
  hex, hands it no buildings, moves the cargo into its warehouse, renames the
  wagon to `p<seat>-hero` in the games row **and** in the granular heroes table,
  rewrites the roster, and moves the counter atomically. *Observable:* the 200,
  the re-read row, the granular table. *Test:* "FoundSettlement with no hex founds
  IN PLACE: the wagon becomes the town's first hero".
- **S5 — the follow-ups refuse.** A repeat naming the spent wagon is `409
  no_hero`; the converted founder is `409 founder_not_a_wagon`; a lone `q` and a
  non-integer `q` are `400` from `parseCommand`. *Test:* "FoundSettlement refuses
  a second founding, a converted founder, and a malformed hex".
- **S6 — handler-level cases.** The derived hex is what the settlement and the
  event record; a classic game, a foreign founder and an unknown founder are
  refused (`not_settlers_mode`, `forbidden_not_your_hero`, `no_hero`); the
  spacing refusal is relayed; and a recruited hero is refused as
  `founder_not_a_wagon`. *Tests:* the four cases in
  `test/server/foundSettlement.test.ts`.
- **S7 — the driver.** The AI seat's wagon founds through the same rule, draws no
  RNG for the decision, and the seat keeps its entity as `p<seat>-hero` on the
  roster. *Test:* `test/server/aiDriver.test.ts`'s settlers case.

### 2.3 Client and plumbing

- **C1 — the mode registry.** `src/io/gameModes.ts` maps a game name to its mode,
  resolves unknown names to classic, and answers `isSettlersGame`.
  *Suite:* `test/io/gameModes.test.ts`.
- **C2 — the stored default.** The new-game mode default is classic, unknown
  values normalize to it, a patch round-trips and writes the bumped schema
  version, a store written before the key existed follows along **exactly once**,
  and the mode's keys come from the contracts constants. *Suite:*
  `test/state/settings.test.ts`.
- **C3 — both surfaces offer the same modes.** A stored settlers default
  preselects the settlers chip, a stored classic default preselects classic,
  picking a mode moves the active chip and reaches the create handler, the
  default pick is handed to the create handler unanswered, and each chip carries
  its own hint as a tooltip. *Suites:*
  `test/screens/home/newGameModeChoice.test.ts`,
  `test/screens/shared/newGameModeChoice.test.ts`.
- **C4 — the click pipeline has no founding.** A drag is swallowed, a click on the
  wagon is a select/deselect toggle, and the refusal-sentence table covers every
  engine code (the new `founder_not_a_wagon` included). *Suite:*
  `test/screens/adventure/clickIntent.test.ts`.
- **C5 — the scene marks no planting hex.** A settlers game's render options carry
  no founding hex set, so a scene build emits no `validCharterHex` marker; the
  wagon flag on the hero node is the only settlers-specific thing left in the
  scene. *Suite:* `test/render/adventureScene.test.ts`.

### 2.4 Playwright e2e — `test/settlers.e2e.ts` (entry `settlers`)

Real browser, real API, real DB, and real gestures — nothing dispatches a
synthetic event or calls a debug hook to make anything happen. Games are created
and deleted by exact name, never a sweep.

- **(A) creation** — `POST /games {gameMode: "settlers"}` stores the mode and
  seeds bare wilderness: **zero settlements**, one wagon per seat with the mode's
  cargo.
- **(B) the toolbar tells the truth** — the button reads `Found Settlement` with
  the mode's own title, it is **disabled until the seat's own wagon is selected**,
  and the classic charter copy does not exist in that game.
- **(C) no map click founds anything** — clicking the wagon's hex selects it, the
  second click puts it down, and a click on a neighbour moves it; the board stays
  empty through all three. *Hooks:* `__gameDebug.lastClick.reason`,
  `.getState()`.
- **(D) the founding** — ONE click on the toolbar button plants the settlement on
  the wagon's own hex: the client state and the DB row both carry the town, the
  wagon has become `p0-hero` (client heroes, games row, roster and the granular
  heroes table), the selection follows the rename, the button goes quiet, and
  exactly one `SettlementFounded` event exists.
- **(E) no free city** — the founded town's city view is opened by a real
  double-click, and the town is still building-free: `buildings: []` in the
  client and in the row, and **zero `BuildingsPlaced` events**, so no
  `PlaceBuildings` command was ever sent.
- **(F) the classic control** — the same button reads `Charter Settlement` and
  opens the charter requirements modal; no founding exists there.

---

## 3. Reconciliation — what the earlier records said, and what is true now

The draft specified a contract the implementation answered differently, and the
first reconciliation recorded the implementation's *wrong* answers as if they were
the intent. Both layers, so a reader of the old text is not misled:

1. **No mode checkbox with knobs.** The draft's `Settlers mode` checkbox plus
   gold/wood/stone/movement/reach inputs became a two-chip `Game mode` row, with
   every tunable a `SETTLERS_MODE_DEFAULTS` constant. There is no
   `settlersOptions` in the request body and no per-game override.
2. **The founding kit is not `2500g + 20 wood + 15 stone`.** The wagon carries
   `200 wood / 100 stone / 50 iron / 0 arcane / 50 food`, and what the new town
   receives is the founder's **cargo at that moment**, not a constant; there is no
   gold price at all.
3. **Uncharted is not forced.** The draft forced the checkbox checked and disabled
   for settlers; shipped keeps it the player's own independent control (default on
   both surfaces), and the server writes what the body said.
4. **There is no founding reach.** The draft's `reach: 8` does not exist: the
   founder must be standing on the hex, the button founds it there, and the AI
   searches a 12-hex radius for a hex to walk to.
5. **The spacing is 3, not 4**, measured with `hexDistance` against **every**
   settlement — and the same key spaces the starts.
6. **No founding modal and no name prompt.** The engine derives the settlement's
   name, id and city spots from the founder's own streams, and there is no
   `data-found-confirm`.
7. **The draft's DOM hooks do not exist**: `data-settlers-mode`,
   `data-settlers-knob`, `data-found-settlement`, `data-found-missing`. Shipped:
   `button[data-mode="…"]` on both surfaces, and the settle button's label/title.
8. **The draft's debug accessors do not exist**: `getWagons()`,
   `wagonFoundHexes()`, `getFoundState()`, `foundSettlement()`. Shipped: the wagon
   is read through `__gameDebug.getHeroes()` (or `.getState().heroes`) as
   `p<seat>-wagon`, and after a founding as `p<seat>-hero`.
9. **No `wagons` jsonb.** The draft's new column became a `HeroState` in the
   existing `games.heroes` (an id convention instead of a per-entity flag), which
   is what keeps the mode migration-free.
10. **The planned test files were renamed or folded**: `test/server/
    settlersModeRoute.test.ts` is now `settlersGameModeRoute.test.ts` plus
    `foundSettlement.test.ts`; the planned
    `test/engine/settlersStartPlacement.test.ts` and `settlersFounding.test.ts`
    were folded into `settlersMode.test.ts`; the e2e is `test/settlers.e2e.ts`
    under entry `settlers` with `npm run test:settlers`.
11. **The AI ranking is not production-rate-based.** The draft ranked by
    chartered-city production sum, then distance, then `(q, r)`; shipped ranks the
    legal hexes by **reachable distance**, then `(q, r)`, probing with `findPath`
    — and the founding choice itself consumes no RNG draw (the wander fallback
    does, from the driver's seeded memory).

Then the second layer — the four answers this file used to record as shipped, and
what they are now (`SETTLERS-PLAN.md` §3 is the authoritative table):

1. **"Neutral castles still spawn (`neutralCastles: true`), so the wilderness is
   not left empty of objectives"** — FALSE, and the intention was the opposite: a
   settlers game is **bare wilderness**. The key is `false`, the wilderness holds
   nothing, and the mode has no capture objective at all until a rival founds.
2. **"The wagon is spent and no hero spawns"** — FALSE: the wagon **becomes the
   town's first hero** (`wagonBecomesFirstHero`). The seat keeps one mobile
   entity, its selection follows the rename, and the rule is wagon-only so the
   converted hero can never found a second town.
3. **"The city view's own free starter commit on first open is the only grant"** —
   that was the defect, not the intent. `freeStarterBuildings: false` now gates
   that commit too, and the engine refuses a spoofed `initialLayout`, so a founded
   town is never handed a city.
4. **"The gesture is armed, then the player clicks the highlighted hex"** — gone.
   Founding is **one click**, in place, with no hex on the wire: the mode has no
   tile-selection step.
5. **The stale-selection bug the repro caught** ("The selected hero no longer
   exists" in a newly founded town's panel) is fixed: `selectedHeroId` follows the
   conversion in the same apply.

Flags the draft raised, and how they resolved:

- *"the create path picks `hero_q` / `hero_r` / `enemy_positions` client-side"* —
  it still does (`src/managers/GameSessionManager.ts` generates castles and posts
  those coordinates, mode or not). The server ignores them for a settlers game,
  because `init.ts`'s gate places wagons instead; the redundancy is harmless but
  real, and it is the one piece of the draft's flag left standing.
- *"founding is immediate, unlike a 10-day charter"* — immediate shipped, with
  `SettlementFounded` as the event.
- *"what the founding seat gets afterwards"* — one hero (the wagon, renamed) and
  an empty town: no buildings at founding, and none when its city view opens.
- *"whether a wagon pays terrain cost with the same modifiers heroes do"* — yes,
  identically: the wagon **is** a hero record on the unmodified movement path.

Still open (not settled by any shipped surface):

- **The castle-count field is ignored.** The repro observed a game created with
  `castleCount: 3` come up with 6 neutrals (classic; and the same field is
  meaningless in settlers mode, where no castle survives). Out of this change's
  scope — it is classic's castle generator, unchanged by the mode.
- **A converted hero can capture an undefended rival town** (see §1.5): the
  ordinary hero rules apply to it once it is no longer a wagon. Whether the mode
  wants that is a design question, not a defect.
- **`monsterLairs` is read by nothing** (no lair generator exists) — implement or
  drop the key.
- **A mode with no neutrals has no capture objective and no threat at all** until
  the seats found rival towns; the win-condition question follows from that.
- Wagon-specific markers/art and the mode's balance pass are outside these suites;
  this spec asserts nothing about them.

---

## 4. What was not verified in this pass

- The **full `npm run test:unit`** set and the other safe e2e suites
  (`test:visual`, `test:districts`, `test:cityview`) were not run in the same
  breath as this file's last edit; §2.0 lists exactly what was run. The engine,
  client-pipeline, render and server suites named there are the ones the change
  touches, and they are green.
- `test:all` / `test:smoke` were **not** run: they wipe every game except their
  own fixtures in the shared `game_poc` database while sibling worktrees are
  live.
- The **Docker Desktop stack was not redeployed**, so `http://127.0.0.1:5173`
  still serves the previous build; the browser evidence in §2.4 comes from this
  worktree's own client and API on allocated ports.
- Whether an **AI-only** game plays the mode to a satisfying conclusion (it
  founds; then its hero wanders or marches on a rival town) was not watched in a
  browser beyond the driver suite's command-stream assertions.
