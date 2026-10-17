# Operations Guide

<!-- docs:verified 2026-10-16 -->

This guide covers local development and deployment. See [`AGENTS.md`](../AGENTS.md) for the complete workspace/test safety rules.

## Local Development and Database Safety

- Use Node.js 22+ and `npm install`; `npm run dev` starts the Vite client and API.
- Ports are allocated per worktree by `scripts/allocate-ports.ts`; use `npm run dev:status` to discover the current local URLs. Set `LAN_HOST=1` before `npm run dev` to bind the API to `0.0.0.0` for LAN access.
- Local PostgreSQL uses the shared `game_db` container on host port 5432. `npm run db:up` starts it. Do **not** run `npm run db:down` unless explicitly authorized; other worktrees share it.
- The API applies `server/schema.sql` and the ordered migration set (`001` through `028`) during startup. Keep migrations idempotent because startup re-runs them.
- `.env` may target a remote gameserver. DB-backed tests must load `.env.test` after `.env` to pin `PGHOST=127.0.0.1`. The smoke test deletes every game except its own fixtures, so never aim tests at the shared remote server. Run DB-destructive browser suites only with explicit coordination, preferably from the main worktree.

## Test Commands

- `npm test` runs the smoke test.
- `npm run test:unit` runs serial Node `node:test` suites.
- `npm run test:all` runs the browser/e2e suites through `tools/run-test.mjs all`, followed by unit tests.
- `npm run docs:check` checks maintained Markdown links/source paths (always) and `docs:verified` freshness markers (full mode for all docs; `--changed <path>` / `--changed-from <git-spec>` scope freshness to the docs owning the changed files, per the `DOC_OWNERSHIP` globs in `tools/docs-check.mjs`) without connecting to the database.

The browser suite includes smoke, multiplayer, city view, settlements, AI defender, AI charter, log panel, uncharted mode, and visual regression. Avoid `npm run test:all` when another coordinated session is exercising the shared database.

## AI Driver and Multiplayer

New games with AI enemies persist `lobby.aiDriver: "server"` and a boot token. `server/app/aiDriver.ts` scans eligible games, drives commands through the trusted in-process command handler, and uses per-game PostgreSQL advisory locks to prevent concurrent drives. Heartbeats let the watchdog identify stale ownership; a new process boot token and stale-driver adoption allow recovery after process loss. Pool connection timeouts and bounded turn/action budgets keep a stalled database or AI pass from holding the API indefinitely. Unflagged legacy games may still use the browser-driven AI path.

Multiplayer state changes are pushed through SSE (`GET /api/games/:name/events/stream`) using PostgreSQL notifications as wakeups. Event rows remain the source of truth; client replay/cursor handling is shared with the polling path, which remains a recovery backstop. SSE is ordinary HTTP streaming, not WebSockets.

## Deployment and Versioning

- Build Docker images with `npm run docker:build`, not bare `docker compose build`. The wrapper resolves the Git commit on the host and passes it into the image; a bare compose build can stamp the fallback `dev` value. Redeploy with `docker compose up -d --remove-orphans api web` so any legacy `game_gateway` container is removed before `game_web` (`nginx:1.27-alpine`, `docker/Dockerfile` `web-runtime` stage + `docker/nginx.conf`) binds host port `5173`. `game_web` serves `/usr/share/nginx/html` (`/app/dist` symlinked) directly from disk on ports `80` and `5173` with `Cache-Control: public, max-age=31536000, immutable` on `/assets/` and proxies `/api/` directly to `api:3001` via Docker's runtime DNS resolver (`127.0.0.11`).
- The root `package.json` version is the app version. Use `npm run version:bump -- patch|minor|major|X.Y.Z`; it updates the package version and `CHANGELOG.md`. Release tags use `v<semver>`.
- Run the pre-commit gate before committing; it now includes the `docs:check` documentation gate. This documentation task does not commit or run the full build/test gate.

See [`multiplayer.md`](./multiplayer.md), [`plans-track-map.md`](./plans-track-map.md), and the root [technical specification](../TECHNICAL_SPECIFICATIONS.MD) for architecture details.
