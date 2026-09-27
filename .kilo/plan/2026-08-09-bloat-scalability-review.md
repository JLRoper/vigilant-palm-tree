# heroes-js — Architectural Review: Bloat Prevention, Scalability, Expandability

*Review date: 2026-08-09. Companion to `plan/2026-08-09-architecture-walkthrough-tailscale.md`. Focus: how to keep the codebase from accreting dead weight and how to make the next 10 features cheap to add.*

This is organized as a numbered list of recommendations, each with **what** to change, **why** it matters (bloat, scaling, expansion — the three axes you asked about), and **how** to do it concretely. Order is roughly "highest leverage first".

---

## R1. Stop stashing domain state in JSONB blobs

**What.** The `games` row carries `players`, `heroes`, `settlements`, `enemy_positions`, `lobby` as JSONB. The same rows also have structured columns `turn`, `round`, `day`, `gold`, `active_player_id`. Two sources of truth for the same facts.

**Why.**
- *Bloat:* every reducer that mutates state has to remember to JSON.stringify the new value AND update the structured column. That's N places to forget, and you only notice when one drifts.
- *Scaling:* you can't index, join, or aggregate over fields inside the JSONB without `jsonb_path_ops` GIN indexes and ugly operators. Any future "list all my heroes across games" feature becomes a special case.
- *Expansion:* adding the army/food systems (already deferred in `docs/README.md`) means more JSONB blobs, more drift, more bugs. Better to migrate once.

**How.**
- Phase 1: keep the JSONB columns as a read-side convenience, but compute them in the API from the structured tables. Don't write to them.
- Phase 2: drop the JSONB columns entirely once the structured tables can answer the same queries (`games_heroes`, `games_settlements`, `games_players`, `games_enemies`).
- Phase 3: `games` row shrinks to "metadata" — `id, name, seed, map_size, round, day, active_player_id, created_at, updated_at`. State lives in normalized tables.

This is the single highest-leverage refactor in the project.

---

## R2. Make `initSchema()` concurrency-safe

**What.** `server/db.ts` runs every migration on every boot. Two API processes pointing at the same DB (which is exactly the Tailscale plan from doc 1) will race.

**Why.**
- *Bloat:* non-idempotent migrations (e.g. `CREATE INDEX CONCURRENTLY`, `UPDATE … SET …`, `INSERT … SELECT …`) will silently produce wrong results under concurrency. The current SQL files are all idempotent by accident, not by design.
- *Scaling:* the moment you add a second service that owns schema (a realtime gateway, an analytics worker, an admin tool), this becomes a landmine.
- *Expansion:* "concurrent boot" is the baseline condition for any multi-machine dev. Address it now while the migration count is 8, not 80.

**How.**
```ts
export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('heroes-js-schema'))");
    // ... run schema.sql + migrations ...
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
```
Bonus: add a `schema_migrations` table that records `version, applied_at, sha256(sql)` and skip migrations already applied. Pure idempotency at the application level.

---

## R3. Treat `initSchema()` as a separate process from boot

**What.** Move schema bootstrap out of `server/index.ts` startup into its own npm script (`db:migrate`), and have the API refuse to start if the schema is missing or stale.

**Why.**
- *Bloat:* today, every API boot does SQL DDL. That's work the API shouldn't be doing. The DDL is also a hidden coupling — you can't deploy the API without being able to ALTER tables.
- *Scaling:* once you split schema ownership from runtime (a normal step on the road to prod), the migration step can run as a one-shot in CI, a k8s Job, a Tailscale side-script, etc.
- *Expansion:* new contributors won't accidentally double-apply migrations or block boot on a transient DB hiccup.

**How.** `package.json`:
```json
"db:migrate": "tsx scripts/migrate.ts",
"predev": "npm run db:migrate && pwsh scripts/ports.ps1",
```
`server/index.ts` should call `assertSchemaCurrent()` (a version check) rather than `initSchema()`.

---

## R4. Centralize the Postgres pool and add a query helper

**What.** Right now every route handler in `server/routes.ts` opens its own `pool.query(...)` or `pool.connect()` inside `withTransaction`. Some routes do `JSON.stringify(...)` themselves; some don't.

**Why.**
- *Bloat:* ~300 lines of per-route boilerplate that varies by author. Inconsistent error handling, inconsistent JSON encoding, inconsistent transaction boundaries.
- *Scaling:* when you add row-level locking (`SELECT … FOR UPDATE`), optimistic concurrency (`updated_at` checks), or a write-through cache, you want one place to change it.
- *Expansion:* new routes copy-paste the patterns that exist today. If those patterns are wrong (e.g. forgetting to lock the row you're about to mutate), every new route is wrong.

**How.** Add to `server/db.ts`:
```ts
export async function updateGame<T>(
  name: string,
  mutator: (row: FullGameRow, client: PoolClient) => Promise<T>,
  opts?: { expectActivePlayerId?: number }
): Promise<T>;
```
Routes call `updateGame(name, async (row, client) => { … })` and the helper owns SELECT/UPDATE/JSON encode/COMMIT/ROLLBACK/error formatting.

---

## R5. Introduce a single typed client API surface

**What.** `src/io/api.ts` already exists. Make sure every server route has a single exported TypeScript type that flows from the route handler through the response into `api.ts`. Today the response shape is implied, not declared.

**Why.**
- *Bloat:* every time a route field is renamed (e.g. `enemy_positions` → `enemyPositions`), the client breaks silently if a `GameState` field gets typed as `any`.
- *Scaling:* once you split client/server, the only contract between them is the wire format. Codifying it removes a whole class of "works on my machine" bugs.
- *Expansion:* new endpoints become "add type in `shared/api/`, add route in `server/`, add method in `src/io/api.ts`" — three mechanical steps.

**How.**
- New folder `shared/api/` with one `.ts` per route, e.g. `shared/api/endTurn.ts`:
  ```ts
  export interface EndTurnRequest { state: GameState; }
  export interface EndTurnResponse { round: number; day: number; activePlayerId: number; players: Player[]; }
  export const END_TURN_PATH = (name: string) => `/api/games/${name}/end-turn` as const;
  ```
- `server/routes.ts` imports the type, sets `res.json(result satisfies EndTurnResponse)`.
- `src/io/api.ts` imports the type, asserts the response.

---

## R6. Promote `shared/` to the only place that holds domain types

**What.** Right now `server/routes.ts` imports types from `src/state/gameState.ts` and `src/state/units.ts`. That means the API depends on the client bundle's source tree. It works because `tsc --noEmit` and `tsx` both type-check it, but it inverts the dependency direction: the server should not depend on `src/`.

**Why.**
- *Bloat:* `src/` is the client. Anything you put in `src/` for server convenience becomes a client-bundle dep. The server's transitive dependency on Vite-only modules will eventually bite you.
- *Scaling:* the moment you split the client and server into separate packages (or repos), this dependency breaks the build.
- *Expansion:* new domain types should land in `shared/` first, then be imported by both `src/` and `server/`. That keeps the layering honest.

**How.** Move `GameState`, `HeroState`, `SettlementState`, `Player`, `Platoon`, `UnitType` into `shared/state/` and `shared/combat/`. Update imports in both `src/` and `server/`. One PR, mechanical.

---

## R7. Replace the JSONB `lobby` column with a `lobbies` table

**What.** `games.lobby` (JSONB) is a structured object: `{ seats, humanSlots, claimed: Record<seat, {handle, claimedAt}>, startedAt }`. It deserves its own table.

**Why.**
- *Bloat:* every lobby mutation is `UPDATE games SET lobby = $1::jsonb` — you rewrite the whole blob to flip one seat's `claimed`.
- *Scaling:* "who's in which lobby" is a query you'd want to run from a future matchmaking service. Can't do that against a JSONB blob without unnest gymnastics.
- *Expansion:* lobby features (chat, ready checks, draft mode, AI fills) all add fields to this object. Each one is a JSON rewrite today; each one is an ALTER TABLE tomorrow. Migrate now while it's still small.

**How.** `lobbies(game_id PK, seats, human_slots, started_at)` and `lobby_seats(lobby_id, seat, handle, claimed_at)`. Foreign keys do the referential integrity you can't enforce on JSONB.

---

## R8. Strip the "vibe" out of the port allocator

**What.** `scripts/ports.ps1` writes `CLIENT_PORT`, `API_PORT`, `WS_PORT`, `REDIS_PORT` to `.env`. Of those, `REDIS_PORT` is reserved for a service that doesn't exist yet, `WS_PORT` is reserved for a layer that isn't built yet, and `DB_PORT` is written by `cleanup.ps1`/`dev-status.ps1` but ignored by `server/db.ts`.

**Why.**
- *Bloat:* dead env keys in `.env` confuse new contributors ("why is `REDIS_PORT` here? do I need Redis?") and lie to scripts that scan them.
- *Scaling:* when the WS layer actually lands, you'll add it then — and the port allocation story will already be tested.
- *Expansion:* new ports should be added when the feature that needs them lands, not preemptively.

**How.** Remove `WS_PORT` and `REDIS_PORT` from `ports.ps1` until something actually uses them. Remove the `DB_PORT` parsing from `cleanup.ps1` and `dev-status.ps1` (or wire it through if you decide the DB will ever be per-worktree, which it won't). One commit.

---

## R9. Extract the reducer pipeline from `routes.ts`

**What.** `POST /games/:name/end-turn` runs an entire economy pipeline inside a single transaction (settlement snapshots, resource_transactions rows, game_events, players update). That's ~150 lines of business logic inside an HTTP handler. Same shape appears in `resolve-battle` and `transfer`.

**Why.**
- *Bloat:* business rules change more often than HTTP routes. Right now changing "what counts as auto-trade" means editing a 150-line transaction inside a route handler.
- *Scaling:* the moment you add a background tick worker (e.g. an AI turn loop, a fog-of-war reveal pass), it needs to call the same pipeline as the HTTP handler. Can't share code that's nested inside a route.
- *Expansion:* new turns/events (sieges, weather, plagues, seasonal modifiers — all listed as deferred in `docs/README.md`) will be variations on the same shape. Make the shape a function.

**How.** Move each pipeline into `shared/turns/` (or `server/services/`):
```ts
// shared/turns/endTurn.ts
export async function runEndTurn(
  client: PoolClient,
  gameId: number,
  incomingState: GameState
): Promise<EndTurnResult> { /* the entire transaction body */ }
```
Route handler becomes a 5-line shim: parse, call, respond.

---

## R10. Add a tiny domain-event bus

**What.** `game_events` already exists in the schema and is being written (`turn_ended`, `round_ended`, `round_started`, `ai_turn_started`, `combat_resolved`, `transfer_gold`, `resources_traded`, `move_completed`). But there's no in-process equivalent — handlers talk to each other via direct calls and shared state.

**Why.**
- *Bloat:* when you add "post a chat message when a settlement is captured", you'll either (a) edit the settlement-capture route to also call the chat publisher, or (b) build an event bus. (a) is faster once and slower every time after.
- *Scaling:* the smoke test already has a `dev-console.md` plan for inspecting events in real time. That plan needs an in-process bus, not just DB rows.
- *Expansion:* AI hooks ("after combat_resolved, trigger AI retaliation"), analytics ("log every turn_ended to a metric"), and the deferred fog-of-war system all want to subscribe to game events.

**How.** A minimal bus:
```ts
type GameEvent = { kind: string; payload: unknown; gameId: number };
const subs = new Set<(e: GameEvent) => void>();
export function publish(e: GameEvent) { for (const s of subs) s(e); }
```
DB write happens inside `publish`, not inside each route. Optional, pure-side subscribers can be added without touching the routes.

---

## R11. Cut the schema-coupling in `POST /games`

**What.** `POST /games` regenerates the world map on every save and bulk-inserts tiles. The `map_size` column is the parameter. The reducer pipeline imports `GameMap`, `mulberry32`, `makeInitialStatePayload` from `src/`.

**Why.**
- *Bloat:* the server imports the client-side map generator. Two consequences: (1) bundling the API for prod pulls in the whole client-side map code, (2) every map gen tweak needs to be reviewed as a server-side change.
- *Scaling:* when you add new map sizes, biomes, or scripted seeds, you don't want a server restart just to regenerate.
- *Expansion:* a future "share my seed" feature should let a player generate a world on the client and only the seed + initial state need to reach the server.

**How.** Move `GameMap`, `mulberry32`, `makeInitialStatePayload`, `mapSize` types into `shared/map/`. Keep `server/routes.ts` thin — it only validates inputs and stores rows. The actual map generation can run in the client (for previews) and the server (for canonical state), sharing one implementation through `shared/`.

---

## R12. Standardize the `.env` shape and load order

**What.** Today, `.env` carries port assignments from `ports.ps1`, `LAN_HOST` from the user, and is parsed by both `vite` (auto) and `tsx --env-file=.env`. There's no `.env.example` entry for `PGHOST`/`PGUSER`/etc., and process env overrides `.env` ad-hoc in `ports.ps1`.

**Why.**
- *Bloat:* contributors don't know which env vars exist. The defaults are spread across `db.ts`, `index.ts`, `ports.ps1`, and `vite.config.ts`.
- *Scaling:* a `.env.schema` (or even just a `config.ts` that reads env once at boot, validates types, and exports a typed object) makes the entire runtime config one file. Tools like `envalid` or `zod` make this trivial.
- *Expansion:* every new feature needs config; the easier that is to add, the less friction there is.

**How.** Single source of truth:
```ts
// server/config.ts
import { z } from "zod";
export const Config = z.object({
  API_PORT: z.coerce.number().default(3001),
  LAN_HOST: z.enum(["0", "1"]).default("0"),
  PGHOST: z.string().default("localhost"),
  PGPORT: z.coerce.number().default(5432),
  PGUSER: z.string().default("gameuser"),
  PGPASSWORD: z.string().default("gamepass"),
  PGDATABASE: z.string().default("game_poc"),
}).parse(process.env);
```
`server/db.ts` and `server/index.ts` import `Config` instead of reading `process.env` directly.

---

## R13. Stop using `UPSERT … DO UPDATE` on `POST /games`

**What.** `POST /games` does `INSERT … ON CONFLICT (name) DO UPDATE SET …`. This silently overwrites an existing game when a client retries or sends the same name twice.

**Why.**
- *Bloat:* "save game" and "create game" use the same endpoint. That's why upsert exists. But the semantic is confusing and destructive.
- *Scaling:* you can't add "soft delete" or "restore from history" while `POST /games` clobbers.
- *Expansion:* the natural split is `POST /games` (create, 201) and `PATCH /games/:name` (update, partial). The existing `PATCH /games/:name` is already there for `spend_movement`; extend it for general updates.

**How.** Two commits:
1. Make `POST /games` strict insert (no `ON CONFLICT`); 409 on duplicate name.
2. Move state-mutation updates from the `POST /games` upsert path to `PATCH /games/:name` with explicit fields.

---

## R14. Replace the bespoke port allocator with something boring

**What.** `scripts/ports.ps1` is ~170 lines of PowerShell that scans ports, takes cross-platform forks (`.NET TcpClient` on Windows, `ss` on Linux), writes lock files in `%TEMP%/heroes-js-ports`, etc. It's clever.

**Why.**
- *Bloat:* ~170 lines of platform-specific shell to do something Node can do in 5 lines (`net.createServer().listen(0)`). Every time PowerShell ships a breaking change in CI, this script has to be patched.
- *Scaling:* `npm run dev:status`, `npm run test:*`, `cleanup.ps1`, `predev` — they all read the same `.env` keys this script writes. That coupling is fine; the implementation isn't.
- *Expansion:* new contributors will not touch this script. When it breaks, only one of you can fix it.

**How.** A 30-line `scripts/ports.mjs`:
```js
import net from "node:net";
const claim = (base) => new Promise((res, rej) => {
  const s = net.createServer();
  s.listen(base, () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on("error", () => { /* try base+1 next */ });
});
```
Have `predev` invoke it via `node scripts/ports.mjs`. One file, no platform branching, no lock files, no `ss`.

---

## R15. Add explicit "this is the deferred pile" surface

**What.** `docs/README.md` lists deferred items inline ("tactical combat, army upkeep + food, fog of war, in-settlement mines, real email delivery"). They're scattered.

**Why.**
- *Bloat:* "what's not built" lives in `docs/README.md`, `AGENTS.md`, individual design docs, and code comments. The next contributor has to grep for "deferred" to know what not to touch.
- *Scaling:* a single deferred-features doc becomes the input to roadmap planning.
- *Expansion:* when you un-defer fog of war, you have one doc to update.

**How.** New `plan/deferred.md` (or a section in `README.md`) listing: feature, why deferred, what unlocks it, who owns unblocking it. Maintain as part of every PR.

---

## R16. Add per-feature folders under `src/`, not per-layer

**What.** `src/` is organized by technical layer: `state/`, `views/`, `managers/`, `systems/`, `entities/`, `render/`, `map/`, etc. New features tend to scatter across many of these.

**Why.**
- *Bloat:* adding "siege warfare" means editing `state/gameState.ts`, `state/turnController.ts`, `views/battleModal.ts`, `views/settlementInfoMenu.ts`, `managers/GameActions.ts`, `economy/`, `server/routes.ts`, etc. No file owns the feature end-to-end.
- *Scaling:* at 5 features this is fine; at 20 it's not. You'll spend more time grepping for "where does siege code live" than writing it.
- *Expansion:* the same pattern (`src/features/siege/{state,view,actions,server}.ts`) makes new features cheap to scope, easy to remove, easy to test.

**How.** This is a bigger refactor — don't do it now, but commit to it the next time you add a non-trivial feature. New feature first lands in `src/features/<name>/`. When it stabilizes, lift the parts into existing folders.

---

## R17. Stop handcrafting SQL strings

**What.** `server/routes.ts` has multiple hand-rolled INSERT/UPDATE statements with `$${i++}` placeholders and manual JSON encoding. Easy to make a typo, easy to forget a column.

**Why.**
- *Bloat:* every column rename touches N routes. Column drift between routes and `schema.sql` is silent.
- *Scaling:* you don't have an ORM today and shouldn't add one for a project this size. But a 30-line query builder for the common patterns (`upsert`, `selectFullGame`, `updateGameJsonb`) removes 80% of the handcrafting.
- *Expansion:* new routes get a template. Errors become type-checked.

**How.** Optional, low-priority: extract `server/queries.ts` with named constants for the columns and parameterized builders. Skip if the route count stays small.

---

## R18. Make CORS, auth, and rate-limiting first-class

**What.** `app.use(cors())` is the entire security boundary. There's no auth on `/api/games` reads. There's no rate limit.

**Why.**
- *Bloat:* "we'll add auth later" is the most common way a hobby project's DB leaks. With Tailscale the threat model is small, but it's nonzero.
- *Scaling:* the moment you add auth, you'll touch every route. Adding it before you have 30 routes is 10x cheaper than after.
- *Expansion:* the deferred "real email delivery for sign-in codes" (per `README.md`) implies an auth layer that already works.

**How.** A minimal middleware:
```ts
app.use("/api", (req, res, next) => {
  const origin = req.header("Origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).end();
  next();
});
```
Even simpler: rely on Tailscale ACLs to keep the API off the public internet and don't add per-route auth until you have a reason.

---

## R19. Stop storing `gold` on `games` as a denormalized sum

**What.** `games.gold` is `sum(heroes.gold) + sum(settlements.gold)` (see `sumPlayerGold`). It's written on every `end-turn`, `resolve-battle`, and `transfer`.

**Why.**
- *Bloat:* three different code paths recompute the same sum. The moment you forget one (e.g. add a new "spend gold on building" action without updating `games.gold`), the column drifts.
- *Scaling:* the column is never read except as a back-compat shim. Drop it.
- *Expansion:* any new gold-affecting action is one less place to forget.

**How.** Remove the column from the INSERT/UPDATE list. If something reads it, compute it on demand.

---

## R20. Version the wire format

**What.** `src/io/api.ts` and `server/routes.ts` share types via `src/state/`. If you rename a field, the client breaks.

**Why.**
- *Bloat:* "no breaking changes" becomes "we can't rename anything ever".
- *Scaling:* when you ship a mobile client or a friend uses an old build, you need versioning.
- *Expansion:* future proof.

**How.** Either:
- (a) Add a `version: 1` envelope to every response (`{ v: 1, data: ... }`) and version-bump when fields change. Or
- (b) Ship the API contract as OpenAPI and generate types from it.

(a) is cheaper; (b) is better long-term.

---

## Summary — what to do first

If you only have time for three changes, do these:

1. **R2 — concurrency-safe `initSchema()`.** Required for the Tailscale plan; one file change.
2. **R6 — move domain types to `shared/`.** Unblocks R4, R5, R11. Mechanical refactor.
3. **R1 — stop writing to JSONB state columns.** Longest payoff, longest tail. Start by adding the structured tables in parallel and writing both; deprecate the JSONB writes when the readers stop needing them.

Everything else in this list is in service of: making the next 10 features cheap to add without growing the codebase in directions you'll regret.

---

## How this doc relates to the rest of the project

- `plan/2026-08-09-architecture-walkthrough-tailscale.md` — what the code does today and how to share the DB over Tailscale.
- This doc — how to refactor so the code doesn't grow worse over time.
- `TECHNICAL_SPECIFICATIONS.MD` — the canonical tech-stack reference.
- `docs/architecture.md` — the executed layout plan for `src/`. This review doesn't supersede it; it extends it with bloat-prevention guidance.
- `AGENTS.md` — coding constraints. Every recommendation here is compatible with those constraints.
