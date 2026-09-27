# Plan (fable): `server/db/` module + adapter lifecycle

**Status:** Second-opinion rewrite of `plan/2026-08-10-database-abstraction-module.md`. Written 2026-08-11, post-cycle-cleanup (`architecture/circular-dep-cleanup`, commit `526398e`).
**Companion:** `plan/2026-08-10-repository-abstraction-multi-db.fable.md` (repos, per-game selection, dropdown, sequencing). This plan owns the module shape, the `DatabaseAdapter` interface, and the init/schema lifecycle. The companion consumes them.

---

## 1. What's different from the original plan

| # | Original | Fable version | Why |
|---|---|---|---|
| 1 | Module at `server/database-abstraction/` | **`server/db/`** | Shorter import path, matches the multi-DB plan's location so the two drafts stop describing two different module homes, and `db` is what the folder is. "database-abstraction" names the pattern, not the thing — folder names should name the thing. |
| 2 | Everything lazy: boot only registers, ALL adapters init on first request | **Split lifecycle: default adapter eager at boot, extra adapters lazy** | Fully-lazy moves connection/schema failures from boot (where the dev is watching the terminal) to the first request (where a player is watching a spinner). For a single-DB dev setup — today's reality — eager boot for the default preserves the current fail-fast behaviour. Lazy earns its keep only for optional secondary backends over flaky links (the tailscale host), so that's the only place it applies. |
| 3 | Branded `AdapterId` type (`string & { __brand }`) | **Plain `string`** | Adapter ids come from env JSON and DB rows — they're strings at every boundary that matters. The brand adds cast ceremony (`as AdapterId`) at exactly those boundaries and prevents nothing in practice. Validation belongs in `registerAdapter` (reject unknown dialects, duplicate ids), not in the type system. |
| 4 | `repositories/` live inside the abstraction module | Kept in `server/db/repositories/` (same call), but the façade exports repos and *nothing driver-shaped* | Same conclusion, stated harder: the ONLY public imports are `getRepository`, `listAdapters`, error types. `getAdapter` is internal — see §3. If routes can grab a raw adapter they'll write inline SQL with it, and the repo layer becomes optional decoration. |
| 5 | Java-vs-TS idiom comparison table (§2 of original) | **Dropped** | Educational content, not plan content. One line suffices: use `interface` + factory functions; a `class ... implements` also satisfies the interface if a contributor prefers it. |
| 6 | Cross-process lock designed for 3 dialects | Postgres advisory lock only; lock interface stays vendor-neutral | Same reasoning as the companion's Appendix A: no non-Postgres backend exists. Write `pg_advisory_lock` behind `acquireLock(adapter, key)` and stop there. |
| 7 | Open questions §10 (bootstrap opt-out, lock timeout, health behaviour) | **Decided** — see §4.2, §5.2, §6 | Drafts that ship open questions ship their indecision. Answers below; revisit if reality disagrees. |

Kept from the original (it was right): memoized `Promise<DatabaseAdapter>` as the lazy mechanism, `schema_migrations` tracking table, per-dialect schema directories, `ensureSchema` idempotency, delete `server/db.ts` at the end, depcruise as the boundary guard.

---

## 2. Module shape

```
server/
  db/
    index.ts              # PUBLIC façade — the only import surface
    adapter.ts            # DatabaseAdapter, Transaction, QueryResult (interfaces only)
    registry.ts           # register/resolve/memoize (internal)
    errors.ts             # RepositoryError, UniqueViolation, NotFound
    types.ts              # vendor-neutral row types
    drivers/
      postgres.ts         # createPostgresAdapter(opts): DatabaseAdapter
    repositories/
      games.ts            # createGamesRepository(adapter)
      auth.ts
      assets.ts
      units.ts
      lobby.ts
    schema/
      runner.ts           # ensureSchema(adapter)
      lock.ts             # acquireLock(adapter, key) — pg advisory lock behind neutral iface
      postgres/
        schema.sql        # moved from server/schema.sql
        migrations/*.sql  # moved from server/migrations/
```

### 2.1 Public façade — deliberately smaller than the original's

```ts
// server/db/index.ts
export type { DatabaseAdapter, Transaction, QueryResult } from "./adapter";
export type { AdapterConfig } from "./registry";
export { registerAdapter, setDefaultAdapter, listAdapters, initDefaultAdapter, closeAll } from "./registry";
export { getRepository, type Repositories } from "./repositories";
export { RepositoryError, UniqueViolation, NotFound } from "./errors";
```

Differences from the original façade:
- **No `getAdapter` / `getOrInit` export.** Routes get repositories, not adapters. Repos resolve adapters internally via the registry. The moment a route can hold a `DatabaseAdapter`, someone writes `adapter.query("SELECT ...")` in a handler and the seam is dead. (`DatabaseAdapter` stays exported as a *type* for tests and future driver authors.)
- **`initDefaultAdapter()` added** — the explicit eager-boot call for `server/index.ts` (§4).
- **`closeAll()` added** — SIGINT handler needs it; the original never said who closes what.

### 2.2 Adapter interface

Identical to the original's §4 minus the brand:

```ts
export interface DatabaseAdapter {
  readonly id: string;
  readonly dialect: "postgres" | "oracle" | "mysql";
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
```

Note `params` is a positional array, not the original's named-params object — see companion §1 row 1 (`pg` has no native named binds; today's queries are all positional).

---

## 3. Registry (internal)

```ts
// server/db/registry.ts — nothing here except AdapterConfig/register/set/list is public
const configs = new Map<string, AdapterConfig>();
const instances = new Map<string, Promise<DatabaseAdapter>>();
let defaultId: string | undefined;

export function registerAdapter(cfg: AdapterConfig): void;     // validates id/dialect, stores config
export function setDefaultAdapter(id: string): void;
export function listAdapters(): readonly { id: string; label: string }[];  // safe for UI — no driverOptions leak
export async function initDefaultAdapter(): Promise<void>;     // eager path, called once at boot
/* internal */ function resolveAdapter(id?: string): Promise<DatabaseAdapter>;  // lazy, memoized promise
```

Memoize the **promise**, not the adapter (original had this right): first caller pays driver import + pool creation + `ensureSchema`; everyone else awaits the same promise. A **rejected** promise is evicted from the map so the next request retries instead of caching the failure forever — the original never addressed poisoned-promise eviction, and over a tailscale link it will happen.

`listAdapters()` returns `{ id, label }` only. The original returned full `AdapterConfig[]` — that leaks `driverOptions` (credentials) to whatever calls it, and the one consumer is a UI dropdown.

---

## 4. Lifecycle: eager default, lazy extras

```
server/index.ts boot:
  registerAdapter(each cfg from DB_ADAPTERS_JSON)
  setDefaultAdapter(DB_DEFAULT_ADAPTER)
  await initDefaultAdapter()        // pool + ensureSchema; throws → process exits (fail-fast, same as today)
  app.listen(...)
  SIGINT → closeAll()

any other adapter (e.g. docker-postgres-v-1):
  first request that names it → resolveAdapter(id) → pool + ensureSchema (if bootstrap !== false)
  failure → request-scoped error; API stays up; promise evicted for retry
```

### 4.1 Why not fully lazy (the original's position)

The original argued lazy keeps boot fast and protects against a flaky second backend. Both true — for the *second* backend. For the default: today `initSchema()` failing at boot is a loud, immediate signal in the dev terminal. Fully-lazy converts that into a 500 on first request, discovered later, debugged backwards from a browser. Eager-default keeps dev feedback tight; lazy-extras gets the resilience where flakiness actually lives. `/api/health` pings the default only; `/api/health/all` (new, optional) pings everything — which resolves the original's open question §10.3 the same way it leaned.

### 4.2 Bootstrap opt-out (original's open question §10.1 — decided: yes)

`AdapterConfig.schema?: { bootstrap: boolean }`, default `true`. The tailscale host is a pre-existing DB that already has tables; first use should verify (`ping()` + check `schema_migrations` exists) and NOT apply DDL. Set `bootstrap: false` for it.

---

## 5. Schema: `ensureSchema` + migrations table + advisory lock

Same design as the original §5.3–§5.5, Postgres-scoped:

- `schema_migrations (dialect, filename, applied_at, PRIMARY KEY (dialect, filename))`
- `ensureSchema(adapter)`: acquire advisory lock → load applied set → apply pending files in order, each recorded in the same transaction → release.
- Move `server/schema.sql` + `server/migrations/*` → `server/db/schema/postgres/` unmodified.

### 5.1 One correction to the original's runner

The original applied **all pending migrations inside a single transaction**. Postgres allows transactional DDL, so that works — until a migration contains `CREATE INDEX CONCURRENTLY` or another non-transactional statement, and the whole batch aborts confusingly. Apply **one transaction per migration file** instead: partial progress is recorded per file, failure points at the exact file, and re-run resumes from it.

### 5.2 Lock behaviour (original's open question §10.2 — decided: blocking with timeout)

Use blocking `pg_advisory_lock` with a `statement_timeout` (~30s) rather than the original's non-blocking `pg_try_advisory_lock` + retry policy. Process B waits while process A migrates, then wakes, sees nothing pending, and continues. Simpler than a retry state machine, and 30s covers any migration this repo has.

---

## 6. Call-site shape

```ts
// server/routes.ts — repos only, no adapter in sight
import { getRepository, NotFound } from "./db";

const games = await getRepository("games", gameRow.db_adapter_id ?? undefined);
const row = await games.findByName(name);
if (!row) throw new NotFound(`game ${name}`);
```

```ts
// server/index.ts — boot
import { registerAdapter, setDefaultAdapter, initDefaultAdapter, closeAll } from "./db";
```

Depcruise rule (same as companion §4) makes `server/db/{drivers,schema,registry}` unreachable from the rest of `server/`. The gate already runs `lint:deps`; the rule is the enforcement the original wished for in its §6 — it exists now.

---

## 7. Sequencing

Owned by the companion plan (§5 there) — this module is steps 1–2 of that sequence. Not duplicated here; two plans with two sequencings for the same files is how steps get done twice or not at all.

---

## 8. Validation (delta from companion's)

- **Boot fail-fast test:** point default adapter at a bogus host → process exits non-zero at boot with a connection error (same as today's behaviour).
- **Lazy-extra test:** bogus second adapter → boot succeeds, `/api/health` OK; request naming it → clean error; fix the host; same request → works (proves promise eviction).
- **Migration resume test:** make migration file N fail mid-batch → `schema_migrations` shows files < N applied; fix N; re-run → resumes at N (proves per-file transactions, §5.1).
- **Concurrent-boot test:** two API processes, same DB, pending migrations → both converge, no duplicate-application errors (proves blocking lock, §5.2).
- **Boundary test:** temporary import of `./db/drivers/postgres` from `routes.ts` → `npm run lint:deps` fails.

---

## 9. Out of scope

Unchanged from the original: per-game selector UI (companion), Oracle/MySQL driver code (companion Appendix A), query builders/ORM, multi-tenant pooling, sharding.

---

## Revision log

- **2026-08-11** — fable rewrite: module renamed to `server/db/`, split lifecycle (eager default / lazy extras), dropped branded id and Java-idiom section, façade no longer exports raw adapter access, credentials scrubbed from `listAdapters()`, poisoned-promise eviction added, per-file migration transactions, blocking advisory lock, all three open questions decided.
