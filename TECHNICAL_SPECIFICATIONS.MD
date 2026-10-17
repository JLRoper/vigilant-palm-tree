# Technical Specifications — heroes-js

<!-- docs:verified 2026-10-17 -->

A turn-based, hex-grid adventure game inspired by *Heroes of Might & Magic*. This document captures the **tech stack** as it currently exists in the repository. Game design documentation lives under [`docs/`](./docs/README.md); the render module has its own authoritative spec at [`src/render/docs/technical-spec.md`](./src/render/docs/technical-spec.md).

---

## 1. Project shape

| Aspect | Value |
|---|---|
| Project name | `heroes-js` |
| Version | `0.3.4` (root `package.json` is the source of truth) |
| Package type | ESM (`"type": "module"`) |
| Engines | Node `>=22 <23` (`engines` field in `package.json`) |
| Repo layout | npm **workspaces**: `packages/*` (two packages — see below) plus root client, server, and test directories |
| Languages | TypeScript (primary), plain JavaScript `.mjs` (sprite/test tooling), SQL (migrations), HTML/CSS (UI shell) |
| License | Not declared |

Workspace packages (both `private`, both expose raw TS source via `"exports"` — no build step):

| Package | Path | Role |
|---|---|---|
| `@heroes/engine` | `packages/engine/` | Pure game rules: combat, economy, settlement, charter, turn, map, hydration. Depends on `@heroes/contracts` only. |
| `@heroes/contracts` | `packages/contracts/` | The wire: shared types (`GameState`, `HeroState`, `SettlementState`, commands, `EngineEvent`s, geometry, ids, telemetry). Leaf — zero dependencies. |

Vite (`resolve.alias`) and `tsconfig.json` (`paths`) map `@heroes/contracts` / `@heroes/engine` to their respective package entry points, plus `@screens/*` → `src/screens/*`.

Top-level directories:

- `src/` — game client (TypeScript, run in the browser via Vite)
- `server/` — backend API (TypeScript, run via `tsx`)
- `packages/` — workspace packages `@heroes/engine` + `@heroes/contracts` (the shared engine/contract layer used by both client and server)
- `test/` — Playwright smoke/integration suites + `node:test` unit tests
- `tools/` — sprite/test scripts (Node + Playwright)
- `scripts/` — port allocation, cleanup, DB/asset helpers (TS, run via `tsx`)
- `docs/` — game design documents (Markdown)
- `docker/` — `Dockerfile` (multi-stage `api-runtime` / `web-runtime` targets) + `nginx.conf` (the `gateway` reverse proxy)
- `dist/` — Vite build output
- `src/resources/` — baked-in sprite PNGs/SVGs (castles, Tier 1 settlement fullness sprites in `src/resources/settlements/` (`settlement-l1-v{0..3}-f{1..5}.png`), districts, resources, units — arena battle sprites + hero-panel icons, horses, buildings, skybox parallax layers)
- `docker-compose.yml` — Postgres + API + web + gateway (nginx reverse proxy) + Adminer

The former top-level `shared/` directory **no longer exists** — its contents were moved into `packages/engine` / `packages/contracts`; no source file imports a `shared/` path anymore.

---

## 2. Languages & build

### TypeScript
- Configured in [`tsconfig.json`](./tsconfig.json).
- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`.
- `lib`: `ES2022`, `DOM`, `DOM.Iterable` (client is a browser app).
- Strict mode on: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`.
- `noEmit: true` — Vite/tsx handle transformation; the CLI `tsc` step in `npm run build` is purely type-checking.
- `include`: `src`, `packages/contracts/src`, `packages/engine/src`, `server` — the server **is** type-checked by `tsc` in the default config now. Tests are type-checked only implicitly (via editor/tsx), not as part of `npm run build`.
- `paths` aliases: `@heroes/contracts`, `@heroes/contracts/*`, `@heroes/engine`, `@heroes/engine/*`, `@screens/*`.

### Vite (client bundler)
- [`vite.config.ts`](./vite.config.ts) — Vite 5.
- `assetsInlineLimit: 0` — all assets are emitted as separate files (no base64 inlining).
- `resolve.alias`: `@heroes/contracts`, `@heroes/engine`, `@screens` (source-mapped straight to TS entry files).
- Dev server **and** preview server: host `0.0.0.0`, port from `CLIENT_PORT` in `.env` (default `5173`); both proxy `/api/*` → `http://<API_HOST>:<API_PORT>` (defaults `127.0.0.1:3001`).
- Entry HTML: [`index.html`](./index.html), loads `src/main.ts` as an ES module.
- HTML mounts a full-viewport `<canvas id="game">` inside `#app` and a `#toolbar` slot. The `#hud` element is **not** in the HTML — it is created dynamically by `buildHud()` (`src/screens/shared/hud.ts`) into the toolbar's status slot; `index.html` only carries its CSS.
- Build version stamping: `vite.config.ts` injects three compile-time `define`s — `__APP_VERSION__` (the `package.json` version), `__BUILD_TIME__` (ISO build timestamp), and `__BUILD_COMMIT__` (the `VITE_COMMIT_HASH` env var, else the short git hash; `"dev"` as fallback). [`src/core/version.ts`](./src/core/version.ts) consumes them (with node/test fallbacks) via `APP_VERSION` / `BUILD_TIME` / `BUILD_COMMIT` + `formatBuildTime` / `getBuildInfo`, and the settings menu shows `v<version> (<commit>)` and `Built: <formatted time>` in its bottom row (full ISO timestamp in the tooltip).

### JavaScript (Node ESM, `.mjs`)
- Used for tooling scripts in `tools/` and `tools/sprites/` (sprite generation, test wrapper `tools/run-test.mjs`).
- No CommonJS anywhere in the project; everything is ESM.

### SQL
- [`server/schema.sql`](./server/schema.sql) — baseline schema.
- [`server/migrations/`](./server/migrations) — 29 ordered migrations, `001` through `029`; `006_faction_rosters` is present. Recent additions include SSE notifications (`017`), bank/wagon storage (`022`–`023`), faction content (`024`–`026`), numeric precision (`027`), treasury-wagon backfill (`028`), and settlement districts (`029`).
- Applied at startup by `initSchema()` in [`server/db.ts`](./server/db.ts:1).

---

## 3. Runtime environments

### Client (browser)
- Plain HTML + TypeScript; **no SPA framework** (no React/Vue/Svelte/Angular).
- World rendering is done on `<canvas>` via the scene-graph pipeline (§6); UI overlays (HUD, toolbar, menus, modals, panels) are plain DOM elements built by modules under `src/screens/`.
- Startup flow (`src/main.ts`): construct `GameEngine` → `engine.init()` / `engine.initBackend()` → show `HomeView` (sign-in / new game / load game overlay) → rAF loop drives `engine.loop(now)` underneath.

### Server (Node.js)
- [`server/index.ts`](./server/index.ts:1) boots Express 5 on `API_PORT` (loaded from `.env` by `scripts/allocate-ports.ts`, default `3001`); binds `0.0.0.0` when `LAN_HOST=1`, otherwise `127.0.0.1`.
- `cors()` enabled globally; `express.raw()` (10 MB limit) for image/octet-stream bodies, `express.json()` for JSON bodies.
- All routes mounted under `/api` via `router` from [`server/routes.ts`](./server/routes.ts:1); `errorHandler` registered last.
- Graceful shutdown closes the Postgres pool on `SIGINT`.

### Database (Postgres 16)
- Local dev via [`docker-compose.yml`](./docker-compose.yml:1): service `db` uses `postgres:16-alpine` (container `game_db`), credentials `gameuser` / `gamepass`, database `game_poc`, fixed host port `5432`.
- Healthcheck via `pg_isready`; persistence via named volume `game_db_data`; shared `heroes-network` bridge.
- `docker-compose.yml` also defines `api` (`docker/Dockerfile` → `api-runtime`, `NODE_ENV=production`, port `3001`), `web` (`web-runtime`, `vite preview` at `web:5173`, internal only — it publishes no host port and keeps proxying `/api` to the `api` service), and `gateway` (`nginx:1.27-alpine` with `docker/nginx.conf` bind-mounted at `/etc/nginx/conf.d/default.conf`, publishing host `5173:80` → `web:5173`), plus Adminer on `8080`. The external URL stays `http://<host>:5173`; there is no Dockerfile change and rollback is compose-only. Local dev usually runs only `db:up` and runs api/web on the host.
- Gateway caching: `/assets/**` → `Cache-Control: public, max-age=31536000, immutable`; `/` (index.html) → `no-cache`; `/api/**` → `no-store` + `X-Accel-Buffering: no` with `proxy_buffering off` and a 75s read timeout, so the SSE event stream (`/api/games/:name/events/stream`, 25s heartbeat) is never buffered.
- Server talks to it with the [`pg`](https://www.npmjs.com/package/pg) driver (`pg.Pool`, configured in `server/persistence/db.ts` from `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`).
- `.env` may point `PGHOST` at a shared remote gameserver; DB-backed tests must load `.env.test` **after** `.env`, pinning `PGHOST` to localhost, because `test/smoke.ts` deletes every game except its own fixtures.

---

## 4. Dependencies

From [`package.json`](./package.json:1). Root `dependencies` are hoisted for the server and tooling; the workspace packages have no runtime deps (`@heroes/engine` depends only on `@heroes/contracts`).

### Runtime (`dependencies`)
| Package | Version | Purpose |
|---|---|---|
| `express` | ^5.2.1 | HTTP server / routing |
| `cors` | ^2.8.6 | Cross-origin middleware for the API |
| `pg` | ^8.22.0 | Postgres driver |
| `tsx` | ^4.23.1 | Run `.ts` files directly (server + scripts + tests) |
| `vite` | ^5.4.10 | Client bundler / dev + preview server |

### Dev (`devDependencies`)
| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5.6.3 | Type system / `tsc` |
| `concurrently` | ^9.1.2 | Run web + API together (`npm run dev`) |
| `dependency-cruiser` | ^18.1.1 | Lint cross-boundary import rules for `src/`, `server/`, `packages/` (config: `dependency-cruiser.cjs`); invoked by `npm run lint:deps` |
| `playwright` | ^1.61.1 | Browser automation: smoke/integration/visual tests + sprite generation pipeline |
| `pngjs` | ^7.0.0 | PNG pixel access for the visual-regression diff |
| `puppeteer` | ^25.3.0 | Browser automation used by parts of the sprite pipeline |
| `sharp` | ^0.35.3 | Image processing in sprite tooling |
| `@types/express` | ^5.0.6 | Express 5 typings |
| `@types/cors` | ^2.8.19 | CORS typings |
| `@types/pg` | ^8.20.0 | `pg` typings |

`postinstall` verifies `playwright` resolves and installs the chromium browser (non-fatal on failure).

No CSS framework, no UI framework, no state library, no ORM. Unit tests use Node's built-in `node:test` + `assert/strict`; browser tests use Playwright.

---

## 5. npm scripts

Port allocation is OS-native and cross-platform (`scripts/allocate-ports.ts` uses Node's `net.Server.listen(0)`, so the kernel guarantees a free port on Windows, Linux, and macOS identically).

| Script | Command | Purpose |
|---|---|---|
| `postinstall` | `node -e "require.resolve('playwright')" && playwright install chromium \|\| true` | Ensure the chromium browser exists for tests/tooling |
| `cleanup` | `pwsh scripts/cleanup.ps1` | Kill dev/test processes on this worktree's ports |
| `predev` | `tsx scripts/allocate-ports.ts` | (lifecycle hook) Allocate fresh OS-assigned ports for `dev` |
| `dev` | `concurrently -n web,api -c green,cyan "vite" "tsx watch --env-file=.env server/index.ts"` | Run client (Vite) and API (tsx watch) together, ports from `.env` |
| `dev:web` | `vite` | Client only |
| `dev:api` | `tsx watch --env-file=.env server/index.ts` | API only with watch reload |
| `dev:status` | `pwsh scripts/dev-status.ps1` | Check which services are listening |
| `build` | `tsc && vite build` | Type-check, then produce a production client bundle in `dist/` |
| `preview` | `vite preview` | Serve the built bundle (port from `CLIENT_PORT` in `.env`, default 5173) |
| `db:up` / `db:down` | `docker compose up -d` / `down` | Start/stop Postgres (+ Adminer) |
| `pretest` | `tsx scripts/allocate-ports.ts` | (lifecycle hook) Allocate ports for `test` |
| `test` | `tsx --env-file=.env --env-file=.env.test test/smoke.ts` | End-to-end smoke test (Playwright-driven; spawns API + preview via the `local/.test-request.json` boot contract) |
| `test:smoke` | `tsx scripts/allocate-ports.ts && node --no-deprecation tools/run-test.mjs smoke --auto-close` | Same smoke entry through the wrapper, auto-closing servers |
| `test:multiplayer` | `… tools/run-test.mjs multiplayer` | LAN multiplayer integration test |
| `test:cityview` | `tsx scripts/allocate-ports.ts && tsx --env-file=.env --env-file=.env.test test/cityView.test.ts` | City view integration test |
| `test:visual` | `… tools/run-test.mjs visual --auto-close` | Canvas screenshot-diff gate vs. `test/visual-baselines/` |
| `test:visual:update-baselines` | `… tools/run-test.mjs visual --auto-close --update-baselines` | (Re)write the visual baselines |
| `test:unit` | `tsx --test --test-concurrency=1 …` | Serial `node:test` suites across server, state, charter, persistence, migrations, render, engine, io, logistics, network, combat, AI, core, data, and screens; exact globs are in `package.json` |
| `test:all` | `… tools/run-test.mjs all --auto-close && npm run test:unit` | Eight browser/e2e suites (smoke, multiplayer, cityview, settlements, AI defender, AI charter, log panel, visual), then all unit suites |
| `test:wrapper` | `node --no-deprecation tools/run-test.mjs` | Direct access to the test wrapper |
| `lint:deps` | `depcruise src server packages --config dependency-cruiser.cjs` | Static check of cross-boundary imports (cycles + layering, incl. the workspace packages) |
| `validate-assets` | `node tools/sprites/validate-assets.mjs` | Validate legacy manifest, generated building keys/anchors, and horse run-frame gates |
| `test:scope` | `node tools/test-scope.mjs` | Decide whether a changeset (`--changed <path>` / `--changed-from <git-spec>`) needs tests; prints `TESTS SKIPPED` for docs/agent-only changes, else `TESTS REQUIRED`, and writes `run_tests` to `$GITHUB_OUTPUT` in CI |
| `docs:check` | `node tools/docs-check.mjs` | Check maintained Markdown links/source paths in every mode; `docs:verified` marker age in full mode, or scoped via `DOC_OWNERSHIP` globs in selective mode (`--changed <path>` / `--changed-from <git-spec>`) (no DB) |
| `sprites:generate` | `node tools/sprites/pixel-gen.mjs` | Render pixel-art sprites into `src/resources/` |
| `sprites:preview` | `node tools/sprites/generate-preview.mjs` | Build a sprite contact-sheet preview |
| `assets:seed` | `tsx --env-file=.env scripts/seed-assets.ts` | Seed the `game_assets` table from `src/resources/` |
| `skybox:split` | `tsx scripts/split-skybox-layers.ts` | Split skybox variants into 2/3/4-layer parallax PNGs |
| `migrate:jsonb-to-tables` | `tsx --env-file=.env scripts/migrate-jsonb-to-tables.ts` | One-shot data migration from the legacy jsonb columns to granular tables |

Test scripts pass `--env-file=.env --env-file=.env.test` (`.env.test` last, pinning `PGHOST` to localhost) where they run `tsx` directly; the `tools/run-test.mjs` entries read ports from `.env` and hand them to the test entry via `local/.test-request.json`. `vite` auto-loads `.env` without extra flags.

---

## 6. Frontend architecture (`src/`)

Entry point: [`src/main.ts`](./src/main.ts:1) is a thin bootstrap — it constructs `GameEngine`, imports the `src/screens` side-effect barrel (view registry population), creates + shows `HomeView`, and starts the rAF loop. Composition happens via direct imports and constructor calls; there is no framework.

| Subfolder | Responsibility |
|---|---|
| `src/main.ts` | App bootstrap: `GameEngine` + `HomeView` + rAF loop |
| `src/core/` | Leaf utilities: `hex.ts` (axial hex math), `rng.ts` (Mulberry32 seeded RNG), `cityGrid.ts` (iso city-grid math incl. `computeCityScale`), `eventBus.ts` (**live** typed pub/sub singleton `bus` — `on`/`once`/`off`/`onAny`/`emit`/`emitRaw`/`clear`, per-event payload types resolved via `Extract` on the `GameEvent` union; `emitRaw` is a debug-tooling-only escape hatch; used by 10+ modules — managers, turn controller, mp sync, toasts, dev console, network map), `events.ts` (the complete `GameEvent` catalog: game-state, turn, movement, capture, battle, economy/morale, calc hooks, `command:rejected`, and the seven `mp:*` multiplayer sync events) |
| `src/data/` | Client-side reference data: `unitCatalog.ts` (cache of `GET /api/units`), `heroNames.ts` (recruit name pool), `unitImages.ts` (unit-id → bundled PNG map) |
| `src/debug/` | Dev diagnostics: `devConsole.ts` (persistent dev console modal), `eventLog.ts` (bus/hook event ledger feeding it) |
| `src/entities/` | Domain objects: `hero.ts` (Hero, Faction, Direction), `settlement.ts` (Castle, CastleLevel, CastleVariant) |
| `src/game/` | Game lifecycle: `initState.ts` (build/hydrate initial state; also used server-side by `routes.ts` — the one depcruise exemption), `turnHooks.ts` (fire-and-forget command hooks for the turn controller; rejections surface via `command:rejected` bus → toasts) |
| `src/io/` | External I/O: `api.ts` (typed REST client; cached bearer token; `last_event_id` cursor), `commands.ts` (typed senders for 25 command kinds), `auth.ts` + `authStorage.ts`, `multiplayerSync.ts` (SSE with poll backstop), `userGames.ts`, `assetApi.ts`, `debugCommands.ts` |
| `src/managers/` | Orchestration: `GameEngine.ts` (composer: init phases, rAF `fullFrame()`), `GameStateManager.ts` (state ↔ entities sync), `ViewManager.ts` (renderer + cameras + adventure view), `UIManager.ts` (HUD, toolbar, menus, city view), `GameActions.ts` (end turn, save, hero + settlement-garrison battle flow), `SessionManager.ts` (backend/health/session lifecycle), `GameSessionManager.ts` (new-game/load-game orchestration) |
| `src/map/` | Map generation and traversal: `gameMap.ts`, `terrain.ts`, `pathfinding.ts` (A\* over axial hex grid), `castlePlacement.ts`, `resourceTiles.ts` |
| `src/players/` | `localPlayer.ts` — per-game local player id (localStorage + in-memory fallback) used by mp sync/telemetry |
| `src/render/` | Canvas rendering — see below and [`src/render/docs/technical-spec.md`](./src/render/docs/technical-spec.md) (authoritative; do not duplicate here) |
| `src/resources/` | Static assets: castles (+ alt/FLUX variants and 20 Tier 1 settlement fullness sprites in `src/resources/settlements/` (`settlement-l1-v{0..3}-f{1..5}.png`)), districts (`src/resources/districts/`), resource icon styles, unit/horse sprites (`units/horse/commander-1..10/`), arena unit battle sprites (`units/arena/<unitId>-<pose>.png`), hero-panel unit icons (`units/icons/<unitId>.png`), building style sprites, skybox parallax layers, banners |
| `src/screens/` | All DOM UI, see table below |
| `src/state/` | Game state: `gameState.ts` (typed store + pure reducers incl. charter logic; re-exports shared types from `@heroes/contracts`), `turnController.ts` (turn lifecycle, auto-travel, AI tick, battle trigger, recruitment/garrison transfers, the `tryCaptureAt` capture gate incl. `SETTLEMENT_BATTLE` vs a non-empty garrison), `units.ts` (Platoon/UnitType client model), `playerColors.ts`, `settings.ts` (persisted settings singleton incl. horse variant, resource style, borders, toolbar style) |
| `src/systems/` | Client behavioral system: `movement.ts` (hero arrival hook `onHeroArrived`) |
| `src/ai/` | Compatibility shim re-exporting AI helpers from `@heroes/engine`; authoritative strategy is `packages/engine/src/ai/aiBrain.ts` |
| `src/combat/` | `testArmies.ts` — sandbox army generators for the dev Test Battle setup |
| `src/vite-env.d.ts` | Vite type shims |

### `src/screens/` (UI layer)

Navigation goes through a registry, not cross-imports: each view module calls `registerView("name", opener)` at module load ([`src/screens/shared/viewLauncher.ts`](./src/screens/shared/viewLauncher.ts)); cross-navigation calls `openView("name", opts)` (deferred views are registered with `registerLazyView` and their loader is awaited on first open). [`src/screens/index.ts`](./src/screens/index.ts) is a side-effect barrel that imports every registering module so the registry is fully populated before `main.ts` proceeds (this broke the settings↔dev-settings↔test-battle↔arena import cycle).

| Subfolder | Contents |
|---|---|
| `screens/adventure/` | `adventureView.ts` (canvas input: click/drag/wheel/path preview; exports `MAP_SEED`), `tileInfo.ts` + `tileInfoPanel.ts` (tile inspection incl. fog check) |
| `screens/combat/` | `battleModal.ts`, `battleResultCard.ts`, `platoonInfoPopup.ts`, `testBattleSetup.ts` (dev army-picker screen), `manualBattleArena.ts` (compat shim that keeps the legacy import path + `registerView` side effect), `arena/` (real implementation: `openManualBattleArena.ts`, `view.ts`, `state.ts`, `input.ts`, `ai.ts`, `layout.ts`, `constants.ts`, `leaveBehind.ts`, `paint.ts`, `index.ts`) |
| `screens/debug/` | `networkMap.ts` (dev multiplayer topology map; consumes `mp:topologyUpdated` bus events) |
| `screens/heroes/` | `heroInfoMenu.ts`, `heroRosterMenu.ts` |
| `screens/home/` | `homeView.ts` (landing overlay: new/load/sign-in), `newGameScreen.ts`, `settingsMenu.ts`, `developerSettingsMenu.ts`, `assetManager.ts` (custom asset upload UI) |
| `screens/multiplayer/` | `multiplayerLobby.ts` (seat claim/start UI) |
| `screens/settlements/` | `cityView/` (`cityView.ts`, `buildingPlacer.ts`, `buildingMenu.ts` — per-building popup with generic minLevel-filtered recruit rows (quantity picker + live cost), `buildingSelectionMenu.ts`, `CityDesignBoxManager.ts` — style/pattern switching, `buildListSections.ts` — palette build-list sectioning (Troop Buildings/Production/Civilian), `buildEntryStatus.ts` — pure disabled-reason tooltips (palette rows + Confirm cart)), `settlementInfoMenu.ts` (incl. the Garrison accordion with per-type → Hero / → Garrison transfer buttons; auto-expands Warehouse + Garrison on city entry — the Banking accordion is **collapsed by default** and is *not* in that force-expand set), `settlementRosterMenu.ts` |
| `screens/shared/` | `viewLauncher.ts` (registry), `hud.ts`, `toolbar.ts`, `menu.ts`, `panelRail.ts` (docked-panel geometry), `toast.ts` (`attachCommandFailureToasts()` — surfaces rejected fire-and-forget commands, #100), `confirmDialog.ts` |

### Rendering model

The scene-graph pipeline is **live** — it draws every frame on all three views:

- `src/render/renderer.ts` (`MapRenderer`) is an orchestrator: background fill → `computeVision()` (fog) → `buildAdventureScene()` (`scene/sceneBuilder/adventureScene.ts`) → `camera.apply(ctx)` + `paintScene()` (`scene/paint2d/`) → `drawMinimap()` outside the camera transform. It receives an `EntityMirror` (`scene/entityMirror.ts`, issue #180 step 1) and exposes `getMirror()`.
- City view: `CityView` builds nodes via `buildCityScene()` and its own `Paint2DDep` (holding the `SkyboxProvider`); `src/render/cityRenderer.ts` is just `ctx.save` → `lineJoin = "miter"` → `paintScene()` → `ctx.restore`.
- Battle arena: `src/screens/combat/arena/paint.ts` runs `buildBattleScene()` + `paintScene()` — the scenebuilder path is the arena default since the 2026-09-29 arena unit sprites; `?paint=legacy` opts back to the legacy in-class draw path.
- `scene/entityMirror.ts` (`EntityMirror`) is the Hero/Castle tween cache fed by the multiplayer event stream (`getEntityMirror()` from `src/io/multiplayerSync.ts` → `GameEngine` → `ViewManager.initializeRenderer()` → `MapRenderer`).
- **Fog of war is live**: `src/render/fog.ts` `computeVision()` unions hero vision rings (`VISION_RANGE = 4`) with owned-castle rings (`controlRange(level, buildings)` from `@heroes/engine`); consumed by the renderer, the minimap, and single-tile tile inspection (`isTileVisibleTo()` in `screens/adventure/tileInfo.ts`).
- `Paint2DDep` (`scene/paint2d/deps.ts`) is the painter's whole external surface — per-kind sprite resolvers (`resolveSpriteForResource/Hero/Building/Castle/Unit` plus optional `resolveSpriteForCaravan` and `resolveSpriteForDistrict`; `resolveSpriteForCastle(level, variant, fullness?)` resolves `castle.1.v${variant}.f${fullness ?? 1}` for level-1 settlements using `settlementFullnessForCount(count)` in `src/render/scene/sceneBuilder/adventureScene.ts`: Fullness 1: 0–3 buildings, Fullness 2: 4–6, Fullness 3: 7–9, Fullness 4: 10–12, Fullness 5: 13+; `resolveSpriteForUnit` serves the battle arena's `unit.<id>.<pose>` art); `src/render/paint2dDefaults.ts` is the **only** file allowed to touch `assetDescriptors.ts`/`assets.ts`/`sprites.ts` (the Vite-`?url`-coupled modules) and to value-import `state/settings.ts` — enforced by dependency-cruiser rules plus a runtime seam test. `src/render/skybox.ts` is the only holder of the `?url` skybox PNG imports + layer caches.
- Hero/castle sprites load via a `SpriteProvider` (`createDefaultProvider(HERO_PROCEDURAL_DRAWERS)`); PNGs in `src/resources/` take priority, procedural canvases are the fallback.

### State / persistence
- `GameState` (shape in `@heroes/contracts`; store + reducers in `src/state/gameState.ts`) is the authoritative in-memory state, marked with `markSaved()` after API sync.
- Mutations run as local engine reducers first, then mirror to the server as commands: `src/game/turnHooks.ts` fires the matching command from `src/io/commands.ts` against `POST /api/games/:name/commands`; rejections emit `command:rejected` on the bus → toast (#100).
- In multiplayer, `MultiplayerSync` (below) is the reconciliation path; `EntityMirror` tweens hero/castle visuals off the event stream between full syncs.
- `src/io/userGames.ts` keeps a localStorage index of the player's games; `src/players/localPlayer.ts` tracks which seat this client holds per game.
- Seeded determinism via Mulberry32 (`src/core/rng.ts`); the smoke test asserts identical maps across runs.

---

## 7. Backend architecture (`server/`)

| File | Role |
|---|---|
| `server/index.ts` | Express bootstrap: `cors`, `express.raw` (10 MB images), `express.json`, `/api` router, `errorHandler` last; calls `initSchema()` before listening; binds per `LAN_HOST` |
| `server/routes.ts` | Remaining `/api` routes: `/health`, `/units`, games CRUD, `/games/:name/validate` (engine integrity check), lobby `claim`/`start` (claim supports the drop policy's email-bound rejoin reclaim on started games), tiles, events log (`GET /games/:name/events?after=<id>` cursor poll; `POST` appends audit events). Mounts the four sub-routers: `assetRouter` at `/assets`, `authRouter` at `/auth`, `commandsRouter` at `/games/:name/commands`, `telemetryRouter` at `/games/:name/telemetry`. `GET /games/:name` returns the row plus `last_event_id` (snapshot + cursor read in one statement, #146) and lobby seat availability (incl. `lobby.presence`) |
| `server/auth.ts` | Email magic-link auth: `POST /auth/request-code`, `POST /auth/verify-code`, `GET /auth/session`, `POST /auth/logout`. 6-digit codes SHA-256 hashed (salted with the email) into `auth_codes` with a 10-minute TTL; `user_sessions` bearer tokens with a 30-day rolling expiry (`last_seen_at` refresh). When `NODE_ENV !== "production"` the code is also returned as `devCode` so the flow works without SMTP. Exports `attachAuth` middleware — **sign-in is optional; it never rejects a request**, it just sets `req.authEmail` |
| `server/middleware/attachPlayerSeat.ts` | After `attachAuth`: if the caller is signed in and has claimed a lobby seat whose `email` matches (seat claims are email-bound server-side; anonymous claims allowed), sets `req.playerSeat`. 5-second in-process membership cache; `invalidateMembershipCache()` exported for the claim route |
| `server/http/routes/commands.ts` | `POST /games/:name/commands` — `parseCommand()` validates all **25** command kinds, including `EnterBattle`, then dispatches through `handleCommandTransactional()`. It runs `attachAuth` + `attachPlayerSeat`, rejects authenticated actor/seat mismatches, records valid commands as presence heartbeats, and returns applied events plus the cursor and affected entities |
| `server/app/commandHandler.ts` | Command-bus core: loads the game row via `GameRepo`, enforces turn-ownership/authority guards, runs the matching `@heroes/engine` reducer (`turnService.ts` for `EndTurn`), appends `EngineEvent`s via `EventRepo`, persists via the granular repos, returns a `CommandResult` (incl. `lastEventId`). `createLiveCommandDeps()` wires the real Postgres-backed repos (async — pre-reads `unit_types` for the battle catalog). `handleCommandTransactional()` wraps a command in a pool transaction. EndTurn dual-writes `charters` and inserts settlement snapshots + auto-trade `resource_transactions` rows. The recruitment/garrison commands (`RecruitUnits`/`TransferUnits`/`SubmitSettlementBattleResult`) run the engine's settlement reducers behind full validation ladders; `CaptureSettlement` rejects a non-empty garrison (`garrison_not_defeated`), and `SubmitBattleResult`/`ResolveBattle` capture an enemy settlement when the victorious attacker stands on it with an emptied garrison. Also exports the drop policy's service-level entry `runServerEndTurnForSeat()` (server-internal EndTurn for a disconnected seat — same pipeline, plus a `turn_skipped` audit event; see `server/app/dropPolicy.ts`) |
| `packages/contracts/src/events/engineEvent.ts` + `packages/engine/src/events/applyEvent.ts` | The `EngineEvent` union has 25 variants. `ENGINE_EVENT_SYNC_CLASS` classifies 12 as apply, 7 as resync, and 6 as ignore. |
| `server/app/turnService.ts` | `runEndTurn()` composes `applyEndOfTurnDetailed` → `endTurn` → `advanceRound`; `clampGrowthRate()` bounds the growth rate. Human charter travel is client-commanded; server-driven AI chartering is orchestrated by `aiDriver.ts`. |
| `server/app/aiDriver.ts` | Drives flagged AI seats: garrison recruitment, up to three accepted trade recommendations, charter start/travel, movement, battles, capture, and turn end. Per-game advisory locks serialize work; boot tokens and heartbeats support multi-process ownership and stale-driver recovery. |
| `server/app/aiDriverToken.ts` | Per-process AI-driver boot token used to distinguish current ownership from stale server instances. |
| `server/persistence/db.ts` | `pg.Pool` + `withTransaction()` configured from `PG*` env vars; the single pool instance (re-exported by `server/db.ts`) |
| `server/db.ts` | `initSchema()` — runs `schema.sql` then any pending `server/migrations/*.sql` in filename order; re-exports the pool |
| `server/persistence/repositories/` | Granular Postgres repos: `gameRepo.ts` (load/save incl. snapshot + transaction inserts), `eventRepo.ts` (`game_events` append with `actor_seat`), `heroRepo.ts`, `settlementRepo.ts` (dual-writes `settlement_platoons` alongside the settlement row and persists `settlements.districts` JSONB), `charterRepo.ts`, `tileRepo.ts` |
| `server/persistence/hydrate.ts` | `hydrateFromRepos()` — reassembles a full `HydratableGameRow` from the granular tables for the command bus, incl. hero platoons (`hero_platoons`) and settlement garrisons (`settlement_platoons`) |
| `server/assetRoutes.ts` | `/assets` router: custom player-uploaded assets stored in `game_assets` (metadata + bytes), served with MIME types |
| `server/http/routes/telemetry.ts` | `POST`/`GET /games/:name/telemetry` — the dev Network Map data plane (#51) plus the drop-policy heartbeat: `POST` records the sample in `presenceRegistry` **and** `touchSeat`s the enforcement-grade presence (`server/app/dropPolicy.ts`); it answers `200` with `{ presence }` (the per-seat connected/disconnected view) so the client's per-poll call doubles as the presence read — was `204` before 2026-09-27 |
| `server/telemetry/presenceRegistry.ts` | In-memory per-process presence: records client samples, derives link status, builds topology snapshots. **Dev Network Map only** — the enforcement-grade seat presence (60s detection, games-row persistence, turn skip) lives in `server/app/dropPolicy.ts` |
| `server/app/dropPolicy.ts` | Drop policy (shipped 2026-09-27, spec in `docs/multiplayer.md`): per-seat last-seen heartbeat map (telemetry POSTs + valid commands), `DISCONNECT_AFTER_MS = 60_000` disconnect detection flushed transition-only into `games.lobby.presence`, and the skip lifecycle — `SKIP_GRACE_MS = 120_000` grace timer for a disconnected seat holding `active_player_id`, canceled by any heartbeat; on expiry re-validates against the live row, holds (5s re-checks) while `phase.kind === "BATTLE"`, then runs `runServerEndTurnForSeat`. 5s in-process scanner started from `server/index.ts`; everything is in-process (an API restart restarts a grace clock — accepted). Timings/seams injectable via `configureDropPolicy()` for tests |
| `server/errorHandler.ts` | Global Express error middleware (#98), registered last — normalizes anything that escapes a route to `{ error: "internal", message }` JSON |
| `server/schema.sql` | Base schema |
| `server/migrations/` | 29 ordered migrations (`001`–`029`); see §2 for the current sequence and notable schema steps. |

Lobby state lives in the `games.lobby` jsonb column: `{ seats, humanSlots, claimed: { "<seat>": { handle, email?, claimedAt } }, startedAt, presence?: { "<seat>": { lastSeenAt, connected } } }`. Seat claims are bound to the **server-derived** auth email when the caller was signed in at claim time; anonymous claims remain valid (issue #179 follow-up) — the email only enables the commands route's optional actor-vs-seat binding. Since the 2026-09-27 drop policy, a STARTED game's email-bound seat can also be **reclaimed** by the same identity via the claim route (handle-only seats cannot rebind; new seats stay unclaimable after start), and `presence` carries the per-seat connected/disconnected signal written transition-only by `server/app/dropPolicy.ts` (never per 2s heartbeat).

API conventions:
- JSON in/out.
- CORS open (default `cors()` middleware, no origin allowlist configured).
- Auth is **optional everywhere**: `attachAuth`/`attachPlayerSeat` enrich the request when a valid bearer token + seat claim exist, and never reject; there is no route that requires sign-in.
- Port read from `API_PORT` env var (written by `scripts/allocate-ports.ts` into `.env`), default `3001`.
- Multiplayer sync read model: `GET /games/:name` seeds a fresh client with state + `last_event_id`; `GET /games/:name/events?after=<id>` pages strictly-monotonic `game_events.id`s (with `actor_seat` so clients can skip their own); command responses carry `lastEventId` to advance the cursor past self-caused events.
- Errors: anything not caught by a route's own try/catch is normalized to `{ error: "internal", message }` by `server/errorHandler.ts` (#98).

---

## 8. Testing & QA

- **Frameworks**: Node's built-in `node:test` + `assert/strict` for unit tests (`npm run test:unit`), Playwright (`chromium`) for browser-driven suites.
- **Wired unit suites** (`test:unit`) run serially and include `test/server/`, `test/state/`, `test/charter/`, `test/persistence/`, `test/migrations/`, `test/render/`, `test/engine/`, `test/io/`, `test/logistics-bugs/`, `test/net/`, `test/combat/`, `test/ai/`, `test/core/`, `test/data/`, and `test/screens/`; `package.json` is the exact glob source.
- **Smoke test**: [`test/smoke.ts`](./test/smoke.ts:1) (`npm test`).
  - Reads its boot contract from `local/.test-request.json` and spawns the API + `vite preview` via `test/_request.ts`.
  - Uses Playwright to load the built app, talks to the API via Playwright's `request` API and via `pg.Pool`, asserts map determinism (same seed → same resource placement), then exercises the live UI.
  - Deletes every game in the database except its own fixtures — hence the `.env.test` `PGHOST` pin described in §3.
  - Supports `--shutdownAfterSeconds=<n>` (hard tree-kill after *n* seconds; CI safety) and `--auto-close` (tree-kill API/preview on exit so ports release immediately; used by the `test:*` wrapper entries).
- The browser/e2e entries are smoke, multiplayer, city view, settlements, AI defender, AI charter, log panel, and visual regression. The visual gate captures nine baseline scenes and pixel-diffs them against `test/visual-baselines/`.
- **Shared wrapper**: [`tools/run-test.mjs`](./tools/run-test.mjs:1) writes the per-run request file (`runId`, entry, ports, `autoClose`, `shutdownAfterMs`) to `local/.test-request.json` (gitignored, under `local/`, never committed), then launches the entry. `all` runs smoke → multiplayer → cityview → settlements → AI defender → AI charter → log panel → visual, followed by `test:unit`. [`test/_request.ts`](./test/_request.ts:1) exposes the shared boot helpers (request URL, health-check wait, tree-kill on exit, straggler reaping via the previous run's PID ledger).
- Logs from previous runs land at `test/*.log` / `test/*.err.log`; screenshots at `test/screenshot*.png`; PID ledger at `local/.test-request.json` / `test/.last-test-pids.json`.
- Legacy helper: `tools/run-smoke.ps1` (PowerShell convenience wrapper) still exists beside the cross-platform `tools/run-test.mjs`.

### CI (GitHub Actions)

[`.github/workflows/validate-game.yml`](./.github/workflows/validate-game.yml:1) runs on every PR (`concurrency` group cancels superseded runs): Node 22.x on `ubuntu-latest` with a Postgres 16 service container. Steps: `npm install` → `docs:check (freshness scoped to changed modules; BASE_REF vs PR base, full on dispatch)` → test scope (`tools/test-scope.mjs` against the PR base; docs/agent-only PRs skip the Playwright install, boot check and smoke test) → `npx playwright install chromium --with-deps` → boot check (`npm run dev` in the background; waits up to 60 s for `CLIENT_PORT`/`API_PORT` in `.env`, then polls `/api/health` + client) → dump boot log → `rm -f .env` (fresh allocation for the smoke run) → `npm run build` → `npm test` → upload `test/*.log` + `test/*.png` artifacts. The whole pipeline is Linux-native; `scripts/allocate-ports.ts` needs no OS-specific handling.

---

## 9. Tooling & asset pipeline

### Sprite generation (`tools/sprites/`)
- [`tools/sprites/pixel-gen.mjs`](./tools/sprites/pixel-gen.mjs:1) (Playwright `chromium`) renders the pixel-art sprites from [`tools/sprites/pixel-art.html`](./tools/sprites/pixel-art.html) (a `<canvas>` drawing page) into `src/resources/`.
- `tools/sprites/manifest.mjs` is the sprite-filename registry consumed by the generator scripts and `validate-assets.mjs`.
- The `flux-*.mjs` family calls the DeepInfra API (`black-forest-labs/FLUX-2-klein-4b`, requires `DEEPINFRA_API_KEY`) and post-processes via Playwright canvases (downscale → alpha mask → 2px outline → white-to-alpha): `flux-gen.mjs` (illustrated/constellation/crest resource variants), `flux-piles.mjs` / `flux-pile-smol.mjs` / `flux-bubbly.mjs` (pile variants), `flux-buildings.mjs` + per-building follow-ups (classic style buildings), `flux-castles.mjs` (castle alt variants), `flux-hero-diagonals.mjs` (8-direction player hero), `flux-skybox.mjs` (1024×576 watercolor skyboxes, variants 2–4), plus regen/retry scripts.
- `tools/sprites/generate-preview.mjs` builds a contact sheet; `screenshot-preview.mjs` supports screenshot-based previews; `outline-apply.mjs` applies outlines; `validate-assets.mjs` checks `src/resources/` against the manifest (`npm run validate-assets`).

### Skybox pipeline
- City-view parallax skyboxes: FLUX-generated variants 1–4 in `src/resources/skybox/`.
- [`scripts/split-skybox-layers.ts`](./scripts/split-skybox-layers.ts:1) (`npm run skybox:split`) slices each variant into 2/3/4-layer depth breakdowns (18% feathered alpha transitions; bands overlap ~10% so composited layers don't seam), producing `cityView-background-variant<n>-layer<m>.png`.
- Runtime layer-band/speed constants live in `src/render/skybox.ts` (`LAYER_BANDS`, `PARALLAX_SPEEDS`).

### Server data tooling (`scripts/`)
- `allocate-ports.ts` (ports, §10), `cleanup.ps1`, `dev-status.ps1` (process helpers), `seed-assets.ts` (`assets:seed`), `migrate-jsonb-to-tables.ts` (legacy jsonb → granular tables), plus image-processing helpers (`batch_remove_background.ps1`, `remove_background.py`, `capture-path.ts`).

### Editor / static checks
- No formatter or Git hook is configured (no `.prettierrc*`, no Husky); the pre-commit gate runs agent-side via the `precommit-checker` subagent (see AGENTS.md) and in CI (`.github/workflows/validate-game.yml`).
- Enforced checks: `npm run build` (`tsc`), `npm run lint:deps` (dependency-cruiser layering rules, §11), and `node tools/docs-check.mjs --changed-from origin/main` (documentation gate, below).

### Documentation checks (`tools/docs-check.mjs`)
- Scans the 20-file `MAINTAINED_DOCS` allowlist: every local link resolves, every mentioned `src|server|packages|test|tools|scripts` path exists (gitignored paths exempt), and each doc carries exactly one `<!-- docs:verified YYYY-MM-DD -->` marker at most `MAX_AGE_DAYS = 180` days old.
- Full mode (no arguments) enforces marker age on all maintained docs. Selective mode (`--changed <path>`... or `--changed-from <git-spec>`, which unions committed-since-spec, staged/unstaged, and untracked files) enforces marker age only for docs whose `DOC_OWNERSHIP` globs match a changed file, plus any maintained doc itself present in the changeset — so a change only asks for fresh verification of the docs that cover it.
- Gate wiring: the pre-commit gate runs it with `--changed-from origin/main`; the validate workflow runs it against the PR base (`origin/<base>...HEAD`) on pull requests and full otherwise; a dedicated workflow (`.github/workflows/docs-check.yml`) runs full mode on pushes to main and weekly, so marker expiry and link rot surface on main itself. Invalid `--changed-from` specs fail with exit 2 (fail closed).

---

## 10. Ports & local services

| Port | Service | How |
|---|---|---|
| Dynamic | Vite dev server (client + HMR) | `CLIENT_PORT` in `.env`, allocated by `scripts/allocate-ports.ts` |
| Dynamic | API (Express) | `API_PORT` in `.env`, allocated by `scripts/allocate-ports.ts` |
| Dynamic | WebSocket | `WS_PORT` in `.env`, allocated by `scripts/allocate-ports.ts` (**reserved/dormant** — no listener yet) |
| `5432` | Postgres | `npm run db:up` (docker compose, fixed shared port) |
| `8080` | Adminer (DB UI) | `npm run db:up` |
| `3001` / `5173` | API container / `web` container (`nginx`) | Fixed mappings when running the full `docker compose` stack (`game_web` publishes `5173:80` directly and proxies `/api/*` to `api:3001`; redeploy via `npm run docker:build && docker compose up -d --remove-orphans api web`) |

`scripts/allocate-ports.ts` allocates free ports at dev/test startup (via npm `predev`/`pretest` hooks) and writes `API_PORT`, `CLIENT_PORT`, `WS_PORT` to `.env`. It uses Node's `net.Server.listen(0)` to ask the kernel for a free port — the same mechanism on Windows, Linux, and macOS — so allocations are collision-free across concurrent worktrees. It never allocates the DB port (`server/persistence/db.ts` reads only `PG*` vars).

Vite auto-loads `.env`; `tsx` processes use `--env-file=.env`. Both Vite servers bind `0.0.0.0` and proxy `/api/*` to `http://<API_HOST>:<API_PORT>` (default `127.0.0.1`), so the client always calls relative `/api/...` URLs. Setting `LAN_HOST=1` before `npm run dev` binds the API to `0.0.0.0` for LAN multiplayer; `npm run dev:status` prints the LAN URLs.

---

## 11. Conventions

- ESM everywhere; no `require()` in source.
- Strict TypeScript; unused locals/parameters are build errors.
- **Workspace layering (machine-enforced by `dependency-cruiser.cjs`, error severity, incl. `no-circular`)**:
  - `@heroes/contracts` is a leaf — zero dependencies on engine/client/server.
  - `@heroes/engine` may depend on `@heroes/contracts` only, never on `src/` or `server/`.
  - `server/` never imports `src/` — the single documented exemption is `server/routes.ts` → `src/game/initState.ts` (`makeInitialStatePayload`).
  - `src/core/` is leaf-only for value imports (types allowed).
  - `src/render/` never imports `src/systems/` or `src/screens/`; `src/state/`, `src/entities/` never value-import render/screens; `src/screens/` never imports `src/managers/`.
  - `server/http/` and `server/app/` (except `commandHandler.ts` itself) never import `server/persistence/repositories/` directly.
  - `src/render/scene/paint2d/` cannot import the Vite-coupled asset modules or value-import `state/settings` — `paint2dDefaults.ts` and `skybox.ts` (outside `paint2d/`) are the only files allowed to touch those.
- Domain types live in `@heroes/contracts` when they cross the client/server boundary (`GameState`, `HeroState`, `SettlementState`, `CharterState`, commands, `EngineEvent`s, `Axial`, ids, resources, units, telemetry); engine rules and their helpers live in `@heroes/engine`. There is no top-level `shared/` directory anymore.
- View navigation goes through the `src/screens/shared/viewLauncher.ts` registry (`registerView`/`registerLazyView`/`openView`), populated by the `src/screens/index.ts` side-effect barrel — not direct cross-imports between view files.
- Cross-cutting render types (`RenderOptions`, `MinimapGeometry`) live in `src/render/renderTypes.ts`; the `MinimapCamera` class lives in `src/render/minimapCamera.ts`.
- Axial hex coordinates (`Axial`) are the universal map primitive; `axialToPixel` bridges to screen space.
- All randomness goes through Mulberry32 with an explicit seed for determinism — the smoke test relies on this.
- No secrets in source; DB credentials live only in `docker-compose.yml` / `.env` for local development. Nothing under `local/` is ever committed.
- Asset files ship under `src/resources/` so Vite can bundle them; `assetsInlineLimit: 0` keeps them as separate files.

### Current Caveats

- Market `goldPerTurn` is declared and included in `effectiveSettlementIncome()` projections, but End Turn currently credits `producerTurnOutput` plus morale-scaled tax; market income is not paid to the treasury. This remains open as finding F2 in [`docs/resource-gathering.md`](./docs/resource-gathering.md).
- Real email delivery for sign-in codes is not configured; development exposes the code for testing.
- `WS_PORT` is allocated but no realtime layer listens on it; multiplayer updates use SSE with polling as a backstop.
- Spellcasting, morale/fatigue, recruitment, weekly upkeep, and hero/garrison battle outcomes are implemented; their plan documents are historical status records, not proof of remaining work.
