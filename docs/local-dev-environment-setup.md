# Local Dev Environment Setup — Linux

Record of standing up `heroes-js` from a clean clone on a Linux host, including the
non-obvious parts of this project's tooling that aren't documented elsewhere.

**Date:** 2026-08-10
**Host:** Linux 6.17 x86_64, checkout at `/opt/heroes-js`, running as uid 1000
**Baseline:** `main` @ `313a744` (Merge PR #53 — menu sizing / scrollbar)
**Toolchain:** Node v22.23.2, npm 10.9.8, PowerShell 7.6.4, Docker

---

## Why this doc exists

Most of this repo's npm scripts shell out to PowerShell, and `.env` is written by a
script rather than by hand. Neither is obvious from `README.md`, and both cost time on a
first Linux setup. The gotchas section below is the part worth reading.

---

## What was done

### 1. Clone

`/opt/heroes-js` was created `root:root`, and the session user (uid 1000) can't create
`.git` there. Passwordless sudo isn't available on this host, so ownership was corrected
out-of-band before cloning:

```bash
sudo chown GameServer:jamez /opt/heroes-js   # run in a real terminal — needs a TTY
git clone https://github.com/JLRoper/vigilant-palm-tree.git /opt/heroes-js
```

### 2. Dependencies

```bash
npm install    # 171 packages
```

Two things to note:

- This modified `package-lock.json` (2 insertions, 2 deletions). Prefer **`npm ci`** on a
  fresh clone — it honors the committed lockfile exactly and leaves it untouched.
- `npm audit` reports 4 vulnerabilities (2 moderate, 2 high). Left unaddressed;
  `npm audit fix --force` can pull breaking major versions.

### 3. PowerShell

`pwsh` is required by `predev`, `pretest`, `cleanup`, and `dev:status`. It was installed
**user-locally**, avoiding root:

```bash
mkdir -p ~/.local/pwsh ~/.local/bin
curl -sSL -o /tmp/pwsh.tar.gz \
  https://github.com/PowerShell/PowerShell/releases/download/v7.6.4/powershell-7.6.4-linux-x64.tar.gz
tar -xzf /tmp/pwsh.tar.gz -C ~/.local/pwsh
chmod +x ~/.local/pwsh/pwsh
ln -sf ~/.local/pwsh/pwsh ~/.local/bin/pwsh
```

`~/.profile` already prepends `~/.local/bin` **when that directory exists** — it didn't at
login time, so no profile edit was needed, but see the PATH gotcha below.

### 4. Environment file

`.env` is absent from a fresh clone (only `.env.example` is committed, and `.gitignore`
excludes `.env`). Values align with `docker-compose.yml` and the defaults in
`server/db.ts`:

```
API_PORT=3001
CLIENT_PORT=5173
LAN_HOST=0
PGDATABASE=game_poc
PGHOST=localhost
PGPASSWORD=gamepass
PGPORT=5432
PGUSER=gameuser
REDIS_PORT=6379
WS_PORT=4100
```

### 5. Docker reset

A previous iteration's stack was still running from a **different checkout**
(`/opt/heroes-js-db`), under compose project `heroes-js-db`:

| | Prior iteration | This repo's compose |
|---|---|---|
| DB container | `heroes-js-db` | `game_db` |
| Adminer | `heroes-adminer` | `game_adminer` |
| DB host port | 5433 | 5432 |
| Adminer port | 8081 | 8080 |
| Volume | `heroes-js-db_postgres_data` | `heroes-js_game_db_data` |
| Seeding | bind-mounted `init.sql` | none — see below |

Different project name, container names, and volume, so Docker treated them as unrelated
stacks. The old containers and volumes were removed for a clean slate, which also
resolved a port mismatch (`.env` pointed at 5432; the old container published 5433).

### 6. Start

```bash
npm run db:up    # docker compose up -d
npm run dev      # vite + tsx watch, via concurrently
```

Verified running:

| Service | URL |
|---------|-----|
| web (vite) | http://localhost:5173 |
| api (tsx) | http://localhost:3001 — `/api/health` → `{"ok":true}` |
| adminer | http://localhost:8080 |
| db | `game_db`, localhost:5432, healthy |

---

## Gotchas

### pwsh resolves only in a login shell

`~/.local/bin` is added to `PATH` by `~/.profile`, which **non-login shells don't read**.
A plain `bash -c 'npm run dev'` fails with `pwsh: command not found`; this affects
automation and agents more than interactive use. Wrap pwsh-backed npm scripts:

```bash
bash -lc 'npm run dev:status'
```

Affected scripts: `dev`, `dev:static`, `dev:status`, `cleanup`, `test*` (via `pretest`).
A system-wide `pwsh` install would remove this caveat.

### `scripts/ports.ps1` owns `.env`

`predev` runs before every `npm run dev` and **rewrites `.env`**, re-picking free ports
per worktree. Hand-added comments and formatting do not survive. Your values are
preserved, but treat the file as script-managed. Use `npm run dev:static` for stable
ports.

### `npm run cleanup` is scoped to one worktree by design

`scripts/cleanup.ps1` only kills node/vite processes whose command line contains *this
worktree's* absolute path. `Skipping PID ... (no worktree match)` means another
worktree owns that process — a safety boundary, not a bug. Don't escalate to a
port-based or PID-based kill.

### The db is shared across worktrees

`game_db` uses a fixed container name and fixed host port 5432, regardless of the
per-worktree ports in `.env`. Expect it to already be running. `npm run db:down` affects
every worktree and every session — don't include it in a routine stop.

### Schema is applied automatically; data is not

A brand-new volume comes up with the schema already applied — 9 tables (`auth_codes`,
`game_assets`, `game_events`, `games`, `resource_transactions`, `settlement_snapshots`,
`tiles`, `unit_types`, `user_sessions`), confirmed via `\dt`. No manual migration step is
needed. The tables are **empty**, though: anything expecting pre-existing rows will
behave differently than against an established database. See `npm run assets:seed`.

---

## Known gaps

- `package-lock.json` carries uncommitted drift from `npm install` (not part of this
  branch). Worth reverting or committing deliberately.
- 4 npm audit vulnerabilities remain unaddressed.
- Schema was verified by table existence only. `server/migrations/001..008` were not
  compared migration-by-migration against the live database.
- No seed data in the fresh database.
- The `dev-env` agent (`.claude/agents/dev-env.md`) describes `.env` as containing
  `DB_PORT`; the file actually uses `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`.
  Minor doc drift.
- Neither `gh` nor any git credential helper is installed on this host.

---

## Reference

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | `game_db` (postgres:16-alpine) + `game_adminer` |
| `server/db.ts` | Pool config and env var defaults |
| `server/schema.sql`, `server/migrations/` | Schema definition |
| `scripts/ports.ps1` | Per-worktree port assignment; rewrites `.env` |
| `scripts/cleanup.ps1` | Worktree-scoped process cleanup |
| `scripts/dev-status.ps1` | Read-only status of web/api/db |
| `.claude/agents/dev-env.md` | Agent driving `/dev-start`, `/dev-stop`, `/dev-restart` |
