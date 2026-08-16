---
description: Start, stop, or restart the local dev environment (db + api + client) for this worktree. Usage: /dev start | /dev stop | /dev restart
---

The user invoked `/dev` with arguments: `$ARGUMENTS`. The action is the first arg (`start`, `stop`, or `restart`). Default to `status` if missing — report current state without acting.

Key facts about this project (heroes-js):
- Dev is `npm run dev` (vite client + tsx api via concurrently). Long-running — launch it with the background_process tool, don't block.
- `npm run dev:status` is the safe, read-only health check. Use it liberally.
- `npm run cleanup` (scripts/cleanup.ps1) is scoped to *this worktree's own path* — it will skip processes belonging to other worktrees. That is correct, do NOT fall back to broad kills.
- The postgres db is the shared `game_db` container (fixed host port 5432). `npm run db:up` is idempotent and safe. Do NOT run `db:down` unless the user explicitly asked for it — other worktrees share it.
- Ports are per-worktree and OS-assigned by `scripts/allocate-ports.ts` (run automatically by `predev`). No separate "static" mode — concurrent worktrees are collision-free by design.

For `start`:
1. `npm run dev:status` to see current state.
2. If already LISTENING on all services, report the URLs and stop — don't restart.
3. `npm run db:up`.
4. Launch `npm run dev` in the background via the background_process tool.
5. Poll `npm run dev:status` every few seconds for up to ~30s.
6. When web + api report LISTENING and `/api/health` returns 200, report the URLs.

For `stop`:
1. `npm run cleanup`.
2. `npm run dev:status` to confirm web/api are DOWN.
3. Do NOT touch `game_db`.

For `restart`:
1. Run stop, then start.

If anything unexpected happens (port squatted by another worktree, db:up fails, health never returns 200 after ~30s, an error you don't recognize), stop and ask the user via the `question` tool rather than retrying or reaching for a broader kill. Keep the final report short: what you ran, current status, URLs if up.
