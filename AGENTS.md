# Project Agent Instructions (heroes-js)

<!-- docs:verified 2026-10-14 -->

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
1. Invoke the `precommit-checker` subagent (it runs `npm run build` + `npm run lint:deps` + the `docs:check` documentation gate scoped to changed modules + `npm run test:all`). Tests run only when the changeset touches game code: `npm run test:scope -- --changed-from origin/main` (`tools/test-scope.mjs`) reports `TESTS SKIPPED` when every changed file is documentation or agent tooling (`*.md`, `docs/`, `.kilo/`, `.claude/`, `.github/agents|hooks|prompts|skills/`, etc.), and the PR workflow `validate-game.yml` applies the same rule to its boot check and smoke test. Unknown paths fail safe to running tests.
2. If it fails, do not commit/push/PR. Report the failure and ask the user how to proceed.
The `/precommit` and `/pre-pr` slash commands are manual equivalents you can offer the user.

## Versioning

- **The root `package.json` `version` is the app version** — the single source
  of truth. `vite.config.ts` stamps it into the client as `__APP_VERSION__`,
  and the in-game toolbar gear (⚙) dropdown menu shows `v<version> (<commit>)`
  plus `Built: <time>` via `src/core/version.ts`. The workspace packages
  (`packages/*`, `0.0.1`) are private internals and are deliberately not the
  app version.
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
  gear dropdown will read `v<version> (dev)`.
- Run the pre-commit gate before committing a release (see above).

## Skills available
- `/dev start|stop|restart` — manage the local dev environment (db + api + client).
- `/review-issue [branch|PR#] [issue#]` — review a branch against the issue it claims to close, plus a general pass against the project docs. Read-only.
- `/pr-copilot-triage <PR#> [--no-merge] [--no-issues]` — verify a PR's Copilot comments against its head, write `reviews/pr<N>-review.md`, file a tracker issue (review as body) plus one issue per valid finding, add a version bump if the PR changes game code and lacks one (via `version-bump`), then approve and merge once CI is green.
- `/version-bump [patch|minor|major] [--pr <N>] [--check]` — only for changes to game code (`src/`, `packages/`, `server/`, `index.html`, excluding tests and `.md`; agents, skills, docs and tooling never bump): check whether the current branch or a PR already bumps the version against its base; if not, decide patch vs minor and apply it with `scripts/bump-version.mjs` (on a PR, as a pushed `chore(release)` commit).
- `/precommit` — run the build + deps + docs + test gate on demand.
- `/pre-pr` — same as `/precommit`, plus a quick doc sanity sweep.

## Claude Code agents (user-level, `~/.claude/agents/`)
These definitions are not in the repo; they live in the user's `~/.claude/agents/`, so they work in every worktree on that machine and are absent elsewhere.
- `playtester` — plays the game through the browser against this worktree's local dev env, cross-checks `window.__gameDebug` state and the event log, and writes a findings report to `reviews/playtests/<date>-<focus>.md`. Give it a focus and optional turn budget. It refuses to run when `.env` points `PGHOST` at the gameserver, never deletes games, and never edits code.

## Standard workflow (shape reminder)

**Trigger:** when the user asks "what's the standard workflow here?", "what's the workflow?", "what's the agent workspace flow?", or how to structure multi-agent work in this repo — present the shape below verbatim (or point at `/workflow`), and note kwork is legacy-only.

Three tiers. Start at Tier 1; escalate only when the trigger says so:

```
TIER 1 — single task, one session (default)
  alock plan <name> → implement in the primary checkout → /precommit → commit

TIER 2 — bigger task: CLI orchestrator + Task-tool subagents, ONE tree, no worktrees
  orchestrator: alock plan + alock register + alock build-start  (owns ALL protocol I/O)
  ├── Task(worker, scope: packages/engine/...)    ← disjoint file scopes
  ├── Task(worker, scope: src/screens/logistics/) ← subagents alock lock/unlock own files
  └── collect results → orchestrator runs full builds/tests → alock sweep

TIER 3 — subtasks each need their OWN full build/test cycle, or a track may be
         abandoned/resumed across days (isolation escalation — manual worktrees)
  git worktree add .worktrees/<name> -b <branch-name> main   (from the primary checkout)
  → open a Kilo session IN that directory → alock plan <name> → implement on <branch-name>
  → integrate to main yourself: serialized, /precommit gate first
```

kwork is LEGACY: `kwork status/resume/finish/abandon` still operate on existing `.plans/tasks/<id>` records and `.kilo/worktrees/<task>` worktrees, but do not start new tasks with it (stale records and dead worktrees are `kilo-deep-clean` candidates). Agent Manager sessions are for non-task work only (reviews, questions, exploration) — never a second task registry, and never the same task in both systems (duplicate worktree + branch; stale duplicates from exactly that mistake already exist).

### Orchestrator mode rules (Tier 2 detail)

**The orchestrator owns all protocol I/O; subagents do pure work.** All subagents share the session's host PID — a subagent writing protocol state clobbers the orchestrator's or a sibling's.

| Concern | Rule | Owner |
|---|---|---|
| File edits | Narrow, disjoint scopes per subtask; `alock lock`/`unlock` files when scopes might touch (lock names are file-keyed — safe for subagents) | Subagent |
| Full builds / `test:all` / shared-DB suites | Only after collecting subagent results; `.build.{PID}.alock` held for the whole modification window | Orchestrator |
| `.agentboard/`, `alock sweep`/`janitor`, session-plan updates | Never by subagents | Orchestrator |
| Dispatch | Parallel OK with disjoint scopes; sequential or file-locked when scopes touch; never two agents in one directory | Orchestrator |

Launch subagents via the `worker` agent (`.kilo/agent/worker.md`) — its system prompt carries this discipline. Staleness note: a subagent's forgotten lock reads LIVE until the whole session dies (shared PID); the 5-minute idle rule is the only backstop, so unlock immediately after the last write. The orchestrator maintains the single session plan (subagents share it).

### Legacy kwork path (records from earlier phases)

Discovery → claim/create the task worktree (kwork start / kilo worktree create, flag file .kilo/worktree-workflow.enabled).
- Implement there (uncommitted task state lives in the worktree only).
- Validate there (test:all / build / lint:deps — use the task's isolated per-worktree PGDATABASE from Phase 04's setup script).
- Serialized integrate: finish the task branch into local main only when green (with the pending-final-commit-of-this-phase as the explicit integration candidate); never merge two tasks' finals concurrently (see the `.agentboard/` lock + `.build.*.alock` convention).
- Cleanup the task worktree + branch (keep the task record until cleanup).
