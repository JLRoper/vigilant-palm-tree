# Project Agent Instructions (heroes-js)

This file is loaded into every agent's context. Treat the rules below as non-negotiable unless the user overrides them in the current message.

## Project quick facts
- Node/TypeScript/Vite single-page game (heroes-js).
- Dev environment: `npm run dev` (vite client + tsx api, via concurrently). Ports are per-worktree and OS-assigned (random kernel-picked free ports) by `predev` via `scripts/allocate-ports.ts` — collision-free across concurrent runs.
- Postgres dev DB: shared `game_db` container, fixed host port 5432. `npm run db:up` to start. Do NOT run `db:down` unless explicitly asked — other worktrees share it.
- Build: `npm run build` (tsc + vite build). Tests: `npm run test:all` (smoke + multiplayer.smoke + cityView). Status: `npm run dev:status`.
- LAN multiplayer: set `LAN_HOST=1` in `.env` (or process env) before `npm run dev` to bind the API to `0.0.0.0`. `npm run dev:status` will print LAN URLs when `LAN_HOST=1`. `scripts/allocate-ports.ts` reserves `WS_PORT` for a future realtime layer; leave it dormant.

## Coding constraints
- Never commit secrets, `.env` contents, or anything under `local/`.
- Match existing TypeScript style: strict, no `any` unless justified, prefer named exports.
- Do not add code comments unless the user asked. (Doc files like this one are fine.)
- Use `npm run cleanup` (not `taskkill`/broad kills) to free ports — it's scoped to this worktree by design.
- Don't touch files outside the worktree root, the shared `game_db` container, or another worktree's processes.
- Prefer the project's existing helpers (`scripts/cleanup.ps1`, `scripts/allocate-ports.ts`, `scripts/dev-status.ps1`) over ad-hoc equivalents.

## MANDATORY auto-running subagents (do NOT skip)

On every user request, in your FIRST response, you MUST launch subagents via the `task` tool in parallel — both calls in the SAME message:

- **`session-tracker`** — ALWAYS. No exceptions. Even for pure Q&A. It opens/creates `sessionTracking/YYYY-MM-DD.md`, writes a start-of-task marker, and returns immediately so it does not block your work. You will invoke it ONE more time at the end to finalize the entry.
- **`doc-updater`** — when the task may touch code (any implementation, refactor, config, dependency, or script change). Skippable for pure Q&A and conversation. Same fast-return pattern: scan current docs, plan updates, return.

Both `task` calls in one message = parallel (tandem) execution. Do not sequence them, do not wait for one to finish before starting the other, do not wait for either before starting the user's actual work. They are background-fast, not blocking.

When you finish the task, invoke `session-tracker` a second time with the final details (files changed, verification, revert notes). Invoke `doc-updater` a second time if any doc actually needs updating.

## Pre-commit / pre-PR gate (automatic)
Before ANY `git commit`, `git switch -c`, `gh pr create`, or `gh repo create`:
1. Invoke the `precommit-checker` subagent (it runs `npm run build` + `npm run test:all`).
2. If it fails, do not commit/push/PR. Report the failure and ask the user how to proceed.
The `/precommit` and `/pre-pr` slash commands are manual equivalents you can offer the user.

## Skills available
- `/dev start|stop|restart` — manage the local dev environment (db + api + client).
- `/precommit` — run the build + test gate on demand.
- `/pre-pr` — same as `/precommit`, plus a quick doc sanity sweep.
