# Plan: `database-abstraction` module + lazy schema bootstrap

**Status:** DRAFT — companion to `plan/2026-08-10-repository-abstraction-multi-db.md`. Will be revised when the in-flight circular-import cleanup lands.
**Author date:** 2026-08-10

This plan is the **module-shaped** answer to two earlier questions:

1. *"How do other modules talk to the DB without knowing the vendor?"* — the **abstraction module**.
2. *"Per-boot or lazy schema bootstrap?"* — the lazy side of the adapter lifecycle.

It is intentionally narrow: it does **not** redesign the per-game adapter selector (already covered by the multi-DB plan). It only owns the boundary between `server/*` and any concrete database.

---

## 1. Why a stand-alone module

Today the DB connection is a single `pg.Pool` exported from `server/db.ts` and reached by direct `import { pool } from "./db"`. Every consumer (`routes.ts`, `auth.ts`, `assetRoutes.ts`) treats that singleton as a global. Three problems:

- **Vendor lock-in by reachability.** A new module that wants DB access does `import { pool } from "./db"` and is now coupled to Postgres by file path, not by interface.
- **No lazy seam.** `pool` is constructed at import time; there is no place to defer work, swap impls, or memoize init.
- **No first-class concept of "an adapter."** The current code conflates *connection*, *dialect*, *schema*, and *identity* in one file.

The fix is a single module whose only public surface is **interface-shaped**, with **lazy init** as a guarantee, not an option.

---

## 2. Java idiom vs TypeScript idiom (offered)

The user is mentally modelling this in Java terms. Here's the same shape in TS and why TS is genuinely *less* ceremony, not just shorter:

| Concern | Java idiom | TypeScript idiom | Why TS is better here |
|---|---|---|---|
| Contract | `interface DatabaseAdapter` + `class PostgresAdapter implements DatabaseAdapter` | `interface DatabaseAdapter` + `function createPostgresAdapter(opts): DatabaseAdapter` | Structural typing means the return type enforces the contract; no `implements` needed and no class required. |
| Construction | `new PostgresAdapter(opts)` | `createPostgresAdapter(opts)` | Closures hide state the same way `private` fields do, without the inheritance tax. |
| Lifecycle | Constructor + Spring `@PostConstruct` | Memoized `Promise<DatabaseAdapter>` returned from `getOrInit(id)` | Lazy is the default, not a framework annotation. |
| Identity | Class name (`PostgresAdapter.class`) | String `id` (`"docker-postgress-v-1"`) | Strings survive serialization, env vars, and config files. |
| Dependency injection | Field/constructor injection via Spring/Guice/Dagger | Factory function takes adapter as a parameter: `createGamesRepository(adapter)` | No container needed; tree-shaking stays intact. |
| Type-only import | `import java.util.List` (always runtime) | `import type { DatabaseAdapter } from "..."` (erased) | Lets UI/test code reference the interface without pulling the driver into the bundle. |

**Bottom line:** if you want the Java mental model, write `class PostgresAdapter implements DatabaseAdapter`. It works. But the more idiomatic TS shape — `interface` + factory function + memoized promise — gives you the same guarantees with no inheritance, no decorators, and lazy init for free.

The plan below uses the TS idiom throughout, and §6 spells out how to make the choice explicit per-module if a future contributor prefers the class form.

---

## 3. Module shape — `server/database-abstraction/`

```
server/
  database-abstraction/
    index.ts                 # public façade: getAdapter, getRepository, getOrInit
    adapter.ts               # interface DatabaseAdapter, Transaction, QueryResult
    registry.ts              # adapter registry + memoization
    schema/
      runner.ts              # lazy schema bootstrap
      lock.ts                # cross-process lock helpers
      state.ts               # schema_migrations table schema (vendor-neutral)
    errors.ts                # RepositoryError, UniqueViolation, NotFound, ...
    types.ts                 # vendor-neutral row types
    drivers/
      postgres.ts            # createPostgresAdapter(opts): DatabaseAdapter
      oracle.ts              # createOracleAdapter(opts): DatabaseAdapter  (later)
      mysql.ts               # createMysqlAdapter(opts): DatabaseAdapter   (later)
    repositories/            # thin re-export layer so callers don't reach into drivers
      games.ts
      tiles.ts
      auth.ts
      ...
    package.json             # optional — only if we want explicit subpath exports
```

**Public surface (the only thing other modules import):**

```ts
// server/database-abstraction/index.ts
export type { DatabaseAdapter, Transaction, QueryResult } from "./adapter";
export type { AdapterId, AdapterConfig } from "./registry";
export { registerAdapter, setDefaultAdapter, getAdapter, getOrInit, listAdapters } from "./registry";
export { getRepository, type Repositories } from "./repositories";
export { RepositoryError, UniqueViolation, NotFound } from "./errors";
```

Everything else is implementation detail. **`server/db.ts` is deleted**; `server/index.ts` becomes the only place that wires adapters from env.

### 3.1 Why a folder, not a file

A single `server/db.ts` file was fine for a single pool. With N adapters, N repos, schema state, lock helpers, and a registry, the file balloons past ~600 lines and the public/private boundary blurs. Splitting into a folder with one clear `index.ts` re-export keeps the import path short (`from "./database-abstraction"`) while letting each piece grow independently.

### 3.2 Why no `package.json` (yet)

Subpath exports (`@server/database-abstraction/adapter`) are tempting for tree-shaking, but they pull in TS path mapping and an extra build step. Skip until a real consumer needs it. Single import path for now.

---

## 4. `DatabaseAdapter` interface (final)

```ts
// server/database-abstraction/adapter.ts
export type AdapterId = string & { readonly __brand: "AdapterId" };

export interface QueryParams { readonly [k: string]: unknown; }

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
  readonly id: AdapterId;
  readonly dialect: "postgres" | "oracle" | "mysql";
  query<R = Record<string, unknown>>(sql: string, params?: QueryParams): Promise<QueryResult<R>>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
```

Branded `AdapterId` prevents passing a raw string where an id is expected. Repos never see a dialect — they only see the adapter and its interface.

### 4.1 Registry (`registry.ts`)

```ts
export interface AdapterConfig {
  id: string;
  label: string;
  dialect: "postgres" | "oracle" | "mysql";
  driverOptions: Record<string, unknown>;
  schema?: { bootstrap: boolean; files?: string[] }; // see §5
}

let configs = new Map<AdapterId, AdapterConfig>();
let instances = new Map<AdapterId, Promise<DatabaseAdapter>>();
let defaultId: AdapterId | undefined;

export function registerAdapter(cfg: AdapterConfig): AdapterId { /* ... */ }
export function setDefaultAdapter(id: AdapterId): void { /* ... */ }
export function getAdapter(id: AdapterId): Promise<DatabaseAdapter>;        // lazy, memoized
export async function getOrInit(id?: AdapterId): Promise<DatabaseAdapter>;   // id? → defaultId
export function listAdapters(): readonly AdapterConfig[];                    // for UI dropdown
```

The registry **memoizes the `Promise<DatabaseAdapter>`, not the adapter itself.** First caller pays the init cost (driver import, pool creation, lazy schema bootstrap — see §5). Every subsequent caller awaits the same promise. This is the structural answer to "lazy loading" — it's not a separate code path, it's how the module works.

---

## 5. Lazy schema bootstrap

Per-boot was the simpler default in the multi-DB plan. Lazy is the right answer once the abstraction module exists, because:

- Boot stays fast even with N adapters registered.
- A flaky second backend (e.g. tailscale tunnel down) doesn't crash the API process.
- Schema work happens next to the code that needs it, in the same process, in the same `Promise`.

### 5.1 When does it run?

Lazy = **on first use of an adapter**, not on `registerAdapter` and not on boot. Concretely:

```
registerAdapter(cfg)            // stores config, creates the driver pool lazily
  └─ getAdapter(id)             // first call → new Promise
       ├─ create driver pool    // (driver-specific)
       ├─ ensureSchema(adapter) // ← idempotent schema bootstrap (see §5.3)
       └─ resolve(adapter)
  └─ getAdapter(id) (later)     // returns the same cached Promise
```

`server/index.ts` registers adapters from env and **does not call `getAdapter`** at boot. Boot only registers. Routes call `getOrInit(defaultId)` or `getOrInit(game.dbAdapterId)` on first request.

### 5.2 What "first use" means for each consumer

| Consumer | First-use trigger |
|---|---|
| Auth route (`/api/auth/*`) | First request → `getOrInit(defaultId)` |
| Lobby route (`/api/lobby/*`) | First request → `getOrInit(defaultId)` |
| Health route (`/api/health`) | Calls `ping()` on **every** adapter in parallel; first call triggers init for each |
| New Game POST `/api/games` | `getOrInit(req.body.dbAdapterId)` |
| Per-game read/end-turn | `getOrInit(game.dbAdapterId)` |

### 5.3 `ensureSchema` (the lazy DDL step)

```ts
// server/database-abstraction/schema/runner.ts
export async function ensureSchema(adapter: DatabaseAdapter): Promise<void> {
  const lockKey = `schema-bootstrap:${adapter.id}`;
  const release = await acquireLock(adapter, lockKey); // cross-process; see §5.4
  try {
    const applied = await loadAppliedMigrations(adapter);
    const files = await discoverMigrations(adapter.dialect);
    const pending = files.filter(f => !applied.has(f));
    if (pending.length === 0) return;
    await adapter.transaction(async tx => {
      for (const file of pending) {
        const sql = await readMigration(adapter.dialect, file);
        await tx.query(sql);
        await recordMigration(tx, adapter.dialect, file);
      }
    });
  } finally {
    await release();
  }
}
```

Two structural changes from today's `initSchema()`:

1. **Idempotency is no longer the only safety net.** A `schema_migrations` table tracks what has run; pending files are applied in order; concurrent processes serialise on the lock.
2. **Per-adapter scope.** Each `DatabaseAdapter` runs its own `ensureSchema` against its own DB. A failing second adapter doesn't poison the first.

### 5.4 Cross-process lock

The lock is *not* a TS-level mutex (that only helps in-process). It is a database-native lock keyed on the adapter's id:

| Dialect | Lock primitive |
|---|---|
| Postgres | `pg_try_advisory_lock(hashtext('heroes-js:schema-bootstrap:' || $1))` |
| Oracle | `DBMS_LOCK.REQUEST(lockname, timeout)` |
| MySQL | `GET_LOCK('heroes-js:schema-bootstrap:<id>', 0)` + `RELEASE_LOCK` |

The lock is wrapped in `server/database-abstraction/schema/lock.ts` behind a vendor-neutral interface so repos and `ensureSchema` don't see the differences.

### 5.5 The `schema_migrations` table

```sql
-- vendor-neutral shape; identical content under each driver
CREATE TABLE IF NOT EXISTS schema_migrations (
  dialect    TEXT NOT NULL,
  filename   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dialect, filename)
);
```

Each dialect gets its own migrations directory:

```
server/database-abstraction/schema/files/
  postgres/
    schema.sql
    migrations/001_turn_state.sql
    ...
  oracle/
    schema.sql
    migrations/001_turn_state.sql  (dialect-rewritten)
  mysql/
    schema.sql
    migrations/001_turn_state.sql  (dialect-rewritten)
```

The current `server/schema.sql` + `server/migrations/*` get **moved**, not rewritten — under `postgres/`. Oracle/MySQL dirs are empty until those adapters land.

---

## 6. Calling it from other modules

```ts
// server/routes.ts (illustrative)
import { getRepository, NotFound } from "./database-abstraction";

export async function getGame(req, res) {
  const repo = await getRepository("games", req.gameRow.dbAdapterId); // per-game, see §3 of the multi-DB plan
  const row = await repo.findByName(req.params.name);
  if (!row) throw new NotFound(`game ${req.params.name}`);
  res.json(row);
}
```

```ts
// server/auth.ts
import { getRepository } from "./database-abstraction";
const auth = await getRepository("auth");   // uses defaultId
```

```ts
// server/index.ts (boot only — no DB calls)
import { registerAdapter, setDefaultAdapter } from "./database-abstraction";
import { registerPostgresAdapter } from "./database-abstraction/drivers/postgres";

const cfgs = JSON.parse(process.env.DB_ADAPTERS_JSON ?? "[]");
for (const cfg of cfgs) registerAdapter(cfg);
setDefaultAdapter(process.env.DB_DEFAULT_ADAPTER!);
```

**Other modules do not import from `./database-abstraction/drivers/*`.** That path is internal. If a contributor reaches in, `dependency-cruiser` (per the `risk-circular-imports` plan) catches it.

### 6.1 If you really want the class form

```ts
class PostgresAdapter implements DatabaseAdapter {
  constructor(private readonly opts: PostgresOptions) {}
  // ...
}
```

Works fine — TS structural typing still applies, the registry still memoizes the promise, and `getAdapter()` still returns a `DatabaseAdapter`. The only change is that the factory is `new PostgresAdapter(opts)` instead of `createPostgresAdapter(opts)`. Nothing else in this plan depends on the choice.

---

## 7. Sequencing (best-effort; rewrite when circular-import work lands)

1. **Create `server/database-abstraction/` skeleton** with `adapter.ts`, `registry.ts`, `index.ts`, errors, types. No drivers yet. `npm run build` passes.
2. **Move the current `pg.Pool` into `drivers/postgres.ts`** as `createPostgresAdapter`. `server/db.ts` becomes a one-line re-export of `getAdapter(defaultId)` for backwards compatibility. Nothing else moves yet.
3. **Land `ensureSchema` + `schema_migrations` + cross-process lock.** Replace `initSchema()` call in `server/index.ts` with a no-op (schemas run lazily now). Validate by running twice — second boot should not re-apply any migration.
4. **Move `server/auth.ts`** off the legacy `pool` re-export and onto `getRepository("auth")`. Smoke test `/api/auth/*`.
5. **Move `server/assetRoutes.ts`** the same way.
6. **Move `server/routes.ts`** — biggest diff, most likely to collide with the in-flight circular-import cleanup. Defer if that work isn't merged.
7. **Add the second Postgres adapter (`docker-postgress-v-1`)** via env, with `bootstrap: false` in its `schema` config until the host's DB is confirmed compatible. UI dropdown follows the multi-DB plan.

Each step keeps `npm run build` + `npm run test:all` green. The precommit-checker runs at the end of each step.

---

## 8. Validation

- `npm run build` passes at every step.
- `npm run test:all` passes.
- **Lazy-init test (new):** register an adapter whose `driverOptions.host` is bogus; start the API; hit `/api/health` (which does **not** touch that adapter); confirm the API stays up. Hit a route that does use it; confirm the failure surfaces only on that call. (See §5.2.)
- **Lazy-schema test (new):** drop a new migration under `schema/files/postgres/migrations/`, restart the API, hit any DB route, confirm the migration ran. Restart again without changes; confirm `ensureSchema` is a no-op (`schema_migrations` has all rows).
- **Cross-process lock test (new):** start two API processes pointed at the same DB with the same pending migrations. Both must converge on the same final `schema_migrations` state with no duplicate `applied_at` errors.
- **Abstraction test (new):** `dependency-cruiser` rule forbids `server/(?!database-abstraction)` from importing `server/database-abstraction/drivers/*`. Catches the regression where someone reaches past the abstraction.

---

## 9. Out of scope

- The per-game adapter selector (`games.db_adapter_id`, the New Game dropdown). Owned by `plan/2026-08-10-repository-abstraction-multi-db.md`.
- Oracle/MySQL adapter implementations. The TS shape supports them; the actual driver code lands in a follow-up plan.
- Query builders, ORM, or schema generation from TS types.
- Repos themselves (their shape is in the multi-DB plan §3.2).
- Connection-per-tenant pooling or sharding.

---

## 10. Open questions

1. **Schema bootstrap opt-out flag.** Should `registerAdapter({ schema: { bootstrap: false } })` be allowed, or is schema bootstrap always on? I lean *allowed* — a `docker-postgress-v-1` DB that pre-existed and already has tables shouldn't re-run migrations on first use.
2. **Lock timeout.** `pg_try_advisory_lock` is non-blocking. If another API process is mid-migration, what should this process do: (a) busy-wait, (b) return and retry on next request, (c) fail the request? Lean (b).
3. **Health endpoint behaviour.** Should `/api/health` trigger init on every registered adapter (current plan), or only the default? Triggering every adapter gives a true "all backends reachable" signal but means a broken second backend delays `/api/health`. Lean toward "ping only the default, expose a separate `/api/health/all` for the full check."
4. **Where does `local/` go?** The current `server/db.ts` lives outside `database-abstraction/`. The migration will delete it. Confirm that's acceptable (yes per `AGENTS.md` coding constraints, but flag for review).

---

## 11. Revision log

- **2026-08-10** — initial draft. Will be revised when the in-flight circular-import cleanup lands and when step 6 of the multi-DB plan (the per-game selector) is built against this module.
