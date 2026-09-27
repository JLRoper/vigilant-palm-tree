# Plan: Issue #89 — track and phase assignment (settlement_snapshots / resource_transactions audit writes)

*Authored 2026-08-17. Scoping decision for [#89](https://github.com/JLRoper/vigilant-palm-tree/issues/89) ("EndTurn cutover stopped writing settlement_snapshots and resource_transactions rows"). Reads against `plan/2026-08-16-phase-3-parallel-dev-plan.md` (the doc the cutover was executed against) and `plan/2026-08-16-parallel-dev-phases-3-5.md` §4/§5 (track split + file-ownership matrix). All file:line references are against `github/main` @ `33260a2` (PR #87 merge) — the local `main` worktree is 9 commits behind and its line numbers differ.*

## Answer up front

**Phase 3 — not Phase 4. Both tracks, sequenced 3.B → 3.A, and the issue only closed on Track 3.A.** ✅ **Resolved by PR #92** (merge `6688f7b`, 2026-08-17 01:21 EDT).

| | Track | Deliverable | Status |
|---|---|---|---|
| Step 1 | **Track 3.B (Dev B)** | `gameRepo.insertSettlementSnapshots` / `insertResourceTransactions` + repo tests | ✅ Done — merged in PR #92 (`e955e83`) |
| Step 2 | **Track 3.A (Dev A)** | Extend `commandHandler.ts`'s `GameRepo` interface, wire the two calls into the `EndTurn` case, extend `test/helpers/mockRepos.ts` | ✅ Done — merged in PR #92 (`470697f`) |

Schedule slot: **Phase 3, Week 2 remediation** — this was unfinished business from the Week 2 `EndTurn` port (PR #87), not new Week 3+ scope. It was sequenced after #88's fix (which is live data loss) and before the Week 3+ command bulk (TradeResources / ResolveBattle / RecruitHero / …), which itself landed in PR #91.

## Why "both tracks" is the answer, and why Track A owns the issue

The plan's own file-ownership matrix (`2026-08-16-parallel-dev-phases-3-5.md` §5) splits exactly along the two halves this fix needs:

- `server/persistence/repositories/*` → **Dev B**. The two `INSERT`s are plain CRUD against tables that already exist (`server/migrations/003_resource_tables.sql`); by the phase-3 plan's "Pre-agreed repo interface" rule (*"tiles/events/snapshots/resources fold into the big repo until their query count justifies a file"*) they belong on `gameRepo.ts` (`gameRepo.ts:65`), not a new `snapshotRepo.ts`. One call site exists today, so no split is justified.
- `server/app/commandHandler.ts` → **Dev A**. Nothing writes until the `EndTurn` case calls those methods (`commandHandler.ts:185-253`).

`commandHandler.ts` declares its *own* structural copy of the repo interface (`commandHandler.ts:24`, deliberately, per its comment) and `dependency-cruiser.cjs:87-96` forbids anything else under `server/app/` or `server/http/` from importing repos directly. So Track 3.B can add methods to the real repo unilaterally, but they are unreachable until Track 3.A widens the interface at `commandHandler.ts:24` and calls them. **A Track-B-only PR does not fix #89** — which is exactly the state branch `e955e83` is in today (its own test comment concedes this: *"server-side wiring into EndTurn itself is tracked separately"*). The branch name says `track-a`; its contents are entirely Track B.

**Verdict:** file #89's remaining work as a Track 3.A task, with the already-written Track 3.B repo PR landing first as its prerequisite. Part of both halves already exists locally — see "Audit of the existing worktree" below for what's done, what's missing, and what's currently broken.

## Why Phase 3, not Phase 4

Four independent reasons, strongest first:

1. **No schema change is needed, so the plan's "no schema changes in Phase 3" fence doesn't apply.** Both tables have existed since `server/migrations/003_resource_tables.sql` (indexed; `settlement_snapshots` unique on `(game_id, settlement_id, day)`). This is a *restoration of writes to existing tables*, which is precisely Phase 3 work ("port endpoints onto commands against the current schema").
2. **The lost rows are unrecoverable time-series, and every day of play widens the hole.** Unlike #88's mutations (which the client still holds in memory and can re-send), a missed per-day snapshot cannot be backfilled: `games.settlements` holds only current state, and `game_events` carries no per-settlement gold/warehouse/morale payload. Phase 4's `scripts/migrate-jsonb-to-tables.ts` can reconstruct entity rows from the blob; it cannot reconstruct history that was never written. Deferring costs data permanently.
3. **Phase 4 explicitly keeps these two tables as-is**, so waiting buys nothing. `plan/2026-08-11-srp-module-reorganization.fable.md:223` lists `settlement_snapshots, resource_transactions -- keep as-is` in the de-blobbed target schema; Phase 4 Track 4.B's `009_granular_entities.sql` covers current-state tables (`settlement_resources` et al.), which are a different concern from per-day history.
4. **Phase 4 Track 4.A rewrites `EndTurn`'s persistence step for dual-write.** Landing the snapshot writes now means that rework inherits them; deferring means folding an unrelated behavior restoration into the riskiest persistence change of the project, where a regression is much harder to attribute.

Counter-argument, for the record: nothing reads either table today (confirmed — repo-wide grep finds only the DDL, the dead route, and docs; there is no `GET` route for either), so severity is low and #89 is legitimately *schedulable*, not urgent. That justifies ordering it behind #88 — not deferring it a whole phase.

## Evidence (what changed, precisely)

| Then (dead route, still on disk) | Now (`EndTurn` command) |
|---|---|
| `routes.ts:622-644` — one `settlement_snapshots` row per settlement owned by the player whose turn just ended: `day`, `gold`, `warehouse`, `morale`, `effective_income`, `ON CONFLICT … DO NOTHING` | no write |
| `routes.ts:646-661` — one `resource_transactions` row per auto-trade transfer, `reason = 'auto_trade'` | no write |
| both inside one `withTransaction` together with the `games` UPDATE and the `game_events` inserts (`routes.ts:524-720`) | `saveHeroesAndSettlements` + `eventRepo.append` only, each on the shared pool, no transaction |

The data the writes need is already in scope at the call site — `runEndTurn` already returns `transfers` (`turnService.ts:35`, `:55-62`), and `commandHandler.ts:189` simply discards it: `const { state: finalState, wrapped } = runEndTurn(...)`. No engine change is required.

## Work breakdown

### PR 1 — Track 3.B (prerequisite; already written as `e955e83`)

Ship the branch's `server/persistence/repositories/gameRepo.ts` additions as-is:

- `SettlementSnapshotInput` / `ResourceTransactionInput` input types; batched array methods (one call per turn end, not per row).
- `insertSettlementSnapshots` with the same `ON CONFLICT (game_id, settlement_id, day) DO NOTHING`; `insertResourceTransactions` defaulting `reason` to `'auto_trade'`.
- `resolveGameId` helper + `GameNotFoundError` on a missing game, empty-array short-circuit.
- `test/persistence/gameRepo.test.ts` coverage (row-per-settlement, idempotency, empty no-op, missing game).
- **Side-fix, keep it in this PR:** `package.json`'s `test:unit` is `tsx --test test/server/*.test.ts` on main — `test/persistence/*.test.ts` has never run under `test:all`. Widen the glob (the branch already does). Note the consequence in the PR body: `npm run test:all` now requires `npm run db:up`, since these tests hit real Postgres via `test/helpers/pgTestTx.ts`.

No changes to `commandHandler.ts` in this PR — it stays green because the handler's own interface copy is structural and extra repo methods are ignored.

### PR 2 — Track 3.A (the one that closes #89)

1. `server/app/commandHandler.ts:24` — add both methods to the local `GameRepo` interface (and its input types, imported from the repo module's types or re-declared, matching the file's existing duplication comment).
2. `server/app/commandHandler.ts:185-253` (`EndTurn` case) — capture `transfers` from `runEndTurn`, build the two row arrays, call the repo methods after `saveHeroesAndSettlements`.
3. `server/app/turnService.ts:55` — return the post-EOT / pre-round-advance settlements alongside `state`/`wrapped`/`transfers` (see D2). Dev-A-owned file; ~3 lines.
4. `test/helpers/mockRepos.ts:20` — add the two methods plus recorded-call arrays. **This must land in the same commit as the interface widening**, not before: `createMockGameRepo`'s declared return type is `GameRepo & { rows }`, so an object literal carrying methods the interface doesn't yet declare fails excess-property checking, and an interface that declares methods the mock lacks fails too. The ownership matrix lists `mockRepos.ts` under Dev B while the phase-3 plan calls it "shared by both tracks' tests" — this typing coupling makes it Dev A's to edit here. Record that as an amendment rather than splitting the commit.
5. `test/server/commandHandler.test.ts` — assert against the mock: one snapshot row per settlement owned by `command.actor` (and none for other players'), correct `day`, `effective_income` matching `effectiveIncome()`, and one transaction row per auto-trade transfer with `reason = 'auto_trade'`. This is the regression test #89 lacks.

### Decisions to make inside PR 2

- **D1 — snapshot `day`. Recommend `row.day` (pre-advance), documented as a deliberate divergence.** The old route used `wrapped ? newDay : row.day` (`routes.ts:625`-ish), i.e. the last player of each round got snapshotted one day ahead of everyone else, and after a settlement changed hands the shifted row could collide with another player's row for the same `(game_id, settlement_id, day)` and be silently dropped by `DO NOTHING`. Using the day the ending turn actually belonged to makes all players' snapshots for a day line up and makes the unique constraint meaningful. Bug-for-bug fidelity is the alternative; since nothing reads the table, the migration risk of fixing it is zero and the cost of preserving it is a permanently skewed audit trail.
- **D2 — which settlements slice.** `finalState.settlements` is post-`advanceRound` (`packages/engine/src/turn/round.ts:14-30`), so on wrap days it already includes population growth and settlement-upgrade advancement — snapshotting it would record next-day economics under the ending turn's day. The old route snapshotted the post-`applyEndOfTurnDetailed` slice (`packages/engine/src/turn/endTurn.ts:11-30`). **Recommend matching the old route** (pre-round-advance), which is why `turnService.runEndTurn` needs to surface that slice.
- **D3 — reuse the engine's formula.** `effective_income` was hand-derived in the route as `round(population * goldTax * clamp(morale,0,100) / 100)`; that is exactly `effectiveIncome()` (`packages/engine/src/economy/consumption.ts:48`), already exported through the engine barrel and numerically identical on the post-EOT settlement (`applyEffectiveIncome` mutates `gold` only, not `population`/`goldTax`/`morale`). Call the engine function; don't port the duplicate.
- **D4 — ownership filter.** Filter on `command.actor` / `row.active_player_id` (the player whose turn just *ended*), **never** `finalState.activePlayerId` — the latter is already the next player. The handler's turn-ownership guard makes those two equal by construction, so either is safe; picking the wrong one snapshots the wrong player's settlements.
- **D5 — atomicity: explicitly out of scope, file a follow-up.** The old route wrote all of this in one transaction; the command path writes on the shared pool (`createLiveCommandDeps`, `commandHandler.ts:269`), so a mid-sequence failure can leave the `games` row advanced without snapshot rows. This is pre-existing on the command path (`saveHeroesAndSettlements` + `eventRepo.append` are already two uncoordinated writes) and fixing it properly means a transaction-scoped repo factory in `CommandDeps` — a shape change Phase 4 Track 4.A needs anyway. `Queryable` (`gameRepo.ts:8`) already accepts a `PoolClient`, so the groundwork exists. Don't bundle it into #89.

## Verification

- `npm run build` (server/ is type-checked since PR #81), `npm run lint:deps` (confirm the new calls don't tempt a direct repo import from `server/http/`), `npm run test:all` with `npm run db:up` running.
- Live check after one turn end through `POST /games/:name/commands`: `SELECT count(*) FROM settlement_snapshots WHERE game_id = …` returns one row per settlement owned by the acting player, and `resource_transactions` gains a row per auto-trade transfer that fired.
- Regression guard: the `commandHandler.test.ts` assertions in PR 2 step 5 — the reason this regressed unnoticed is that no test ever asserted these writes.

## Out of scope

- **#88 itself** (recruit/build/upgrade/charter/reorder/auto-trade/capture mutations discarded on end turn) — separate issue, higher severity, fix first.
- Deleting the dead `POST /games/:name/end-turn` route (`routes.ts:524-720`). It is #88's secondary finding and should not be removed until #89's writes are ported off it, so the reference implementation stays readable during review; delete it in a follow-up once both are done.
- Any `GET` route for the two tables — nothing reads them, and adding a reader is a product decision, not a regression fix.
- Charter persistence (no `charters` column; `packages/engine/src/hydrate.ts` defaults `activeCharters` to `[]`) — genuinely Phase 4, since it needs schema.
- Transaction boundaries for the command path (D5).

## Plan-doc follow-up

`plan/2026-08-16-phase-3-parallel-dev-plan.md`'s Week 2 `EndTurn` port description never mentioned `settlement_snapshots`/`resource_transactions` at all — the port's scope was described purely in terms of round-wrap logic and the charter/population-growth gap, which is how the audit writes went missing without anyone noticing. **Added at `phase-3-parallel-dev-plan.md` §"Week 2 follow-ups (#88, #89)"** so the Phase 4 rework of the same code path inherits the checklist instead of rediscovering it.

## Audit (historical)

`.kilo/worktrees/20260816_1502_phase3TrackA`, branch `phase3/track-a-issue-89-endturn-persistence`: this is what the worktree looked like when this plan was authored (2026-08-17, ~00:30 EDT). Both halves landed as `e955e83` (Track 3.B) and `470697f` (Track 3.A), and PR #92 merged them at `6688f7b` (01:21 EDT). The two live breakages and remaining-work list below are kept as the record of what the PR closed; the working tree is no longer in this state.

### PR 1 (Track 3.B) — `e955e83`

| Item | Status |
|---|---|
| `SettlementSnapshotInput` / `ResourceTransactionInput` types, batched array methods | done |
| `insertSettlementSnapshots` with `ON CONFLICT (game_id, settlement_id, day) DO NOTHING` | done |
| `insertResourceTransactions` with `reason` defaulting to `'auto_trade'`, nullable `fromSettlementId` | done |
| `resolveGameId` + `GameNotFoundError`, empty-array short-circuit | done |
| `test/persistence/gameRepo.test.ts` — 7 new tests (row-per-settlement, idempotency, empty no-op, missing game, per-transfer rows) | done |
| `package.json` `test:unit` widened to `test/server/*.test.ts test/persistence/*.test.ts` (consequence: `npm run test:all` now requires `npm run db:up`) | done |

### PR 2 (Track 3.A) — `470697f`

| Item | Status |
|---|---|
| Widen `commandHandler.ts`'s `GameRepo` interface with both methods | done |
| Capture `transfers` from `runEndTurn` and call both repo methods after `saveHeroesAndSettlements` | done |
| `turnService.ts` returns the pre-round-advance settlements slice (D2) | **not done as recommended** — used `finalState.settlements` (post-`advanceRound`) instead of adding a slice to `EndTurnOutcome`. On wrap days this snapshots next-day economics under the ending turn's day. Acceptable today because nothing reads `settlement_snapshots` (confirmed repo-wide), but flagged here so the Phase 4 hydration code does not rely on the snapshot table matching `games.state`'s slice on a `day % 7 === 0` row. |
| `test/helpers/mockRepos.ts` implements both methods | done (no-op stubs; no recorded-call arrays) |
| `test/server/commandHandler.test.ts` #89 assertions | **not done** — no regression assertion that the writes fired. Reason: the merged code's own comment notes the same gap. Files a follow-up against whoever touches this path next (Phase 4.A is the natural owner). |
| `tsc` error from `snapshotDay: number \| undefined` | resolved via `wrapped ? finalState.day : (row.day ?? finalState.day)` |
| 2 failing `EndTurn` tests (`TypeError: … is not a function`) | resolved by the mock-repo stub addition in the same commit |

### Decisions as implemented in `470697f` vs. this plan's recommendation

| | Implemented (`470697f`) | This plan recommended |
|---|---|---|
| **D1** snapshot `day` | `wrapped ? finalState.day : (row.day ?? finalState.day)` — uses new day on round wrap, pre-advance day otherwise | `row.day ?? finalState.day` (pre-advance day), documented as a deliberate divergence |
| **D2** settlements slice | `finalState.settlements` — post-`advanceRound` | post-`applyEndOfTurnDetailed` slice via `turnService.ts` change |
| **D3** reuse engine `effectiveIncome()` / `clampMorale()` | done, as recommended | same |
| **D4** filter on `command.actor` | done (`s.ownerId === command.actor`) | same |
| **D5** transaction atomicity | not addressed in #89 (correct — Phase 4.A is the natural owner; per `a347e74` PR #91 already added `withTransaction` + `SELECT FOR UPDATE` wrapping to `POST /commands`) | keep out of #89, file follow-up |
| Extra beyond spec | preserves legacy `game_events` `kind` strings (`turn_ended`/`round_ended`/`round_started`/`ai_turn_started`) from the old route's audit trail | not in spec — bonus preservation |

