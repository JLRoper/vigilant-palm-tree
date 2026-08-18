# Technical Specifications — heroes-js

A turn-based, hex-grid adventure game inspired by *Heroes of Might & Magic*. This document captures the **tech stack** as it currently exists in the repository. Game design documentation lives under [`docs/`](./docs/README.md).

---

## 1. Project shape

| Aspect | Value |
|---|---|
| Project name | `heroes-js` (also referenced as `vigilant-palm-tree` in `README.md`) |
| Version | `0.2.0` |
| Package type | ESM (`"type": "module"`) |
| Repo layout | Monorepo-style single repo, **no framework workspace tooling** |
| Languages | TypeScript (primary), plain JavaScript `.mjs` (sprite tooling), SQL (migrations), HTML/CSS (UI shell) |
| License | Not declared |

Top-level directories:

- `src/` — game client (TypeScript, run in the browser via Vite)
- `server/` — backend API (TypeScript, run via `tsx`)
- `test/` — smoke test harness + unit tests (`tsx test/smoke.ts`)
- `tools/` — build/sprite scripts (Node + Playwright)
- `docs/` — game design documents (Markdown)
- `dist/` — Vite build output
- `src/resources/` — baked-in sprite PNGs/SVGs (castles, resource icons, skybox parallax layers)
- `docker-compose.yml` — local Postgres + Adminer

---

## 2. Languages & build

### TypeScript
- Configured in [`tsconfig.json`](./tsconfig.json).
- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`.
- `lib`: `ES2022`, `DOM`, `DOM.Iterable` (client is a browser app).
- Strict mode on: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`.
- `noEmit: true` — Vite/tsx handle transformation, the CLI `tsc` step in `npm run build` is purely type-checking.
- TS is only configured for `src/`; the server and tests are type-checked by `tsx` at runtime rather than by `tsc` in the default config.

### Vite (client bundler)
- [`vite.config.ts`](./vite.config.ts) — Vite 5.
- `assetsInlineLimit: 0` — all assets are emitted as separate files (no base64 inlining).
- Dev server: port `5173`, proxies `/api/*` → `http://localhost:3001`.
- Preview server: port `4173`, same `/api` proxy.
- Entry HTML: [`index.html`](./index.html), loads `src/main.ts` as an ES module.
- HTML mounts a full-viewport `<canvas id="game">`, a `#hud` overlay, and a `#toolbar` slot.

### JavaScript (Node ESM, `.mjs`)
- Used for tooling scripts in `tools/sprites/` and root-level `pixel-gen.mjs`.
- No CommonJS anywhere in the project; everything is ESM.

### SQL
- [`server/schema.sql`](./server/schema.sql) — baseline schema.
- [`server/migrations/`](./server/migrations) — versioned migrations (e.g. `001_turn_state.sql`).
- Applied at startup by `initSchema()` in [`server/db.ts`](./server/db.ts:1).

---

## 3. Runtime environments

### Client (browser)
- Plain HTML + TypeScript; **no SPA framework** (no React/Vue/Svelte/Angular).
- Rendering is done on `<canvas>` (2D context implied by usage), not via DOM/JSX.
- UI overlays (HUD, toolbar, menus, modals) are plain DOM elements styled via inline CSS in `index.html` plus per-view TS in `src/views/`.

### Server (Node.js)
- [`server/index.ts`](./server/index.ts:1) boots Express 5 on `API_PORT` (loaded from `.env` by `scripts/allocate-ports.ts`, default `3001`).
- `cors()` middleware enabled globally; `express.raw()` for image/octet-stream bodies, `express.json()` for JSON bodies.
- All routes mounted under `/api` via `router` from [`server/routes.ts`](./server/routes.ts:1).
- Graceful shutdown closes the Postgres pool on `SIGINT`.

### Database (Postgres 16)
- Run locally via [`docker-compose.yml`](./docker-compose.yml:1): service `db` uses `postgres:16-alpine`.
- Credentials: `gameuser` / `gamepass`, database `game_poc`, exposed on `localhost:5432`.
- Healthcheck via `pg_isready`.
- Adminer (DB admin UI) exposed on `localhost:8080`.
- Persistence via named Docker volume `game_db_data`.
- Server talks to it with the [`pg`](https://www.npmjs.com/package/pg) driver (`pg.Pool`).

---

## 4. Dependencies

From [`package.json`](./package.json:1).

### Runtime (`dependencies`)
| Package | Version | Purpose |
|---|---|---|
| `express` | ^5.2.1 | HTTP server / routing |
| `cors` | ^2.8.6 | Cross-origin middleware for the API |
| `pg` | ^8.22.0 | Postgres driver |

### Dev (`devDependencies`)
| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5.6.3 | Type system / `tsc` |
| `vite` | ^5.4.10 | Client bundler / dev server |
| `tsx` | ^4.23.1 | Run `.ts` files directly (server + tests) with watch mode |
| `concurrently` | ^9.1.2 | Run web + API together (`npm run dev`) |
| `dependency-cruiser` | ^18.1.1 | Lint cross-boundary import rules for `src/`, `shared/`, `server/` (config: `dependency-cruiser.cjs`); invoked by `npm run lint:deps` |
| `playwright` | ^1.61.1 | Browser automation: smoke tests + sprite generation pipeline |
| `@types/express` | ^5.0.6 | Express 5 typings |
| `@types/cors` | ^2.8.19 | CORS typings |
| `@types/pg` | ^8.20.0 | `pg` typings |

No CSS framework, no UI framework, no state library, no ORM, no testing framework beyond Node's built-in `assert/strict`.

---

## 5. npm scripts

Port allocation is OS-native and cross-platform (`scripts/allocate-ports.ts` uses Node's `net.Server.listen(0)`, so the kernel guarantees a free port on Windows, Linux, and macOS identically — no PowerShell needed). One helper script remains for process management.

| Script | Command | Purpose |
|---|---|---|
| `cleanup` | `pwsh scripts/cleanup.ps1` | Kill dev/test processes on this worktree's ports |
| `dev:status` | `pwsh scripts/dev-status.ps1` | Check which services are listening |
| `predev` | `tsx scripts/allocate-ports.ts` | (lifecycle hook) Allocate fresh OS-assigned ports for `dev` |
| `dev` | `concurrently -n web,api -c green,cyan "vite" "tsx watch --env-file=.env server/index.ts"` | Run client (Vite) and API (tsx watch) together, ports from `.env` |
| `dev:web` | `vite` | Client only |
| `dev:api` | `tsx watch --env-file=.env server/index.ts` | API only with watch reload |
| `build` | `tsc && vite build` | Type-check, then produce a production client bundle in `dist/` |
| `preview` | `vite preview` | Serve the built bundle (port from `CLIENT_PORT` in `.env`, default 5173) |
| `db:up` | `docker compose up -d` | Start Postgres + Adminer |
| `db:down` | `docker compose down` | Stop them |
| `pretest` | `tsx scripts/allocate-ports.ts` | (lifecycle hook) Allocate ports for `test` |
| `test` | `node tools/run-test.mjs smoke` | End-to-end smoke test (spawns API + preview, drives with Playwright) |
| `test:cityview` | `node tools/run-test.mjs cityview` | City view integration test |
| `test:all` | `node tools/run-test.mjs all` | Full test suite (smoke + multiplayer + cityView) |
| `lint:deps` | `depcruise src shared server --config dependency-cruiser.cjs` | Static check of cross-boundary imports (catches cycles and out-of-bounds deps between `src/`, `shared/`, and `server/`) |
| `sprites:generate` | `node tools/sprites/pixel-gen.mjs` | Render pixel-art castle sprites into `src/resources/` |
| `sprites:preview` | `node tools/sprites/generate-preview.mjs` | Build a sprite contact-sheet preview |
| `skybox:split` | `tsx scripts/split-skybox-layers.ts` | Split all skybox variants into parallax layer PNGs (2/3/4-layer breakdowns, 18% feathered blends) |

All server-side scripts (`dev:api`, `dev`, `test`, `test:*`)** pass `--env-file=.env`** to `tsx` so the dynamically allocated ports are available to the runtime. `vite` auto-loads `.env` without extra flags.

---

## 6. Frontend architecture (`src/`)

Entry point: [`src/main.ts`](./src/main.ts:1) wires modules together. There is no framework — composition happens via direct imports and constructor calls.

| Subfolder | Responsibility |
|---|---|
| `src/main.ts` | App bootstrap: instantiate map, camera, renderer, sprite provider, controllers, HUD, toolbar, panels |
| `src/core/` | Pure utilities: `hex.ts` (axial hex math), `rng.ts` (Mulberry32 seeded RNG), `cityGrid.ts` (city view layout), `citySpots.ts` (mine generation) |
| `src/entities/` | Domain objects: `hero.ts`, `settlement.ts` (Castle) |
| `src/map/` | Map generation and traversal: `gameMap.ts`, `terrain.ts`, `pathfinding.ts` (A\* over axial hex grid), `castlePlacement.ts`, `resourceTiles.ts` |
| `src/resources/` | Static asset images (`castle-l1/l2/l3.png` + `.svg`, resource icons) |
| `src/render/` | Canvas rendering: `renderer.ts` (now exports `MapRenderer`, an orchestrator that delegates per-frame drawing to `painter/`), `painter/` (per-kind classes: `BackgroundPainter`, `HexTerrainPainter`, `HexHoverPainter`, `HeroPainter`, `CastlePainter`, `CharterPainter`), `decorationSeed.ts` (pure helper used by `HexTerrainPainter`), `camera.ts` (pan/zoom), `fog.ts`, `sprites.ts` (procedural hero drawers), `heroSprites.ts`, `assets.ts` (sprite provider), `assetSource.ts`, `assetDescriptors.ts`, `overlays/`, `scene/` (Phase 5 Track B, in progress: pure `GameState -> SceneNode[]` scene builders + a future Canvas2D painter — not wired into live rendering yet, see `src/render/docs/technical-spec.md` §7) |
| `src/managers/` | Orchestration between state, views, and I/O: `GameEngine.ts` (composer), `GameStateManager.ts` (state ↔ entities sync), `ViewManager.ts` (renderer + camera + adventure view), `UIManager.ts` (HUD, toolbar, menus, city view), `GameActions.ts` (end turn, save, battle flow), `SessionManager.ts` (game session lifecycle), `GameSessionManager.ts` (save/load orchestration) |
| `src/state/` | Game state: `gameState.ts` (typed store + all pure reducers including charter settlement logic), `turnController.ts` (turn lifecycle, auto-travel, AI tick), `units.ts`, `playerColors.ts`, `settings.ts` |
| `src/game/` | Game lifecycle: `initState.ts` (build/hydrate initial state), `turnHooks.ts` |
| `src/economy/` | Per-turn economy: `income.ts`, `settlementRates.ts`, `consumption.ts` |
| `src/systems/` | Behavioral systems: `enemyWander.ts` |
| `src/ai/` | AI: `aiBrain.ts` |
| `src/io/` | External I/O: `api.ts` (typed REST client), `userGames.ts` (local saved-games bookkeeping), `debugCommands.ts` |
| `src/views/` | DOM UI: `hud.ts`, `toolbar.ts`, `menu.ts`, `heroInfoMenu.ts`, `heroRosterMenu.ts`, `settlementInfoMenu.ts`, `settlementRosterMenu.ts`, `battleModal.ts`, `tradeModal.ts`, `settingsMenu.ts`, `adventureView.ts`, `cityView.ts` |
| `src/screens/shared/toast.ts` | Bottom-right toast notifications; `attachCommandFailureToasts()` (called once from `GameEngine`) subscribes to the `command:rejected` bus event so a rejected fire-and-forget turn-hook command (`src/game/turnHooks.ts`) surfaces to the player instead of only `console.warn` (#100) |
| `src/vite-env.d.ts` | Vite type shims |

### Rendering model
- Single full-viewport `<canvas>` (`#game`) in `index.html`.
- `Renderer` paints each frame based on `GameState` and `Camera`. (In progress, not live yet: `src/render/scene/` is building a pure `SceneNode[]` seam meant to replace this direct coupling — see Phase 5 Track B in the plan docs.)
- `Camera` supports drag-pan and wheel-zoom (per the `#hud` hint text).
- Hero/castle sprites are loaded via a `SpriteProvider` (defaults to procedural drawers in `HERO_PROCEDURAL_DRAWERS`); PNGs in `src/resources/` are the static fallback / baked output.

### State / persistence
- `GameState` (in `src/state/gameState.ts`) is the authoritative in-memory state, marked with `markSaved()` after API sync.
- Client persists via the `/api` REST surface (`src/io/api.ts`); `localStorage`-style `userGames.ts` keeps a client-side index.
- Seeded determinism via `Mulberry32` (see `src/core/rng.ts`); smoke test asserts identical maps across runs.

---

## 7. Backend architecture (`server/`)

| File | Role |
|---|---|
| `server/index.ts` | Express bootstrap, mounts `cors`, `express.json`, `/api` router; calls `initSchema()` before listening |
| `server/errorHandler.ts` | Global Express error-handling middleware (`ErrorRequestHandler`), registered last in `server/index.ts`'s chain (after the `/api` router). Normalizes any error that reaches it — an unguarded route's thrown/rejected error, an async handler's rejected promise — to the same `{ error: "internal", message }` JSON shape every route with a manual try/catch already returns, instead of Express's default HTML stack-trace page (#98) |
| `server/db.ts` | `pg.Pool` + `initSchema()` (runs `schema.sql` and any new migrations from `server/migrations/`) |
| `server/routes.ts` | Remaining `/api` routes: games CRUD, tiles, events log, lobby claim/start; mounts `commandsRouter` (below) at `/games/:name/commands` for `MoveHero`/`TransferGold`/`EndTurn`/`TradeResources`/`ResolveBattle`/`RecruitHero`/`UpgradeTownHall`/`SetAutoTrade`/`ReorderStack`/`CaptureSettlement` — the old dedicated `resolve-battle`/`trade` routes are deleted |
| `server/http/routes/commands.ts` | `POST /games/:name/commands` — `parseCommand()` validates the request body for all 10 command kinds, then dispatches to `handleCommand()`. Lazily awaits + memoizes `createLiveCommandDeps()` on first request rather than at module load, since it's now async |
| `server/app/commandHandler.ts` | Command-bus core: `handleCommand()` loads the game row, enforces the turn-ownership guard, runs the matching `@heroes/engine` reducer (or `turnService.ts` for `EndTurn`), and persists via `GameRepo`/`EventRepo`. `createLiveCommandDeps()` wires the real Postgres-backed repos below — replaces the now-deleted `server/app/liveRepos.ts` shim; it's async as of `ResolveBattle` (queries the `unit_types` table to populate `ctx.catalog.unitTypes`, previously always empty) |
| `server/app/turnService.ts` | `runEndTurn()` — server-side EndTurn pipeline (`applyEndOfTurnDetailed` → `endTurn` → `advanceRound`), the same composition `src/state/turnController.ts` used to run client-side |
| `server/persistence/repositories/gameRepo.ts` | `createGameRepo()` — Postgres-backed `GameRepo` (`load`/`saveHeroesAndSettlements`) used by `commandHandler.ts` |
| `server/persistence/repositories/eventRepo.ts` | `createEventRepo()` — Postgres-backed `EventRepo.append()`, writes to `game_events` |
| `server/schema.sql` | Base schema |
| `server/migrations/001_turn_state.sql` | First migration (turn-state columns/tables) |

API conventions:
- JSON in/out.
- CORS open (default `cors()` middleware, no origin allowlist configured).
- No auth layer present in the codebase.
- Port read from `API_PORT` env var (written by `scripts/allocate-ports.ts` into `.env`), default `3001`.
- Errors: any error not already caught by a route's own try/catch is normalized to `{ error: "internal", message }` JSON by the global `server/errorHandler.ts` middleware, instead of leaking Express's default HTML/stack-trace error page (#98).

---

## 8. Testing & QA

- **Framework**: none — the project uses Node's built-in `assert/strict` (via `tsx --test`) for unit tests, plus Playwright for browser driving.
- **Unit tests**: under `test/state/` and `test/map/` (e.g. `gameState.test.ts`, `income.test.ts`, `castlePlacement.test.ts`) — run via `npx tsx --test <file>`.
- **Smoke test**: [`test/smoke.ts`](./test/smoke.ts:1) (run via `npm test`).
  - Spawns the API and `vite preview` as child processes.
  - Uses Playwright (`chromium`) to load the built app, reading the client URL from `CLIENT_PORT` in `.env` (default 4173).
  - Talks to the API using `API_PORT` from `.env` (default 3001) via Playwright's `request` API and via `pg.Pool`.
  - Asserts map determinism (same seed → same resource tile placement and counts), then exercises the live UI.
  - Records the spawned API / preview / browser PIDs in `local/.test-request.json` (the per-run shared request file written by `tools/run-test.mjs`) so the next run (or `npm run cleanup`) can reap stragglers via `taskkill /F /T` on Windows / `SIGKILL` on POSIX.
  - Accepts an optional `--shutdownAfterSeconds=<n>` flag that forces a hard tree-kill of all spawned children after `n` seconds (useful for CI runs that hit the 120 s safety ceiling).
  - Accepts an optional `--auto-close` flag. Default behavior preserves the spawned API/`vite preview` for manual inspection (only the npx wrappers are torn down; the detached server trees survive). With `--auto-close` the smoke harness tree-kills the API and preview on exit so the ports release immediately — used by `npm run test:all` so multiplayer/cityView start with fresh ports.
- **Shared request file** — `tools/run-test.mjs` is the cross-platform wrapper invoked by `npm test` / `npm run test:all`. It writes a per-run request to `local/.test-request.json` (gitignored; lives under `local/`, never committed) carrying the per-worktree port layout, then hands control to the test entry. [`test/_request.ts`](./test/_request.ts:1) reads that file to spawn / reap the API + `vite preview`, so `smoke`, `multiplayer.smoke`, and `cityView` share a single boot contract instead of each re-implementing `child_process.spawn` and PID tracking. `test/_request.ts` exposes the same boot helpers (request URL, health-check wait, tree-kill on exit) the individual tests used to inline.
- **Unit-ish tests** under `test/state/` and `test/map/` (e.g. `gameState.test.ts`, `income.test.ts`, `castlePlacement.test.ts`) are imported by the smoke harness — they run as part of `npm test`.
- Logs from previous runs are kept at `test/web.log`, `test/api.log`, `test/*.err.log`; screenshots at `test/screenshot.png` / `test/screenshot-dpr2.png`; PID ledger at `local/.test-request.json` (consumed by the straggler-kill path on next run / shutdown).
- Helper scripts: `tools/run-smoke.ps1` (PowerShell convenience wrapper) and `tools/run-test.mjs` (Node wrapper used by the npm scripts — cross-platform; writes `local/.test-request.json` and launches the requested test entry).

### CI (GitHub Actions)

[`.github/workflows/validate-game.yml`](./.github/workflows/validate-game.yml:1) gates PRs on every push: `npm install` → `npm run dev` (boot check) → `npm test` (smoke test). Runs on `ubuntu-latest` with a Postgres 16 service container — the entire pipeline is Linux-native. Port allocation is now OS-native via `scripts/allocate-ports.ts` (Node `net.Server.listen(0)`); the remaining PowerShell helpers (`cleanup.ps1`, `dev-status.ps1`) are cross-platform and work on both Windows and Linux.

---

## 9. Tooling & asset pipeline

### Sprite generation
- Pipeline driven by [`pixel-gen.mjs`](./pixel-gen.mjs:1) and [`tools/sprites/pixel-gen.mjs`](./tools/sprites/pixel-gen.mjs:1) (Playwright `chromium`).
- Renders each castle level from `pixel-art.html` (a `<canvas>`-based drawing page) into `src/resources/castle-l{1,2,3}.png`.
- `tools/sprites/manifest.mjs` likely describes the sprite catalog (referenced by the renderer via `assetDescriptors.ts`).
- `tools/sprites/generate-preview.mjs` builds a contact sheet at `sprite-preview.png`.
- `tools/sprites/screenshot-preview.mjs` supports screenshot-based previews.
- `sprite-preview.html` is the HTML harness for the contact sheet.

### Skybox pipeline
- City view parallax skyboxes are digital watercolor landscapes generated via DeepInfra FLUX API.
- [`tools/sprites/flux-skybox.mjs`](./tools/sprites/flux-skybox.mjs:1) sends prompts to `black-forest-labs/FLUX-2-klein-4b`, producing 1024×576 PNGs for variants 2–4 (mountains, plains, riverlands). Requires `DEEPINFRA_API_KEY` env var.
- [`scripts/split-skybox-layers.ts`](./scripts/split-skybox-layers.ts:1) slices each variant PNG into 2-layer, 3-layer, and 4-layer depth breakdowns with 18% feathered alpha transitions, producing `src/resources/skybox/cityView-background-variant<n>-layer<m>.png`. Layer bands overlap by 10% with fade blending so composited parallax layers don't show seams.
- The `skybox:split` npm script (`tsx scripts/split-skybox-layers.ts`) operates on all non-layer PNGs in `src/resources/skybox/`, supporting all current and future variants automatically.
- Output assets ship under `src/resources/skybox/` — Vite bundles them as separate files (per `assetsInlineLimit: 0`).

### Editor
- No linter, formatter, or pre-commit hook is configured in the repo (no `.eslintrc*`, no `.prettierrc*`, no Husky config).
- The build command (`tsc && vite build`) is the only enforced static check.

---

## 10. Ports & local services

| Port | Service | How |
|---|---|---|
| Dynamic | Vite dev server (client + HMR) | `CLIENT_PORT` in `.env`, allocated by `scripts/allocate-ports.ts` |
| Dynamic | API (Express) | `API_PORT` in `.env`, allocated by `scripts/allocate-ports.ts` |
| Dynamic | WebSocket | `WS_PORT` in `.env`, allocated by `scripts/allocate-ports.ts` (reserved for a future realtime layer) |
| `5432` | Postgres | `npm run db:up` (docker compose, fixed shared port) |
| `8080` | Adminer (DB UI) | `npm run db:up` |

`scripts/allocate-ports.ts` allocates free ports at dev/test startup (via npm `predev`/`pretest` hooks) and writes them to `.env`. It uses Node's `net.Server.listen(0)` to ask the kernel for a free port — the same mechanism on Windows, Linux, and macOS — so allocations are collision-free across concurrent runs and no PowerShell is required.

Vite auto-loads `.env`; `tsx` processes use `--env-file=.env`. The Postgres port (`5432`) and Adminer port (`8080`) are fixed because the database container is shared across worktrees.

Vite proxies `/api/*` to `http://127.0.0.1:<API_PORT>` in both dev and preview, so the client always calls relative `/api/...` URLs.

---

## 11. Conventions

- ESM everywhere; no `require()` in source.
- Strict TypeScript; unused locals/parameters are build errors.
- Domain types live next to the code that owns them (`Hero`, `Castle`, `GameState`, etc.) rather than in a central `types/` folder. Engine-neutral types that must be visible to both `src/` and `server/` are an explicit exception and live in `shared/types.ts` (`Axial`, identity types, `ResourceType`, `BuildingKind`, `GenerationStyle`, `BuildingDef`, `CastleLevel`/`CastleVariant`); engine-neutral constants and helpers live alongside them (`shared/constants.ts`, `shared/rng.ts`, `shared/units.ts`, `shared/map/*`, `shared/horseVariants.ts`, `shared/styleResolver.ts`). `shared/gameState.ts` is a stepping-stone barrel that re-exports server-safe reducers from `src/state/gameState.ts`. Domain state shapes (`SettlementState`, `CharterState`, `UpgradeState`, `Warehouse`, `BuildingRef`, etc.) live in `shared/settlementTypes.ts` so entities and economy modules can import them without pulling `src/state/gameState` transitively.
- View navigation goes through the `src/views/viewLauncher.ts` registry, not direct cross-imports between view files; `ViewManager` / `UIManager` resolve views via the registry.
- Cross-cutting render types (`RenderOptions`, `MinimapGeometry`) live in `src/render/renderTypes.ts`; the `MinimapCamera` class lives in `src/render/minimapCamera.ts`. These extractions break the prior render-file cycles and keep `renderer.ts` / `minimap.ts` / `overlays/pathOverlay.ts` free of mutual type imports.
- Axial hex coordinates (`Axial`) are the universal map primitive; `axialToPixel` bridges to screen space.
- All randomness goes through `Mulberry32` with an explicit seed for determinism — the smoke test relies on this.
- No secrets in source; DB credentials live only in `docker-compose.yml` for local development.
- Asset files ship under `src/resources/` so Vite can bundle them; `assetsInlineLimit: 0` keeps them as separate files.
