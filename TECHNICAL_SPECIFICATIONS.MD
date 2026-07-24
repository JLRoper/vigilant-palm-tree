# Technical Specifications — heroes-js

A turn-based, hex-grid adventure game inspired by *Heroes of Might & Magic*. This document captures the **tech stack** as it currently exists in the repository. Game design documentation lives under [`docs/`](./docs/README.md).

---

## 1. Project shape

| Aspect | Value |
|---|---|
| Project name | `heroes-js` (also referenced as `vigilant-palm-tree` in `README.md`) |
| Version | `0.0.1` |
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
- `src/resources/` — baked-in sprite PNGs/SVGs (castles, resource icons)
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
- [`server/index.ts`](./server/index.ts:1) boots Express 5 on `PORT` (default `3001`).
- `cors()` middleware enabled globally; `express.json()` for JSON bodies.
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
| `playwright` | ^1.61.1 | Browser automation: smoke tests + sprite generation pipeline |
| `@types/express` | ^5.0.6 | Express 5 typings |
| `@types/cors` | ^2.8.19 | CORS typings |
| `@types/pg` | ^8.20.0 | `pg` typings |

No CSS framework, no UI framework, no state library, no ORM, no testing framework beyond Node's built-in `assert/strict`.

---

## 5. npm scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `concurrently -n web,api -c green,cyan "vite" "tsx watch server/index.ts"` | Run client (Vite) and API (tsx watch) together |
| `dev:web` | `vite` | Client only |
| `dev:api` | `tsx watch server/index.ts` | API only with watch reload |
| `build` | `tsc && vite build` | Type-check, then produce a production client bundle in `dist/` |
| `preview` | `vite preview` | Serve the built bundle (port 4173) |
| `db:up` | `docker compose up -d` | Start Postgres + Adminer |
| `db:down` | `docker compose down` | Stop them |
| `test` | `tsx test/smoke.ts` | End-to-end smoke test (spawns API + preview, drives with Playwright) |
| `sprites:generate` | `node tools/sprites/pixel-gen.mjs` | Render pixel-art castle sprites into `src/resources/` |
| `sprites:preview` | `node tools/sprites/generate-preview.mjs` | Build a sprite contact-sheet preview |

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
| `src/render/` | Canvas rendering: `renderer.ts`, `camera.ts` (pan/zoom), `fog.ts`, `sprites.ts` (procedural hero drawers), `heroSprites.ts`, `assets.ts` (sprite provider), `assetSource.ts`, `assetDescriptors.ts`, `overlays/` |
| `src/managers/` | Orchestration between state, views, and I/O: `GameEngine.ts` (composer), `GameStateManager.ts` (state ↔ entities sync), `ViewManager.ts` (renderer + camera + adventure view), `UIManager.ts` (HUD, toolbar, menus, city view), `GameActions.ts` (end turn, save, battle flow), `SessionManager.ts` (game session lifecycle), `GameSessionManager.ts` (save/load orchestration) |
| `src/state/` | Game state: `gameState.ts` (typed store + all pure reducers including charter settlement logic), `turnController.ts` (turn lifecycle, auto-travel, AI tick), `units.ts`, `playerColors.ts`, `settings.ts` |
| `src/game/` | Game lifecycle: `initState.ts` (build/hydrate initial state), `turnHooks.ts` |
| `src/economy/` | Per-turn economy: `income.ts`, `settlementRates.ts`, `consumption.ts` |
| `src/systems/` | Behavioral systems: `enemyWander.ts` |
| `src/ai/` | AI: `aiBrain.ts` |
| `src/io/` | External I/O: `api.ts` (typed REST client), `userGames.ts` (local saved-games bookkeeping), `debugCommands.ts` |
| `src/views/` | DOM UI: `hud.ts`, `toolbar.ts`, `menu.ts`, `heroInfoMenu.ts`, `heroRosterMenu.ts`, `settlementInfoMenu.ts`, `settlementRosterMenu.ts`, `battleModal.ts`, `tradeModal.ts`, `settingsMenu.ts`, `adventureView.ts`, `cityView.ts` |
| `src/vite-env.d.ts` | Vite type shims |

### Rendering model
- Single full-viewport `<canvas>` (`#game`) in `index.html`.
- `Renderer` paints each frame based on `GameState` and `Camera`.
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
| `server/db.ts` | `pg.Pool` + `initSchema()` (runs `schema.sql` and any new migrations from `server/migrations/`) |
| `server/routes.ts` | All HTTP routes under `/api` (game state CRUD, list/create user games, etc.) |
| `server/schema.sql` | Base schema |
| `server/migrations/001_turn_state.sql` | First migration (turn-state columns/tables) |

API conventions:
- JSON in/out.
- CORS open (default `cors()` middleware, no origin allowlist configured).
- No auth layer present in the codebase.
- Default port `3001`, overridable via `PORT` env var.

---

## 8. Testing & QA

- **Framework**: none — the project uses Node's built-in `assert/strict` (via `tsx --test`) for unit tests, plus Playwright for browser driving.
- **Unit tests**: under `test/state/` and `test/map/` (e.g. `gameState.test.ts`, `income.test.ts`, `castlePlacement.test.ts`) — run via `npx tsx --test <file>`.
- **Smoke test**: [`test/smoke.ts`](./test/smoke.ts:1) (run via `npm test`).
  - Spawns the API and `vite preview` as child processes.
  - Uses Playwright (`chromium`) to load the built app on `http://localhost:4173`.
  - Talks to the API directly on `http://127.0.0.1:3001` via Playwright's `request` API and via `pg.Pool`.
  - Asserts map determinism (same seed → same resource tile placement and counts), then exercises the live UI.
- **Unit-ish tests** under `test/state/` and `test/map/` (e.g. `gameState.test.ts`, `income.test.ts`, `castlePlacement.test.ts`) are imported by the smoke harness — they run as part of `npm test`.
- Logs from previous runs are kept at `test/web.log`, `test/api.log`, `test/*.err.log`; screenshots at `test/screenshot.png` / `test/screenshot-dpr2.png`.
- Helper script: `tools/run-smoke.ps1` (PowerShell wrapper).

---

## 9. Tooling & asset pipeline

### Sprite generation
- Pipeline driven by [`pixel-gen.mjs`](./pixel-gen.mjs:1) and [`tools/sprites/pixel-gen.mjs`](./tools/sprites/pixel-gen.mjs:1) (Playwright `chromium`).
- Renders each castle level from `pixel-art.html` (a `<canvas>`-based drawing page) into `src/resources/castle-l{1,2,3}.png`.
- `tools/sprites/manifest.mjs` likely describes the sprite catalog (referenced by the renderer via `assetDescriptors.ts`).
- `tools/sprites/generate-preview.mjs` builds a contact sheet at `sprite-preview.png`.
- `tools/sprites/screenshot-preview.mjs` supports screenshot-based previews.
- `sprite-preview.html` is the HTML harness for the contact sheet.

### Editor
- No linter, formatter, or pre-commit hook is configured in the repo (no `.eslintrc*`, no `.prettierrc*`, no Husky config).
- The build command (`tsc && vite build`) is the only enforced static check.

---

## 10. Ports & local services

| Port | Service | How |
|---|---|---|
| `5173` | Vite dev server (client + HMR) | `npm run dev` |
| `4173` | Vite preview server (built bundle) | `npm run preview` / `npm test` |
| `3001` | API (Express) | `npm run dev:api` |
| `5432` | Postgres | `npm run db:up` (docker compose) |
| `8080` | Adminer (DB UI) | `npm run db:up` |

Vite proxies `/api/*` to `http://localhost:3001` in both dev and preview, so the client always calls relative `/api/...` URLs.

---

## 11. Conventions

- ESM everywhere; no `require()` in source.
- Strict TypeScript; unused locals/parameters are build errors.
- Domain types live next to the code that owns them (`Hero`, `Castle`, `GameState`, etc.) rather than in a central `types/` folder.
- Axial hex coordinates (`Axial`) are the universal map primitive; `axialToPixel` bridges to screen space.
- All randomness goes through `Mulberry32` with an explicit seed for determinism — the smoke test relies on this.
- No secrets in source; DB credentials live only in `docker-compose.yml` for local development.
- Asset files ship under `src/resources/` so Vite can bundle them; `assetsInlineLimit: 0` keeps them as separate files.
