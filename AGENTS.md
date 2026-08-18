# Project Agent Instructions (heroes-js)

This file is loaded into every agent's context. Treat the rules below as non-negotiable unless the user overrides them in the current message.

## Project quick facts
- Node/TypeScript/Vite single-page game (heroes-js).
- Dev environment: `npm run dev` (vite client + tsx api, via concurrently). Ports are per-worktree and OS-assigned (random kernel-picked free ports) by `predev` via `scripts/allocate-ports.ts` — collision-free across concurrent runs.
- Postgres dev DB: shared `game_db` container, fixed host port 5432. `npm run db:up` to start. Do NOT run `db:down` unless explicitly asked — other worktrees share it.
- `.env` may point `PGHOST` at the shared **gameserver** instead of the local container (see `.env.example`). Tests must never follow it there: `test/smoke.ts` deletes every game in the database except its own fixtures. `.env.test` is loaded after `.env` by the `test` and `test:cityview` scripts to pin `PGHOST` back to `127.0.0.1` — do not remove it, and give any NEW test script that reads `.env` the same second `--env-file=.env.test`.
- Build: `npm run build` (tsc + vite build). Tests: `npm run test:all` (smoke + multiplayer.smoke + cityView). Status: `npm run dev:status`.
- LAN multiplayer: set `LAN_HOST=1` in `.env` (or process env) before `npm run dev` to bind the API to `0.0.0.0`. `npm run dev:status` will print LAN URLs when `LAN_HOST=1`. `scripts/allocate-ports.ts` reserves `WS_PORT` for a future realtime layer; leave it dormant.

## Coding constraints
- Never commit secrets, `.env` contents, or anything under `local/`.
- Match existing TypeScript style: strict, no `any` unless justified, prefer named exports.
- Do not add code comments unless the user asked. (Doc files like this one are fine.)
- Use `npm run cleanup` (not `taskkill`/broad kills) to free ports — it's scoped to this worktree by design.
- Don't touch files outside the worktree root, the shared `game_db` container, or another worktree's processes.
- Prefer the project's existing helpers (`scripts/cleanup.ps1`, `scripts/allocate-ports.ts`, `scripts/dev-status.ps1`) over ad-hoc equivalents.

## Auto-running subagents

- **`session-tracker` auto-invocation is DISABLED (user rule, added 2026-08-17).** Do not launch it at the start or end of a task, and do not treat it as mandatory. It still exists as a tool and may be used, but only when the user explicitly asks for session tracking/logging in their message. Do not pair it with `doc-updater` anymore.
- **`doc-updater`** — in your FIRST response, launch this via the `task` tool when the task may touch code (any implementation, refactor, config, dependency, or script change). Skippable for pure Q&A and conversation. Fast-return pattern: scan current docs, plan updates, return without blocking the user's actual work.

When you finish the task, invoke `doc-updater` a second time if any doc actually needs updating.

## Pre-commit / pre-PR gate (automatic)
Before ANY `git commit`, `git switch -c`, `gh pr create`, or `gh repo create`:
1. Invoke the `precommit-checker` subagent (it runs `npm run build` + `npm run test:all`).
2. If it fails, do not commit/push/PR. Report the failure and ask the user how to proceed.
The `/precommit` and `/pre-pr` slash commands are manual equivalents you can offer the user.

## Skills available
- `/dev start|stop|restart` — manage the local dev environment (db + api + client).
- `/review-issue [branch|PR#] [issue#]` — review a branch against the issue it claims to close, plus a general pass against the project docs. Read-only.
- `/precommit` — run the build + test gate on demand.
- `/pre-pr` — same as `/precommit`, plus a quick doc sanity sweep.
