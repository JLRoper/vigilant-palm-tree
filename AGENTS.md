# Project Agent Instructions (heroes-js)

<!-- docs:verified 2026-10-11 -->

This file is loaded into every agent's context. Treat the rules below as non-negotiable unless the user overrides them in the current message.

## Project quick facts
- Node/TypeScript/Vite single-page game (heroes-js).
- Dev environment: `npm run dev` (vite client + tsx api, via concurrently). Ports are per-worktree and OS-assigned (random kernel-picked free ports) by `predev` via `scripts/allocate-ports.ts` — collision-free across concurrent runs.
- Postgres dev DB: shared `game_db` container, fixed host port 5432. `npm run db:up` to start. Do NOT run `db:down` unless explicitly asked — other worktrees share it.
- `.env` may point `PGHOST` at the shared **gameserver** instead of the local container (see `.env.example`). Tests must never follow it there: `test/smoke.ts` deletes every game in the database except its own fixtures. DB-backed test scripts load `.env.test` after `.env` to pin `PGHOST` to `127.0.0.1` — preserve that order and give any NEW script that reads `.env` the same second `--env-file=.env.test`.
- Build: `npm run build` (tsc + vite build). Full suite: `npm run test:all` (browser/e2e suites through `tools/run-test.mjs all`, followed by `npm run test:unit`). `npm test` is the smoke test. Documentation: `npm run docs:check` (maintained Markdown links/source paths always; `docs:verified` marker freshness scoped to the docs owning the changed files via `DOC_OWNERSHIP` globs in `tools/docs-check.mjs`; no DB). Status: `npm run dev:status`.
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

## Multi-session safety (added 2026-10-11)

Incident-driven rules. Full detail lives in the `multi-agent-workspace` skill's "Human stop is a hard brake" and "Concurrent sessions in one working directory" sections:

- **One live Kilo session per working directory.** Run parallel agents in Agent Manager worktrees (git worktrees under `.worktrees/`), not side by side in the main worktree. Two sessions sharing one directory crossed their session titles on 2026-10-11, because all workspace coordination is directory-scoped.
- Two shared resources do not follow worktrees: the `game_db` Postgres container (fixed host port 5432, shared by design — already a rule above) and Docker Compose project names. `npm run test:all` / `test/smoke.ts` delete every game except their own fixtures, so test suites run from the main worktree — or only with explicit coordination — while another worktree is active.
- Identity in this repo's coordination is `.agentboard/{PID}.json` + the `.plans/` file + `.alock` PIDs. Session titles are advisory — never route work by title.
- A user "stop" is a hard brake: execute only the literal instruction, keep every other action read-only, and announce any still-running background task so the user can cancel it. An active goal's "proceed autonomously" never overrides it.
- Session renames are done by the human in the client. Never have an agent run `alock session-name` to fix a title — that is the mechanism that crossed them.

## Pre-commit / pre-PR gate (automatic)
Before ANY `git commit`, `git switch -c`, `gh pr create`, or `gh repo create`:
1. Invoke the `precommit-checker` subagent (it runs `npm run build` + `npm run lint:deps` + the `docs:check` documentation gate scoped to changed modules + `npm run test:all`).
2. If it fails, do not commit/push/PR. Report the failure and ask the user how to proceed.
The `/precommit` and `/pre-pr` slash commands are manual equivalents you can offer the user.

## Versioning

- **The root `package.json` `version` is the app version** — the single source
  of truth. `vite.config.ts` stamps it into the client as `__APP_VERSION__`,
  and the settings panel's build-info footer (bottom of the panel, next to
  Close) shows `v<version> (<commit>)` plus `Built: <time>` via
  `src/core/version.ts`. The workspace packages (`packages/*`, `0.0.1`) are
  private internals and are deliberately not the app version.
- **Bump with `npm run version:bump -- patch|minor|major|X.Y.Z`**. It rewrites
  the version, prepends a `CHANGELOG.md` entry (commit-log summary by default,
  or `-m "..."`), and prints the deploy command. It edits nothing else unless
  you pass `--commit` / `--tag` / `--push`.
- **Tags are `v<semver>`** and mean a release. **minor** is a real game
  addition — new content or capability; **patch** is a bug fix, a chore, or
  housekeeping (docs, tooling, tests). You do not have to choose: the pre-commit
  gate decides for you from the intended commit type (`feat` -> minor, anything
  else -> patch), or infers it from the changeset when no type is given, and it
  reports its evidence so you can overrule it before committing. It only bumps
  when the version has not already been bumped in that changeset.
- **Docker builds must go through `npm run docker:build`**, not a bare
  `docker compose build`. `.git` is excluded from the build context (179 MB of
  PNG art history), so the container cannot resolve a commit hash on its own —
  the wrapper resolves it on the host and passes it as a build arg. A bare
  `docker compose build` stamps the literal fallback `"dev"` and the deployed
  settings panel will read `v<version> (dev)`.
- Run the pre-commit gate before committing a release (see above).

## Skills available
- `/dev start|stop|restart` — manage the local dev environment (db + api + client).
- `/review-issue [branch|PR#] [issue#]` — review a branch against the issue it claims to close, plus a general pass against the project docs. Read-only.
- `/precommit` — run the build + deps + docs + test gate on demand.
- `/pre-pr` — same as `/precommit`, plus a quick doc sanity sweep.

## Worktree-first default workflow

Discovery → claim/create the task worktree (kwork start / kilo worktree create, flag file .kilo/worktree-workflow.enabled).
- Implement there (uncommitted task state lives in the worktree only).
- Validate there (test:all / build / lint:deps — use the task's isolated per-worktree PGDATABASE from Phase 04's setup script).
- Serialized integrate: finish the task branch into local main only when green (with the pending-final-commit-of-this-phase as the explicit integration candidate); never merge two tasks' finals concurrently (see the `.agentboard/` lock + `.build.*.alock` convention).
- Cleanup the task worktree + branch (keep the task record until cleanup).
