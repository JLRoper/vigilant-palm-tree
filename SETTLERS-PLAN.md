# Settlers game mode — workstream plan (Phase 0)

<!-- plan:verified 2026-10-24 -->

Phase 0 is recon, shared seams and the design record. No gameplay rule is
implemented here: this commit set lands the vocabulary every later workstream
compiles against, plus the design decisions the rules must honour.

Branch: `wtgui/settlers-game-mode-phase-8bb479` (worktree
`.worktrees/settlers-game-mode-phase-8bb479`, off `github/main` at `9506422`).

## 1. What the mode is

A **game mode** is a stored, per-game value — `classic` (every game created
before this feature, and the default) or `settlers` — carried in the existing
`games.lobby` jsonb as `lobby.gameMode`, exactly the way `lobby.uncharted` and
`lobby.legacyAutoTrade` already ride that bag. **Everything mode-dependent gates
on this one value**; no rule may branch on a build-time flag, a client setting,
or an "is this a settlers map" heuristic. Absent reads as `classic`, so every
existing save keeps today's rules byte-for-byte.

The vocabulary lives in `@heroes/contracts` (`packages/contracts/src/gameMode.ts`):
`GAME_MODES`, `GameMode`, `DEFAULT_GAME_MODE`, `isGameMode`, `resolveGameMode`,
`GameModeSettings`, `CLASSIC_MODE_DEFAULTS`, `SETTLERS_MODE_DEFAULTS`,
`gameModeSettings(mode)`. Its tunable keys and their exported defaults are the
single source for the engine, the server, the client and the tests — a second
literal anywhere (a form default, an AI threshold, a test fixture) is a bug.

## 2. Hard constraints (non-negotiable, every phase)

1. **Pre-existing towns and castles are ENTITY seeding, not terrain.**
   `server/routes.ts`'s `POST /games` seeds them through
   `makeInitialStatePayload(map, mulberry32(seed ^ 0x706c6179), initOpts)` →
   `packages/engine/src/init.ts`'s `generateCastles` → `makeSettlements` →
   `makeHeroes`, and writes the result into the `games.settlements` /
   `games.heroes` / `games.players` columns. Terrain is a separate pass:
   `generateAndInsertTiles` → `getOrCreateGameMap(seed, size, version)`.
2. **Do not touch `MapGenVersion` or any existing generation pass.**
   `packages/engine/src/map/gameMap.ts` (`MapGenVersion`, the
   `CURRENT_MAP_GEN_VERSION = 5` constant, the cache key, `resolveMapGenVersion`
   / `resolveSavedMapGenVersion`) and every pass in the `GameMap` constructor
   stay exactly as they are. Settlers mode adds no terrain, no resource tile,
   no river, no biome and no new generation pass. A mode that wanted terrain
   would need a new `MapGenVersion` — it does not, and this plan forbids
   reaching for one.
3. **Settlers start placement draws from its OWN RNG stream.**
   `settlersStreamRng(seed, id) = mulberry32(hashString("settlers:" + seed + ":" + id))`,
   implemented in `packages/engine/src/settlers/startPlacement.ts` (phase 0).
   No draw may be added to the map's, the castle placement's, or the
   settlement-creation stream; the existing draws (names, horse variants,
   city spots, castle positions, districts) must stay exactly where they are in
   their streams.
4. **Existing seeds stay byte-identical, pinned with a test.**
   `test/engine/settlersMode.test.ts` (phase 0) pins the digest of
   `makeInitialStatePayload` and of the generated grid for a fixed
   `(seed, size)` pair, and pins the settlers stream's own values. Any later
   change that shifts an existing seed fails that test.
5. **The mode rides the lobby jsonb — no schema migration.**
   `lobby.gameMode` follows the `uncharted` precedent: read from the request
   body by `POST /games`, written into the lobby bag, mirrored client-side in
   `src/io/api.ts`'s `GameLobbyState`, parsed on load by
   `readGameMode(lobby)` in `packages/engine/src/hydrate.ts`.

## 3. Design questions and the answers the rules must honour

Asked one at a time, each with its recommended default first. **The reader's
answer is authoritative over the default**; this table records what the rules
are written against.

> **Status of these answers: CONFIRMED (2026-10-25), and the shipped constants
> now carry them.** The four questions were first recorded here as **UNCONFIRMED**
> working defaults, because the `clarify` tool was not available when phase 0
> landed. The mode was then audited against the reader's locked answers (the
> panel's job store, thread `wtgui-investigate-the-settlers-mod-07e33b`), and
> three of the four defaults were wrong: the wilderness is bare (no neutral
> castles), the wagon is not spent (it becomes the town's first hero), and
> nothing hands a founded town a city (the city view's free commit is gated
> too). A fourth rule the questions never asked — that founding has **no
> tile-selection step** — is now recorded beside them. The key set moved with
> the answers: `wagonConsumedOnFounding` became `wagonBecomesFirstHero`, and
> `cargoStaysWithFounderHero` was added to make the cargo's fate a decision
> rather than a side effect of the rename.

| # | Question | Confirmed answer | Key in `SETTLERS_MODE_DEFAULTS` |
|---|---|---|---|
| 1 | Is the starting wagon consumed when it founds the settlement? | **No — it BECOMES the settlement's first hero**: the same entity, renamed `p<seat>-wagon` → `p<seat>-hero`, still the seat's mobile unit. One wagon still buys exactly one settlement, because the rule is wagon-only: a converted founder is refused (`founder_not_a_wagon`) | `wagonBecomesFirstHero: true` |
| 2 | Does founding require a minimum distance from other settlements, and how far? | Yes — at least **3** hexes (axial `hexDistance`) from every settlement, own or foreign | `minFoundingDistance: 3` |
| 3 | What supplies does the wagon carry, does the new settlement get free buildings, and who keeps the cargo? | The wagon carries a starter stockpile (200 wood / 100 stone / 50 iron / 0 arcane / 50 food), and founding **moves it into the town's warehouse** (the hero rides on empty-handed — one stockpile, in the town). The settlement gets **no** free buildings: neither at founding nor from the city view, whose free starter commit the same key gates | `wagonSupplies`, `cargoStaysWithFounderHero: false`, `freeStarterBuildings: false` |
| 4 | Do neutral castles and monster lairs still spawn in the wilderness? | **No neutral castles** — a settlers game is bare wilderness: no neutral town, settlement, castle or building. Monster lairs are not implemented in the codebase at all, so that key is still a forward-looking yes read by no rule | `neutralCastles: false`, `monsterLairs: true` |
| 5 | Does founding take a second gesture — arm the rule, then click a highlighted hex? | **No — founding happens IN PLACE**, on the hex the wagon already stands on: the toolbar's action is the whole action, the wire command carries no hex (the server derives it from the founder's row), and the engine's rule admits no other hex | (no key: the rule has no reach to tune) |

Consequences the rules must respect:

- **Answer 1 = convert** means founding keeps the entity and changes its
  identity: `foundSettlement` renames the record and rewrites the seat's
  `heroIds`, and the id is the only carrier that survives a reload (the
  granular heroes table has fixed columns, §2.5). It also means the engine's
  rule is **wagon-only** — `canFoundSettlement` refuses a founder that is not
  `isCoveredWagonId`, or the converted hero could found a second town. The
  selection follows the rename in the same apply, so no panel reports a hero
  that no longer exists.
- **Answer 2** is measured with `hexDistance` from `@heroes/contracts`
  (`packages/contracts/src/geometry.ts`) — the same metric `castlePlacement.ts`
  uses — against **every** settlement, neutral ones included, so a neutral
  castle would block a start exactly like a rival's town (a bare wilderness has
  none to block).
- **Answer 3's** supplies are written into the new settlement's `warehouse`;
  `freeStarterBuildings: false` now gates BOTH grants — the founding-time
  layout (`foundedSettlementBuildings`) and `starterCityOnOpen`'s free commit
  when the city view first opens — with `placeBuildings.ts` refusing a spoofed
  `initialLayout` in a mode whose key says no. Nothing in the chain may read a
  second literal.
- **Answer 4 = no neutrals** keeps `generateCastles` untouched: the
  suppression is a **filter applied to the returned `PlacedCastle[]`** after
  generation (in `init.ts`'s `modeCastles`), never a change to
  `castlePlacement.ts`'s candidate scan or draw order — otherwise the neutrals'
  positions and every downstream settlement/horse-variant draw move and
  constraint 4 fails. The neutral towns, their seeded starter buildings and
  their districts disappear with the castle list they are downstream of, so one
  constant is the whole change.
- **Answer 5** removes the gesture rather than relabelling it: the click
  pipeline keeps no founding branch, no armed hex set and no highlighted hex,
  and `server/http/routes/commands.ts` accepts a `FoundSettlement` payload with
  no `q`/`r` (deriving them in `commandHandler.ts` from the founder's own row).


## 4. Workstreams

Five groups, seven workstreams. File ownership is **disjoint by path**: no path
appears in two workstreams' "owns" lists, so two agents can work at once
without a lock. Where a path must not move for correctness it is named in the
workstream's "must not touch" list as well as in §2.

### Group A — engine + contracts + server (the deterministic core)

#### W1 · CONTRACTS

- **Owns**
  - `packages/contracts/src/gameMode.ts` *(new — landed in phase 0)*
  - `packages/contracts/src/index.ts` *(the barrel re-export)*
  - `packages/contracts/src/gameState.ts` *(the optional `gameMode?` field on `GameState`)*
  - `packages/contracts/src/commands/foundSettlement.ts` + `packages/contracts/src/commands/index.ts` *(phase 1)*
  - `packages/contracts/src/events/engineEvent.ts` *(phase 1 — the `SettlementFounded` variant)*
- **Must not touch**: `packages/engine/**`, `server/**`, `src/**`, `test/**` — contracts is the leaf of the dependency graph (`dependency-cruiser.cjs`'s `contracts-is-a-leaf` rule). It carries vocabulary and trivial pure predicates only: no rules, no RNG, no I/O.
- **Deliverable**: the mode union + its settings keys with exported default constants (phase 0); the `FoundSettlement` command contract and its event variant (phase 1).
- **Test layer**: none of its own. It is type-checked by `npm run test:types` and asserted through the engine/server/client suites; a pure predicate added here gets its coverage in `test/engine/settlersMode.test.ts` (W6's file).
- **Consumes**: nothing. It **is** the seam every other workstream consumes.

#### W2 · ENGINE

- **Owns**
  - `packages/engine/src/settlers/startPlacement.ts` *(new — phase 0 stub + the real RNG stream)*
  - `packages/engine/src/settlers/found.ts` *(new — phase 0 stub)*
  - `packages/engine/src/settlers/supplies.ts` *(new — phase 1, the cargo/warehouse writer)*
  - `packages/engine/src/index.ts` *(the barrel exports for `./settlers/*`)*
  - `packages/engine/src/init.ts` *(the mode gate + the settlers start pass)*
  - `packages/engine/src/hydrate.ts` *(`readGameMode(lobby)` next to `readPendingBattle`)*
- **Must not touch**: `packages/engine/src/map/gameMap.ts` (MapGenVersion, the cache key, every generation pass — §2.2); `packages/engine/src/map/castlePlacement.ts` (its candidate scan, spacing loop and draw order); the draw order inside `init.ts`'s `makeSettlements`/`makeHeroes`; `packages/engine/src/settlement/starterLayout.ts` (the starter layout is reused as-is); any `test/**` file (a failing test is reported to W6, never edited by this workstream).
- **Deliverable**: `settlersStreamRng(seed, id)` and the two signature-only stubs (phase 0); real start placement and real founding, gated on `gameMode === "settlers"`, with the classic path provably untouched (phase 1).
- **Test layer**: unit only — `npx tsx --env-file=.env --env-file=.env.test --test test/engine/settlersMode.test.ts`, then the full `npm run test:unit`. No browser, no DB. The determinism pin (§2.4) lives here.
- **Consumes**: W1's `GameMode`, `SETTLERS_MODE_DEFAULTS`, `gameModeSettings`, `hexDistance`.

#### W3 · SERVER

- **Owns**
  - `server/routes.ts` *(`POST /games` reads `gameMode` from the body, validates it, writes `lobby.gameMode`, threads it into `initOpts`; `LobbyState` grows the field)*
  - `server/http/routes/commands.ts` *(`parseCommand`'s per-kind branch for `FoundSettlement` — a new kind without one is rejected with `invalid command` before the handler runs)*
  - `server/app/commandHandler.ts` *(the `FoundSettlement` case, its authority checks, and the `const _exhaustive: never` checklist)*
  - `server/app/turnService.ts` *(phase 2 — the mode's own round-wrap pass)*
  - `server/persistence/hydrate.ts` *(row → engine hydrate; the mode itself is parsed by W2's `readGameMode`)*
  - `docs/multiplayer.md`, `docs/operations.md` *(the docs whose `DOC_OWNERSHIP` globs cover `server/**` and `src/io/**`)*
- **Must not touch**: `server/app/aiDriver.ts` (owned by W5); `server/persistence/repositories/gameRepo.ts`'s `GAME_COLUMNS` and any migration (the mode rides the lobby jsonb — §2.5); `packages/**`; `src/**`.
- **Deliverable**: a game created with `gameMode: "settlers"` stores the mode and seeds the settlers start through W2's functions; a `FoundSettlement` command reaches the engine reducer through the route validator (phase 1).
- **Test layer**: `test/server/settlersCreateGame.test.ts` (real express router on an ephemeral port against `PGDATABASE=game_poc_settlers-game-mode-phase-8bb479`, the `test/server/createGameRoute.test.ts` shape) + the existing `test/server/createGameRoute.test.ts` staying green.
- **Consumes**: W1's contracts; W2's `placeSettlersStarts` / `foundSettlement` / `readGameMode`; W4's client-side field name for `POST /games` (`gameMode`).

### Group B — client

#### W4 · CLIENT UI

- **Owns**
  - `src/state/settings.ts` *(the `gameMode` key + the `SETTINGS_SCHEMA_VERSION` bump — phase 0)*
  - `src/io/api.ts` *(`GameLobbyState.gameMode?`, the `createGame` body field)*
  - `src/io/gameModes.ts` *(new — the per-game mode registry, the `src/io/unchartedGames.ts` pattern)*
  - `src/io/commands.ts`, `src/state/turnController.ts`, `src/game/turnHooks.ts` *(the client plumbing for the founding command)*
  - `src/managers/SessionManager.ts`, `src/managers/GameSessionManager.ts`
  - `src/screens/home/newGameScreen.ts`, `src/screens/shared/newGameModal.ts`, `src/screens/home/homeView.ts` *(the mode selector, defaulting from the settings store)*
  - `src/screens/adventure/clickIntent.ts`, `src/screens/adventure/adventureView.ts`, `src/screens/adventure/tileInfo.ts` *(the "found here" gesture and its refusal reasons)*
  - `src/render/**` + `src/render/docs/technical-spec.md` *(wagon and start markers)*
  - `docs/player-guide.md`, `docs/architecture.md`, `docs/module-documentation-and-relationships.md`, `docs/README.md`
- **Must not touch**: `src/ai/aiBrain.ts` (W5); `packages/**`; `server/**`; the settings store's other keys' defaults (a mode selector must not change any existing default); `docs/settlements.md`, `docs/map.md`, `docs/map-gen.md`, `docs/resource-gathering.md` (W2's docs).
- **Deliverable**: both new-game surfaces offer the mode and pre-select the stored default; the mode is known client-side for the active game (registry set on load, the `unchartedGames.ts` pattern); the founding gesture exists with its refusal reasons (phase 1).
- **Test layer**: `test/state/settings.test.ts` (the store key + the one-time migration), `test/io/gameModes.test.ts`, `test/screens/shared/newGameModal.test.ts`-style DOM-free model tests, then `npm run test:visual` for any render change. The browser flow is W6's `test/settlers.e2e.ts`.
- **Consumes**: W1's `GameMode` / `DEFAULT_GAME_MODE`; W3's `POST /games` field name and the server's rejection reasons (the client shows the server's sentence, it does not invent a second one).

### Group C — AI

#### W5 · AI

- **Owns**
  - `packages/engine/src/ai/aiBrain.ts` *(mode-aware priorities: found a settlement instead of chartering one)*
  - `server/app/aiDriver.ts` *(the server-side AI actor's turn shape for the mode)*
  - `src/ai/aiBrain.ts` *(the browser-driven AI mirror)*
  - `docs/heroes.md`
- **Must not touch**: the charter path's existing rules (`packages/engine/src/charter/**`) — settlers founding is a **separate** path, not a rewrite of charters; `server/app/turnService.ts` (W3); the mode's tunables (read `SETTLERS_MODE_DEFAULTS`/`gameModeSettings`, never re-declare a number).
- **Deliverable**: in settlers mode the AI places its start and founds settlements through the same engine functions a human uses, and never issues a command the mode forbids; in classic mode the AI's decisions and its command stream are byte-identical to today.
- **Test layer**: `test/ai/*.test.ts` (engine brain) and `test/server/aiDriver.test.ts` (the server driver), plus `npm run test:aiCharter` staying green as the classic-mode regression.
- **Consumes**: W2's `foundSettlement` / `canFoundSettlement` results and refusal reasons; W1's `gameModeSettings`.

### Group D — tests

#### W6 · TESTS & RELEASE PLUMBING

- **Owns**
  - `test/engine/settlersMode.test.ts` *(phase 0 — the determinism pin)*, `test/engine/settlersStartPlacement.test.ts`, `test/engine/settlersFounding.test.ts`
  - `test/server/settlersCreateGame.test.ts`
  - `test/state/settings.test.ts`'s mode cases
  - `test/io/gameModes.test.ts`
  - `test/settlers.e2e.ts` *(new browser suite)*
  - `tools/run-test.mjs` (`ENTRIES` + `ALL_ORDER`), `test/_request.ts` (the `TestRequest["entry"]` usage string), `package.json`'s `test:settlers` script
  - `package.json`'s `version` + `CHANGELOG.md` *(the changeset's bump — one `minor`, once, before the phase-1 commit; `npm install` must not be run, and `package-lock.json` stays untouched)*
- **Must not touch**: any production file. A red suite is reported to the owning workstream with the failing test names; the tests workstream never edits `src/`, `packages/` or `server/` to make a test pass. No `test/smoke.ts` / `test:all` run while another worktree may be live (they delete every game except their own fixtures in the shared `game_poc` database).
- **Deliverable**: the pin that proves §2.3/§2.4, one suite per seam, and the browser suite that drives the real gesture (Playwright mouse drags/clicks, not dispatched events).
- **Test layer**: it *is* the test layer. It consumes the others: `npm run test:unit`, `npm run test:settlers`, `npm run test:visual`.
- **Consumes**: W1's constants as the assertion source of truth; W2's stub signatures (frozen in phase 0, so the tests can be written against them before the rules land); W3's route entry names.

### Group E — review

#### W7 · REVIEW

- **Owns**
  - `reviews/settlers-mode-phase<N>-review.md` *(one per phase)*
- **Must not touch**: every other path. Review is **read-only** on production code, tests and docs: it reports findings, it does not fix them. It does not commit to the phase's branch — its report is the phase's evidence artifact, on its own branch or as a review comment.
- **Deliverable**, per phase, against this plan:
  1. ownership check — `git diff --name-only github/main...<branch>` against §4's "owns" lists; any file touched by a workstream that does not own it is a finding;
  2. constraint check — §2.1-§2.5, each with evidence (the digest pin passing, `git diff` showing no `gameMap.ts` / `castlePlacement.ts` change, the lobby-jsonb-only diff);
  3. gate check — `npm run build`, `npm run lint:deps`, `npm run docs:check`, the unit suite, and the safe e2e suites, with the suites it did **not** run named and the reason;
  4. design-question check — that each of §3's four answers is implemented as the constant says, and that flipping a constant flips the behaviour (a one-line test of each);
  5. a sign-off line naming the phase and the commit reviewed.
- **Test layer**: re-runs the others' suites; owns no test of its own.
- **Consumes**: every workstream's committed branch, W6's test entries to reproduce a failure, and the phase's gate evidence.

## 5. Phase ladder

| Phase | Contents | Exit condition |
|---|---|---|
| 0 *(this commit set)* | recon; the design record; `packages/contracts/src/gameMode.ts`; the settings-store key + schema bump; `settlersStreamRng` + the two signature-only stubs; the determinism pin | `tsc` clean, the unit suite green, the pin passing, `SETTLERS-PLAN.md` committed |
| 1 | real start placement + real founding in the engine; the command + event contracts; the route branch + handler case; the client gesture; the mode selector on both new-game surfaces | a settlers game creates, places its start and founds a settlement end-to-end; classic games byte-identical |
| 2 | AI plays the mode; the per-round pass; refusal-reason vocabulary shared by engine/server/UI | an AI seat founds through the same functions, and `test:aiCharter` stays green |
| 3 | polish: markers/art, panel copy, the mode's own balance pass | W7's sign-off on the full ladder |

## 6. Ownership quick map

```
packages/contracts/**                        W1
packages/engine/src/settlers/**              W2
packages/engine/src/init.ts, hydrate.ts      W2
packages/engine/src/index.ts                 W2   (W1 adds nothing here)
packages/engine/src/ai/**                    W5
server/routes.ts, server/http/**, server/app/commandHandler.ts,
server/app/turnService.ts, server/persistence/**   W3
server/app/aiDriver.ts                       W5
src/state/settings.ts, src/io/**, src/managers/**,
src/screens/**, src/game/**, src/render/**   W4
src/ai/**                                    W5
test/**                                      W6
tools/run-test.mjs, test/_request.ts, package.json (version + scripts),
CHANGELOG.md                                 W6
reviews/**                                   W7
SETTLERS-PLAN.md                             W7 (this file's owner-of-record;
                                                 the plan changes by review)
```

Forbidden for every workstream: `packages/engine/src/map/gameMap.ts`'s
versioning surface, `packages/engine/src/map/castlePlacement.ts`'s draw order,
any new `MapGenVersion`, and any migration for the mode.

## 7. As-built record — SHA pins, and the ownership exceptions actually taken

Added by the integration pass on 2026-10-24. §4's branch names are **not stable
handles**: the worktree panel renames a finished worktree's branch *and* its
directory after the thread slug, so `wtgui/settlers-engine`,
`wtgui/settlers-client-ui` and `wtgui/settlers-ai` (the name W5's report uses)
do not resolve today. Pin the work by commit. The feature branch is
`wtgui/implement-settlers-engine-slice-from-pla-1e8b31`, seven commits above
local `main` at `9506422`, with `github/main` at `965b681` merged into it:

| Step | Commit | Subject |
|---|---|---|
| plan | `bb750e4` | docs(settlers): plan the game mode into disjoint workstreams |
| phase 0 | `cf81632` | the game-mode vocabulary and the new-game default-mode setting |
| phase 0 | `bef0b87` | the start-placement and founding stubs, and the determinism pin |
| W1+W2+W3 | `23c72a0` | the engine, contracts and server slice |
| merge | `dea9b27` | merge `github/main` into the feature branch |
| W5 | `ce48e05` | the AI seat founds through the engine's own founding rules |
| W4 | `8591d713` | the client UI slice |
| feature tip | `eee9c98` | both slice merges landed — the commit to review |

Files a workstream touched although §4 or §6 assigns them elsewhere. The
ownership lists are a sketch of each workstream's files, not a fence around the
chain a change needs, so these are recorded rather than reverted:

- `src/render/scene/entityMirror.ts` — §6 gives `src/render/**` to W4; the engine
  slice adds the `SettlementFounded` case to an exhaustive switch, which `tsc`
  requires. W4's slice is cut from that commit, so it inherits the case.
- `packages/engine/src/events/applyEvent.ts` and `docs/event-system.md` — owned
  by no workstream in §4 or in §6: the event's sync classification and the §5.1
  counts. `docs:check` covers the doc through its `packages/contracts/**` +
  `packages/engine/src/events/**` globs, so the omission is a plan gap, not a
  doc-gate failure.
- `test/**` — §4 W2 forbids the engine workstream from touching any test file,
  §4 W5 names `test/ai/*.test.ts` and `test/server/aiDriver.test.ts` as its own
  test layer, and §6 gives `test/**` to W6. Both production slices wrote tests
  (the engine slice created `test/server/foundSettlement.test.ts` and
  `test/server/settlersGameModeRoute.test.ts`, and edited
  `test/engine/settlersMode.test.ts` and `test/engine/syncClassification.test.ts`).
  **RESOLVED by W6 on 2026-10-24 — see §7.1.**

Nothing here reassigns ownership: §4 W6 still owns `package.json`'s version,
`CHANGELOG.md` and the phase's single version bump, and this section changes no
§2 constraint, no §3 design answer and no §5 exit condition.

### 7.1 `test/**` ownership — the §4 contradiction, resolved

W7's M3 was that §4 W2 says a workstream "must not touch … any `test/**` file",
§4 W5 names `test/ai/*.test.ts` and `test/server/aiDriver.test.ts` as *its own*
test layer, and §6 hands `test/**` to W6 — while both production slices wrote
tests anyway. The rule below is the resolution, and it reads the plan's own
"Test layer" bullets as the ownership lists they already are:

1. **`test/**` is SHARED, not fenced.** A workstream owns the test files its own
   "Test layer" bullet names, plus any fixture it creates while implementing its
   slice. A slice lands with the evidence that pins it, in the same commit: the
   author of a rule is the one who can write its pin without a hand-off, and a
   fixture written by the workstream that wrote the code is not a breach — the
   engine slice's `test/server/foundSettlement.test.ts` and the AI slice's
   additions to `test/server/aiDriver.test.ts` are legitimate on this rule.
2. **W6 owns what no single workstream's change is the subject of:** the mode's
   own suites (`test/settlers.e2e.ts` and the `test/engine/settlers*.test.ts`
   pin-and-rule files) and the mode's creation-route coverage
   (`test/server/settlersGameModeRoute.test.ts` today, whatever §4 W3's bullet
   names later), the flip tests for §3's answers, and the shared fixture files
   two workstreams would otherwise both
   edit (e.g. `test/engine/syncClassification.test.ts`, whose counts follow the
   event contract). It also owns the registration and release plumbing: this
   file's `Test layer` bullets name them exactly — `tools/run-test.mjs`,
   `test/_request.ts`, `package.json`'s scripts and version, `CHANGELOG.md`.
3. **§4 W2's "must not touch any `test/**` file" is amended** to: must not touch
   a test file another workstream owns, and must not weaken, delete or retarget
   a failing assertion to make its own code pass. A red suite is reported to the
   owner of the test that is red, with the failing test names — which is what W6
   does with a red production suite, and what a production workstream does with
   a red W6 suite.
4. **W7's ownership check (§4 W7 deliverable 1) judges a `test/**` path against
   the workstream whose "Test layer" bullet names it, falling back to W6 when no
   bullet does.** A `test/**` path in a slice's diff is therefore not a finding
   by itself; a test file edited by a workstream that neither owns it nor added
   it is.
