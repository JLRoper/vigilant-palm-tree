# Plan: Database-agnostic repository abstraction (Postgres / Oracle / MySQL, any version)

**Status:** DRAFT — *the circular-import cleanup this was waiting on has landed (commit `526398e` on `architecture/circular-dep-cleanup`, 2026-08-10 — see `plan/2026-08-09-risk-circular-imports.md`). §2 ("Current shape") and §5 ("Sequencing") still need re-derivation against the post-cleanup `server/` shape (the cleanup moved `server/db.ts` and reorganized `server/*` import boundaries as predicted in §8 question 4).*
**Author date:** 2026-08-10
**Source request:** "Abstract repositories enough to switch between postgres, oracle, mysql, or any variations/versions of those we may want to test our code against. Assuming data structures exist the same between them."
**Concrete trigger:** the new permanent `docker-postgress-v-1` database on the tailscale mesh is the first second-backend. The dropdown on the New Game popup must select *which backend* a new game is created against.

---

## 1. Goal

Replace the current "every route handler calls `pool.query()` directly against a single hardcoded `pg.Pool`" pattern with:

1. A **vendor-neutral repository interface** that the API code (and, eventually, the multiplayer sync layer) talks to.
2. **Adapter implementations** for Postgres, Oracle, and MySQL. Each adapter owns its own driver client (`pg`, `oracledb`, `mysql2/promise`).
3. A **runtime selector** that picks an adapter per backend identifier (e.g. `default-local-postgres`, `docker-postgress-v-1`, `oracle-test-19c`, `mysql-test-8`). The selector can resolve from env (server-wide default), per-request (the New Game dropdown value), or per-game (persisted on the `games` row).
4. **Dialect differences are quarantined** to the adapter layer. Anything above it only sees the repository interface, parameterized queries, and primitive return types (rows, scalars, JSON, `null`).

We are **not** solving:

- Data-model drift between vendors. The plan assumes the same logical tables/columns exist; a Postgres-only column type that has no MySQL/Oracle analog must be flagged and either simulated (e.g. `JSONB` → `JSON`) or excluded.
- Migrations. The plan keeps the existing `server/schema.sql` + `server/migrations/*` model but adds a **dialect dispatch** so each adapter runs only the migrations that apply to it.
- Connection pooling across multiple tenants. One pool per adapter is enough.

---

## 2. Current shape (verified 2026-08-10)

- **Single pool** in `server/db.ts:7-15`. Reads `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` with hardcoded fallbacks matching `docker-compose.yml`.
- **No repository layer.** `server/routes.ts`, `server/auth.ts`, `server/assetRoutes.ts` all call `pool.query(...)` / `withTransaction(...)` directly.
- **Schema bootstrap** in `server/db.ts:18-54` is Postgres-flavored: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`, JSON columns typed `JSONB`, identity via `SERIAL`/`GENERATED ALWAYS AS IDENTITY`, `gen_random_uuid()`, and migrations `001_turn_state.sql` … `008_lobby.sql`.
- **Env files** carry no DB vars today. `.env` has only port allocations; `.env.example` only has `LAN_HOST`. The Tailscale plan at `plan/2026-08-09-architecture-walkthrough-tailscale.md` already proposed adding `PG*` vars to `.env`.
- **Wire-up**: `server/index.ts:3` imports `pool`; `initSchema()` runs at boot before `app.listen`; `pool.end()` runs on SIGINT.
- **Frontend**: `src/views/newGameScreen.ts` renders the form mounted by `src/views/homeView.ts` (`openNewGameModal` at `homeView.ts:182`). No DB selector field exists yet.

> ⚠ The section above was written before the in-flight circular-import cleanup. If that work relocates `server/db.ts` or reorganizes `server/*` import boundaries, **§5 must be re-derived against the new shape** before implementation starts.

---

## 3. Target shape

```
server/
  db/
    index.ts                 # public façade: getRepository(), listAdapters()
    adapter.ts               # interface DatabaseAdapter
    adapters/
      postgres.ts            # pg adapter
      oracle.ts              # oracledb adapter
      mysql.ts               # mysql2 adapter
    repositories/
      games.ts               # GamesRepository
      tiles.ts               # TilesRepository
      auth.ts                # AuthRepository
      events.ts              # EventsRepository
      snapshots.ts           # SettlementSnapshotsRepository
      resources.ts           # ResourceTransactionsRepository
      assets.ts              # AssetRepository
      ...
    schema/
      runner.ts              # dialect-aware bootstrap
      postgres/
        schema.sql           # moved from server/schema.sql
        migrations/*.sql     # moved from server/migrations/
      oracle/
        schema.sql
        migrations/*.sql
      mysql/
        schema.sql
        migrations/*.sql
    types.ts                 # Row types, query params (vendor-neutral)
    errors.ts                # RepositoryError, UniqueViolation, NotFound, ...
```

### 3.1 `DatabaseAdapter` interface (`server/db/adapter.ts`)

```ts
export interface QueryParams {
  readonly [key: string]: unknown;
}

export interface QueryResult<R = Record<string, unknown>> {
  readonly rows: readonly R[];
  readonly rowCount: number;
}

export interface Transaction {
  query<R = Record<string, unknown>>(sql: string, params?: QueryParams): Promise<QueryResult<R>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface DatabaseAdapter {
  readonly id: string;                 // e.g. "postgres:16", "docker-postgress-v-1"
  readonly dialect: "postgres" | "oracle" | "mysql";
  query<R = Record<string, unknown>>(sql: string, params?: QueryParams): Promise<QueryResult<R>>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
```

Key choices:

- `query` takes **named bind params** (`$name` style), not positional. This is the lowest common denominator across the three drivers (`pg` accepts both but is happy with named; `oracledb` accepts named; `mysql2` accepts named via object). Repos never write `:1` or `?`.
- Returned rows are typed `Record<string, unknown>` at the adapter boundary; repos narrow to row types in `types.ts`.
- Adapter IDs are free-form strings so we can express "the same Postgres 16 engine, two hosts" (`docker-postgress-v-1`, `default-local-postgres`). Dialect is a separate field for dispatching.

### 3.2 Repository pattern (`server/db/repositories/*.ts`)

```ts
export interface GamesRepository {
  create(input: NewGame): Promise<GameRow>;
  findByName(name: string): Promise<GameRow | null>;
  updateState(name: string, state: GameStatePayload): Promise<void>;
  endTurn(name: string): Promise<EndTurnResult>;
  listSummaries(ownerId: string): Promise<GameSummary[]>;
  // ...
}
```

Each repository is a **factory**: `createGamesRepository(adapter: DatabaseAdapter): GamesRepository`. It owns its SQL but delegates execution to the adapter. SQL is still strings (we're not building a query builder — that's a separate future plan), but every string lives behind a repo method.

### 3.3 Adapter selector (`server/db/index.ts`)

```ts
export interface AdapterConfig {
  id: string;
  dialect: "postgres" | "oracle" | "mysql";
  driverOptions: Record<string, unknown>;  // pg config / oracledb connectString / mysql2 options
}

let adapters = new Map<string, DatabaseAdapter>();
let defaultId: string | undefined;

export function registerAdapter(cfg: AdapterConfig): DatabaseAdapter { /* ... */ }
export function setDefaultAdapter(id: string): void { /* ... */ }
export function getAdapter(id?: string): DatabaseAdapter { /* ... */ }
export function getRepository<K extends keyof Repositories>(name: K, adapterId?: string): Repositories[K] { /* ... */ }
```

Bootstrap order in `server/index.ts`:

1. Read `DB_ADAPTERS_JSON` (or one env var per adapter) and `DB_DEFAULT_ADAPTER` from process env.
2. Register each adapter and open its pool.
3. For each adapter, run `schema/runner.ts` to apply the dialect-appropriate `schema.sql` + migrations.
4. Mount express.
5. On SIGINT: `close()` every adapter.

### 3.4 Per-request / per-game adapter selection

The New Game popup dropdown posts to a new endpoint, e.g. `POST /api/games` with `{ name, mapSize, seed, humanPlayers, dbAdapterId }`. The handler:

1. Validates `dbAdapterId` is registered.
2. Calls `getAdapter(dbAdapterId)` to pick the right adapter for the write path.
3. Persists `db_adapter_id` on the `games` row so future reads of *that game* (load, end-turn, snapshot) also use the same adapter.
4. Subsequent reads default to the game's stored adapter; if absent, fall back to `DB_DEFAULT_ADAPTER`.

This is the minimal change to make the dropdown real: the **selector is per-game**, not per-server, so two coexisting backends can both have active games on the same API process.

For endpoints that are not tied to a specific game (auth, health, lobby metadata), the route uses the **default adapter**.

### 3.5 UI: the dropdown (`src/views/newGameScreen.ts`)

Add a `<select>` next to the existing map-size and human-player fields. Populated from `GET /api/db/adapters` (returns `[{ id, label }]`). The default option is the configured `DB_DEFAULT_ADAPTER`; the New Game form posts the chosen `id` to `POST /api/games`.

Styling, label rendering, and validation match the existing field-row pattern (`makeFieldRow` at `newGameScreen.ts:74`). Use the existing `id="newGameDbAdapter"` / `name="dbAdapterId"` naming convention used by `name`/`mapSize`/etc.

---

## 4. Dialect differences the adapter layer must absorb

This is the *interesting* part — the place future contributors will be tempted to leak dialect up the stack.

| Concern | Postgres | Oracle | MySQL |
|---|---|---|---|
| Named binds | `$1, $2` or `$name` | `:name` (or `:1` positional) | `?` positional, or named with `mysql2` object syntax |
| `INSERT … RETURNING` | Native | Needs `RETURNING … INTO :out` (PL/SQL) or follow-up `SELECT` | Needs follow-up `SELECT` (or `LAST_INSERT_ID()`) |
| Upsert | `INSERT … ON CONFLICT (col) DO UPDATE` | `MERGE INTO` | `INSERT … ON DUPLICATE KEY UPDATE` |
| Identity column | `GENERATED ALWAYS AS IDENTITY` | `NUMBER GENERATED ALWAYS AS IDENTITY` (12c+) or `SEQ + trigger` | `BIGINT AUTO_INCREMENT` |
| UUID | `gen_random_uuid()` (pgcrypto) | `RAW(16)` + sys_guid, or VARCHAR + JavaScript gen | `CHAR(36)` or `BINARY(16)` |
| JSON | `JSONB` | `JSON` (21c+) or CLOB | `JSON` |
| Boolean | native `BOOLEAN` | no native — use `CHAR(1)`/`NUMBER(1)` | `TINYINT(1)` or `BOOLEAN` (alias) |
| Locking for schema migrations | `pg_advisory_xact_lock` | `DBMS_LOCK` | `GET_LOCK` / named locks |
| `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN` | Native | Doesn't exist — needs `USER_TAB_COLUMNS` check + dynamic SQL | Native in 8.0+ |
| Transactions | implicit begin per statement or `BEGIN … COMMIT` | implicit on DML, must `COMMIT` | `START TRANSACTION … COMMIT` |

The adapter layer's job is to **hide all of this**. Repos never write `ON CONFLICT` directly — they call `repo.upsert(...)`, and the adapter picks the right syntax for the registered dialect.

The one place dialect shows up is `schema/runner.ts`, which loads `schema/<dialect>/schema.sql` and `<dialect>/migrations/*.sql`. SQL files are not shared across dialects.

### 4.1 Identifiers for adapters

```jsonc
// DB_ADAPTERS_JSON (env var)
[
  {
    "id": "default-local-postgres",
    "label": "Local Postgres (Docker)",
    "dialect": "postgres",
    "driverOptions": { "host": "localhost", "port": 5432, "user": "gameuser", "password": "gamepass", "database": "game_poc" }
  },
  {
    "id": "docker-postgress-v-1",
    "label": "docker-postgress-v-1 (tailscale)",
    "dialect": "postgres",
    "driverOptions": { "host": "<tailscale-ip>", "port": 5432, "user": "gameuser", "password": "<from tailscale-admin>", "database": "game_poc" }
  }
]
```

`DB_DEFAULT_ADAPTER=default-local-postgres`.

The form dropdown shows the `label` and posts the `id`. The first adapter listed becomes the default if `DB_DEFAULT_ADAPTER` is unset.

---

## 5. Sequencing (best-effort; rewrite when circular-import work lands)

The repo today has zero abstraction. Doing this in one big diff will be unreviewable. The plan is a five-step migration where each step keeps `npm run build` and `npm run test:all` green.

1. **Introduce the adapter interface + Postgres adapter only.** No call site changes. The old `server/db.ts` `pool` export becomes a thin re-export of `getAdapter("default-local-postgres")`. This step proves the seam works.
2. **Move `server/auth.ts` off raw `pool.query`.** Smallest blast radius (single file, well-typed queries), good proving ground for the repo pattern.
3. **Move `server/assetRoutes.ts` off raw `pool.query`.** Second proof.
4. **Move `server/routes.ts` off raw `pool.query`.** Biggest diff — likely needs to be split into the per-resource repos (`games`, `tiles`, `events`, `snapshots`, `resources`) before the move. This is the step most likely to collide with the in-flight circular-import cleanup; defer until that lands.
5. **Add the New Game dropdown + `POST /api/games` adapter-id parameter + per-game adapter persistence on `games.db_adapter_id`.** Plus the second concrete adapter (`docker-postgress-v-1`) wired via env.
6. **(Optional, later) Oracle and MySQL adapters.** Add `oracledb` and `mysql2` as dev deps, add `server/db/adapters/oracle.ts` and `mysql.ts`, plus parallel `schema/oracle/` and `schema/mysql/`. This is the part that proves the abstraction earns its keep — Postgres-only would have been simpler.

A precommit-checker pass is required at the end of each step (per `AGENTS.md`).

---

## 6. Validation

- `npm run build` passes at every step.
- `npm run test:all` passes (smoke + multiplayer.smoke + cityView).
- New unit-level check (added in step 5 or 6): instantiate a stub adapter and assert each repo method is called through the interface, never the driver directly. This is the regression guard for "someone added a `pool.query` back to a route handler".
- Manual: spin up `docker-postgress-v-1`, register it via env, pick it in the New Game dropdown, create a game, end turn, reload — every operation routes through the second adapter, the first adapter stays untouched.
- Manual (step 6 only): spin up `mysql:8` and `oracle:21` containers locally, register them, and create games against each. Confirm `games.db_adapter_id` round-trips.

---

## 7. Out of scope

- Query builders / ORM. SQL strings inside repos are fine.
- Connection-per-tenant pooling / sharding. One pool per adapter is enough.
- Encryption-at-rest differences per vendor.
- Migrations that need vendor-specific *behaviour* (e.g. full-text search, GIS). Postgres-only features stay Postgres-only until someone actually ports them.
- Frontend re-architecture. The New Game dropdown is the only UI change.

---

## 8. Open questions

1. Does the user want `games.db_adapter_id` to be **mutable** (move a live game between backends) or **immutable** (set on create, never changed)? Recommend immutable.
2. Is `docker-postgress-v-1` going to be **the same schema** as `game_poc`? Recommend yes; if no, the per-adapter `schema/` dirs handle it, but the UI must warn the user when picking a backend whose schema doesn't match.
3. Should `initSchema()` run **per adapter on boot** or be lazy (first use)? Per-boot is simpler and matches today's behaviour; per-adapter means a flaky second backend can't take down the API. Recommend per-boot, gated by a `schemaBootstrap: false` option per adapter.
4. The in-flight circular-import cleanup may move `server/db.ts` into a new location (likely `server/db/index.ts`). All file paths in §3 are written to match that eventual shape but should be re-validated when the cleanup lands.

---

## 9. Revision log

- **2026-08-10** — initial draft. Will be revised when the in-flight circular-import work lands.
