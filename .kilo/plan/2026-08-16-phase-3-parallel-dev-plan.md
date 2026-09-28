
# Plan: Phase 3 — Server Command Loop & Repositories (Deep Dive)

*Authored 2026-08-16. Sibling to `2026-08-15-parallel-dev-split.md` and `2026-08-16-parallel-dev-phases-3-5.md` — that doc's §4 "Phase 3" section gives the track split and file ownership at a glance; this doc goes deep on Phase 3 specifically: the concrete current-state audit, the exact port order with rationale, the doc contradictions that need resolving before either track writes code, and a pre-agreed repo interface so both tracks can start Day 1 without blocking each other. Adopts that doc's Track 3.A / Track 3.B split and file assignments as given — this is a refinement, not a competing scheme.*

## Context

Phase 2 is done (economy → charter → settlement → hero → turn, all five domains extracted, PRs #67/#72/#74/#75/#78). `@heroes/engine` now has a complete, tested, pure ruleset. Phase 3 is the first phase where the **server** becomes a real consumer of it instead of a JSONB blob mover.

**Why now, precisely:** an endpoint-by-endpoint audit of `server/routes.ts` (1,163 lines, 17 routes) found the actual state of server-side validation is uneven in a way none of the existing plan docs spell out:

- **5 endpoints already have dedicated, hand-validated action shapes**: `spend_movement` (nested in `PATCH /games/:name`), `transfer`, `trade`, `resolve-battle`, and the two `lobby/*` actions. Each hand-rolls checks that mostly duplicate logic `@heroes/engine` already has, correctly, in one place.
- **Everything else — recruit hero, build/upgrade a building, upgrade a town hall or settlement, start/advance a charter, toggle auto-trade, reorder a stack, capture a settlement — has no dedicated action shape at all.** It falls through the "legacy patch" fallback (`routes.ts:482-523`), a generic column-patch that trusts whatever JSONB the client sends for `heroes`/`settlements`/etc. wholesale. There is currently no server-side re-validation of these mutations beyond what the client chose to compute.
- Where dedicated validation *does* exist, it's frequently **incomplete or duplicated** relative to the engine function that already does the same job correctly (concrete list in §1 below).

Phase 3's `commandHandler.ts` + repos isn't just an architecture cleanup — it's the mechanism that closes this validation gap for good, one command at a time, without a big-bang rewrite.

**A second complication this plan resolves:** two *different* "add a repos layer" proposals exist in `plan/`, arrived at independently:
- The packages-reorg lineage (`2026-08-11-srp-module-reorganization.fable.md` §2.3, refined by both `2026-08-15-*_OVERVIEW.md` docs and now `2026-08-16-parallel-dev-phases-3-5.md`) — `server/persistence/repositories/*.ts`, one file per table, feeding a `commandHandler.ts` command loop.
- The multi-DB-portability lineage (`2026-08-10-repository-abstraction-multi-db.md` + its `.fable.md` rewrite, and the companion `2026-08-10-database-abstraction-module.md` pair) — `server/db/repositories/*.ts`, motivated by Postgres/Oracle/MySQL portability, with **no mention of `commandHandler.ts`, `EngineCtx`, `Violation`, or the command/event pattern anywhere in any of those four files.**

`2026-08-16-parallel-dev-phases-3-5.md` already implicitly settled the location question in favor of the packages-reorg lineage (`server/persistence/repositories/`) — this plan makes that explicit and formally supersedes the multi-DB docs' `server/db/` location, while keeping their genuinely useful splitting advice (§4 below). No dialect-dispatch code exists or is planned; if a second DB vendor ever actually runs, the adapter-swap question gets revisited then, against real repo files instead of speculative ones.

## What's actually broken today (grounding for the port order in §3)

| Endpoint | Current state | Engine equivalent | Gap |
|---|---|---|---|
| `spend_movement` (`routes.ts:404-480`) | Checks hero exists, `fromTile` match, turn ownership | `startMove` (`packages/engine/src/hero/move.ts:4-58`) | Missing `isChartering` check and **tile-occupancy** check — both free once ported |
| `transfer` (`routes.ts:944-1062`) | Reimplements deposit/withdraw inline | `transferGold` (`packages/engine/src/economy/transfer.ts:3-48`) — complete, already validated | 100% duplicated logic, zero delegation |
| `trade` (`routes.ts:1064-…`) | Calls `tradeResourcesReducer` from `@heroes/engine` | Already partially wired | Lowest-effort port — just needs the transaction/persistence step generalized |
| `end-turn` (`routes.ts:600-795`) | Hand-rolls round-wrap (active-player rotation, round/day increment) and a copy of the troop-upkeep formula | `advanceRound`/`applyWeeklyUpkeep` (`packages/engine/src/turn/round.ts`) | **Never calls `advanceCharters` or `advanceSettlementUpgrades` server-side at all.** Never calls `applyPopulationGrowth`. The code comment at `routes.ts:640-641` ("client computes this too; we re-run here so DB matches client state") means the server is currently trusting the client's computation of charter/settlement-upgrade advancement and population growth on every round-wrap — it doesn't run that logic independently |
| `resolve-battle` (`routes.ts:797-943`) | Delegates combat math to `resolveBattleEngine` correctly | n/a | `obstacleSeed: (row.id * 2654435761 + Date.now()) >>> 0` (`routes.ts:860`) feeds wall-clock time into the engine call. Not an engine purity violation (the engine doesn't call `Date.now()` itself), but the *seed itself* isn't persisted anywhere — replaying this battle from the event log later would not reproduce the same obstacle layout |
| Recruit hero, build/upgrade building, upgrade town hall/settlement, start/advance charter, set auto-trade, reorder stack, capture settlement | **No dedicated endpoint exists.** Falls through the legacy patch fallback (`routes.ts:482-523`) — a hand-built `sets`/`vals` array with `$${i++}` placeholders, trusting whatever the client sends | All exist, validated, in `@heroes/engine` (settlement/*, hero/recruit.ts, hero/stacks.ts, charter/*) | Zero server-side validation today. `buildStructure` specifically has no engine command yet either (deferred in Stage 6 — placing a new building is *also* unvalidated client-side, in `UIManager.ts`'s `onClose` handler) |
| `POST /games` (create) | `GameMap`/`mulberry32` already from `@heroes/engine`; `makeInitialStatePayload` still from `src/game/initState.ts` | n/a | Documented, named dependency-cruiser exception (R11) — not a Phase 3 blocker, but the create-game command should absorb it rather than leave routes.ts crossing into `src/` |
| `lobby/claim`, `lobby/start` | Hand-rolled seat/slot logic | n/a | Lower priority — session/social layer, not game-rules; candidates for commands later, not in the first wave |

Also confirmed, both relevant to *how* Phase 3 gets built, not just *what* it ports:

- **`tsconfig.json`'s `include` is `["src", "packages/contracts/src", "packages/engine/src"]` — `server/` is not in it.** `npm run build`'s `tsc` step never type-checks anything under `server/` today; `tsx watch` strips types at dev time without checking them. Two latent bugs currently go undetected because of this: an orphaned `GameRow` type reference (`routes.ts:513`, no such type is defined or imported anywhere in the file) and an unused `WAREHOUSE_RESOURCES` import (`routes.ts:7`, would trip `noUnusedLocals: true` if `server/` were checked). **Phase 3 should fix this tsconfig gap as its first prerequisite commit** — both so the new `server/app/`, `server/http/`, `server/persistence/` code gets checked from day one, and so these two pre-existing bugs surface and get fixed as a drive-by.
- **`EngineCtx`, `Violation`, and the command-pattern `GameEvent` don't exist as real types anywhere.** `EngineCtx` is a comment (`packages/engine/src/index.ts:3`), not a file. `Violation` has zero matches repo-wide. A `GameEvent` type *does* exist (`src/core/events.ts:3`) but it's the unrelated client-side UI-event-bus payload union — **naming collision risk**: `packages/contracts/src/events/` will need its own `GameEvent`-shaped type per the architecture docs, and it is not the same thing. Recommend naming the new one `EngineEvent` in `@heroes/contracts` to avoid the collision outright rather than relying on import-path disambiguation.

## Doc contradictions to resolve before Track 3.A writes `EngineCtx`

Two same-day docs disagree on `EngineCtx`'s shape:

- `2026-08-15-reorg-additions.md` §7 proposes **adding** `actor: PlayerSeat` and a deterministic clock to `EngineCtx = { rng, catalog }`.
- `2026-08-15_OVERVIEW.md` §3 ("what's deliberately NOT in it today") explicitly rejects actor identity in `ctx`, with reasoning: *"Combat and charter events need to know who caused them... the engine reads it from `cmd.actor`, not from `ctx`. Keeps commands self-describing and replay-safe."* Same section rejects a `now()`/tick clock unless a concrete need appears, deferring to `ctx.tick` derived from `state.day` if/when needed.

**Recommendation: follow `2026-08-15_OVERVIEW.md`.** It's framed as a deliberate, reasoned correction with a concrete replay-safety argument, not a passing suggestion, and "self-describing commands" is the more conservative, harder-to-regret default. `EngineCtx` for Phase 3 ships as `{ rng: Rng, catalog: Catalog }` only. Actor identity is a field on each command (`cmd.actor: PlayerSeat`), not on `ctx`. If a real need for a clock shows up, it's added explicitly and reviewed then — not speculatively now.

## The split

Adopts `2026-08-16-parallel-dev-phases-3-5.md` §4's Track 3.A / Track 3.B assignment. This section adds the concrete interface both tracks build against, so they can start on the same day instead of Track 3.A blocking on Track 3.B's repos landing first.

### Track 3.A (Dev A) — Command bus, `EngineCtx`, first two ports

**Goal:** a real `commandHandler.ts` loop, backed by `EngineCtx` and the first `@heroes/contracts/commands/` files, with `spend_movement` and `transfer` fully ported and closing their known validation gaps.

**Owned tree:** `packages/contracts/src/commands/` (new), `packages/contracts/src/events/` (new — `EngineEvent`, not `GameEvent`, per the naming-collision note above), `packages/engine/src/ctx.ts` (new — the real `EngineCtx` type, replacing the comment), `server/app/commandHandler.ts` (new), `server/http/routes/commands.ts` (new), `server/app/turnService.ts` (new, stubbed until Track 3.A reaches the `end-turn` port in week 2).

**Exit criteria:**
- `EngineCtx` is a real exported type: `{ rng: Rng; catalog: Catalog }` (no `actor`, no clock — see contradiction resolution above)
- `packages/contracts/src/commands/moveHero.ts` and `packages/contracts/src/commands/transferGold.ts` exist as discriminated-union command shapes, each carrying its own `actor: PlayerSeat`
- `commandHandler.ts` implements the full loop against the **Track 3.A/3.B pre-agreed repo interface** (below), not against raw `pool.query` — even before Track 3.B's real repo implementations land, `commandHandler.ts` codes against the interface and Track 3.A can use a temporary in-memory or thin-wrapper implementation to keep moving
- `POST /games/:name/commands` accepts `{kind: "MoveHero", ...}` and `{kind: "TransferGold", ...}`, both round-tripping through `engine.validate` → `engine.apply` → repo persistence → event append
- `spend_movement`'s known gaps (missing `isChartering` and tile-occupancy checks) are closed as an observable side effect of calling the real `startMove`, not by hand-patching the old branch
- Old `PATCH /games/:name` action branches for `spend_movement` and `transfer` are deleted once the new command path is confirmed equivalent (not left running in parallel indefinitely)
- `npm run build` passes with `server/` now included in `tsconfig.json` (see Shared config touchpoints)

### Track 3.B (Dev B) — Repositories, persistence, test doubles

**Goal:** typed CRUD repos for every table `commandHandler.ts` needs for the first two ports, replacing the ad-hoc `pool.query` calls those two endpoints currently make, without touching any endpoint's HTTP-facing behavior yet.

**Owned tree:** `server/persistence/repositories/` (new — `gameRepo.ts`, `heroRepo.ts`, `settlementRepo.ts` first; `eventRepo.ts`, `tileRepo.ts`, `charterRepo.ts` follow in week 2 as later ports need them), `server/persistence/db.ts` (new — moves `pool`/`withTransaction` out of today's flat `server/db.ts`, which keeps only `initSchema`), `test/helpers/mockRepos.ts` (new — in-memory doubles implementing the same interface, for Track 3.A's unit tests and for Track 3.A to develop against before real repos land).

**Exit criteria:**
- `gameRepo`, `heroRepo`, `settlementRepo` all implement the pre-agreed interface (below) against the *current* schema — no schema changes in Phase 3 (that's Phase 4)
- `mockRepos.ts` implements the identical interface in-memory; swapping real repos for mocks in a test changes zero call-site code
- Repo methods are plain CRUD with no business logic — validation stays in `@heroes/engine`, repos just read/write rows
- `db.ts`'s `withTransaction` is unchanged in behavior, just relocated
- Unit tests cover each repo method against a real (test) Postgres connection, isolated per test via transaction rollback

### Pre-agreed repo interface (lets both tracks start Day 1)

Minimal shape both tracks commit to before either writes an implementation — Track 3.A codes `commandHandler.ts` against this immediately; Track 3.B fills it in without needing to coordinate on signatures mid-week:

```ts
// server/persistence/repositories/gameRepo.ts (shape, not final implementation)
export interface GameRepo {
  load(name: string): Promise<GameRow>;
  saveHeroesAndSettlements(name: string, heroes: Record<HeroId, HeroState>, settlements: Record<SettlementId, SettlementState>): Promise<void>;
}

// server/persistence/repositories/eventRepo.ts
export interface EventRepo {
  append(gameId: number, kind: string, payload: unknown): Promise<void>;
}
```

Exact per-table repo split (which tables get their own file vs. fold into `gameRepo.ts`) follows the multi-DB docs' own advice, which is sound regardless of the location disagreement resolved above: *"tiles/events/snapshots/resources fold into the big repo until their query count justifies a file."* Don't pre-split `tileRepo.ts`/`eventRepo.ts` out of `gameRepo.ts` before there's a second or third caller that needs it in isolation.

## Port order (week-by-week)

```
Week 1:
  Prerequisite (either dev, ~1 hour): add "server" to tsconfig.json's include array.
  Fix the two latent bugs this surfaces (orphaned GameRow reference at routes.ts:513,
  unused WAREHOUSE_RESOURCES import at routes.ts:7) before either track's PRs land,
  so neither track's diff gets blamed for pre-existing breakage.

  Dev A: EngineCtx (packages/engine/src/ctx.ts), commands/moveHero.ts,
         commands/transferGold.ts, commandHandler.ts skeleton coded against
         the pre-agreed repo interface + mockRepos.ts.

  Dev B: gameRepo.ts, heroRepo.ts, settlementRepo.ts against the real schema.
         mockRepos.ts (can be written first, in parallel with the real repos,
         since the interface is agreed up front).

Week 2:
  Dev A: wires real repos in (swap mockRepos.ts for the Track 3.B implementations),
         ports spend_movement -> MoveHero and transfer -> TransferGold fully,
         deletes the old PATCH branches once equivalence is confirmed.
         Begins EndTurn command (needs turnService.ts + the advanceCharters/
         advanceSettlementUpgrades/population-growth gap closed -- the biggest
         single behavior fix in this phase, since none of those three currently
         run server-side independent of client cooperation).

  Dev B: eventRepo.ts, charterRepo.ts, tileRepo.ts as EndTurn's port needs them.
         Repo test suite against real Postgres.

Week 3+:
  Dev A: TradeResources (cheapest remaining -- already partially wired),
         ResolveBattle (fix the Date.now() obstacle-seed replay gap: persist
         the resolved seed in the battle-resolved event's payload, not just
         the command inputs), then the previously-unvalidated bulk: RecruitHero,
         UpgradeTownHall, UpgradeSettlement, StartCharter/AdvanceCharter,
         SetAutoTrade, ReorderStack, CaptureSettlement.
         BuildStructure command stays blocked until someone writes the actual
         validate+apply logic in @heroes/engine (Stage 6's deferred item --
         this is a prerequisite for this specific port, not a Phase 3 task
         itself).
         Lobby claim/start ports last, if at all -- session layer, not
         game-rules, lowest payoff for the validation-gap goal this phase exists for.

  Dev B: repos for whatever tables the week's ports newly touch. No repo work
         is ever more than ~1 port-cycle ahead of Dev A's need for it.
```

**Week 3+ status (2026-08-16):** `TradeResources`, `ResolveBattle`, `RecruitHero`, `UpgradeTownHall`, `SetAutoTrade`, `ReorderStack`, and `CaptureSettlement` are done — all seven now round-trip through `POST /games/:name/commands`, and the old dedicated `resolve-battle`/`trade` routes are deleted from `server/routes.ts`. `ResolveBattle`'s obstacle-seed replay gap (§ "What's actually broken today" above) is closed: the seed comes from `ctx.rng()` instead of `Date.now()` and is persisted on the `BattleResolved` event, not just used transiently. `createLiveCommandDeps()` is now async (it queries `unit_types` for `ResolveBattle`'s catalog — previously always empty) and is memoized lazily on first request by `server/http/routes/commands.ts` rather than built at module load. Still deferred, for reasons already on record above rather than new ones: `UpgradeSettlement` (needs `GameMap`+RNG wired into `CommandDeps`, a bigger lift than the pre-agreed repo interface covers), `StartCharter`/`AdvanceCharter` (blocked on the `activeCharters` schema gap — no DB column, and schema changes are Phase 4 per "What this plan does NOT cover" below), `BuildStructure` (still blocked on the missing `@heroes/engine` validate+apply function, Stage 6's deferred item), and lobby claim/start (still last-or-never, unchanged). Also surfaced by this port's own audit, pre-existing and deliberately left alone rather than fixed: human-initiated `MoveHero`/`TransferGold` — unlike the AI-move and `EndTurn` paths, which do round-trip — still have no server call at all. `io/api.ts`'s `spendMovement()`/`transferGold()` exist and work, but neither `src/state/turnController.ts`'s `requestMove()` nor its `transferGold()` method calls them (or any hook) for a human-initiated action; `TurnControllerHooks` has no `onTransferGold`/human-move equivalent today, only `onAiMove`.

## File ownership table

| Path / Tree | Owner | Notes |
|---|---|---|
| `tsconfig.json` | Either, first commit | Adds `"server"` to `include`. Lands before either track's real PRs to avoid blame confusion on the two pre-existing bugs it surfaces |
| `packages/contracts/src/commands/` | Dev A | One file per command, discriminated union, `actor: PlayerSeat` on every variant |
| `packages/contracts/src/events/` | Dev A | `EngineEvent` (not `GameEvent` — collision with `src/core/events.ts`) |
| `packages/engine/src/ctx.ts` | Dev A | `{ rng, catalog }` only — see contradiction resolution |
| `server/app/`, `server/http/routes/commands.ts` | Dev A | New subfolders of today's flat `server/` |
| `server/persistence/repositories/`, `server/persistence/db.ts` | Dev B | New; `server/db.ts` (today's file) keeps only `initSchema` after the move |
| `test/helpers/mockRepos.ts` | Dev B | Shared by both tracks' tests |
| `server/routes.ts` | Dev A, incrementally | Shrinks per port; old action branches deleted only after their command replacement is confirmed equivalent, never left running in parallel long-term |
| `server/migrations/`, `server/schema.sql` | Neither in Phase 3 | No schema changes this phase — that's Phase 4 (see `2026-08-16-parallel-dev-phases-3-5.md` §4 Phase 4) |
| `dependency-cruiser.cjs` | Dev A, additive | New rule for the `server/app/` ↔ `server/persistence/` boundary (commands don't reach into repos directly, only through `commandHandler.ts`) — see below |

**Conflict surface: near zero.** Dev A owns contracts' new folders + `server/app/`/`server/http/`; Dev B owns `server/persistence/`. Both touch `server/routes.ts` only in the sense that Dev A deletes lines from it as ports land — Dev B never edits it.

## Shared config touchpoints

1. **tsconfig.json** (either dev, Day 1, own small PR): add `"server"` to `include`. Fix the two bugs it surfaces in the same PR, since leaving them for whoever hits the resulting build failure first is worse than fixing them deliberately.
2. **dependency-cruiser.cjs** (Dev A, additive, lands with the `commandHandler.ts` PR): add a rule forbidding `server/http/` and `server/app/` (other than `commandHandler.ts` itself) from importing `server/persistence/repositories/*` directly — everything goes through the command handler's own repo calls, not ad-hoc repo imports scattered through route files. Mirrors the existing `no-core-value-import-from-siblings` rule's shape.
3. **package.json** (Dev A, additive): no new scripts needed this phase — `lint:deps` already cruises `server`.

## Verification per track

**Track 3.A — at each PR:**
- `npm run build` exits 0 (now meaningfully checks `server/` too)
- `npm run lint:deps` exits 0
- `npm run test:all` exits 0
- Manual: `POST /games/:name/commands` with a `MoveHero` command rejects a move onto an occupied tile and a move by a chartering hero (the two gaps `spend_movement` had) — write this as an explicit regression test, not just a manual check
- Manual: `grep -rn "action === \"spend_movement\"\|action === \"transfer\"" server/routes.ts` returns 0 matches once both are ported

**Track 3.B — at each PR:**
- `npm run build` exits 0
- `npm run lint:deps` exits 0
- Repo unit tests pass against a real (test) Postgres connection, each isolated via transaction rollback
- Manual: no repo file contains any call into `@heroes/engine`'s `validate`/`apply` functions — repos are persistence-only, business logic lives exclusively in the engine

## Risks and rollback

**Risk 1: The legacy-patch fallback becomes the "everything not yet ported" catch-all indefinitely.** Once `spend_movement`/`transfer` port cleanly, there's a temptation to call Phase 3 "done enough" and leave recruit/build/upgrade/charter mutations trusting the client forever. **Mitigation:** the port order in this doc explicitly continues through the full unvalidated list (§ Port order, Week 3+), not just the two easy wins. The doc's own existence is the tracking mechanism — treat the Week 3+ list as the actual exit criteria for Phase 3, not the first two ports.

**Risk 2: `EndTurn`'s port silently changes multiplayer behavior.** Adding real server-side `advanceCharters`/`advanceSettlementUpgrades`/population-growth calls where none currently run independently could produce different results than the client-computed values the server currently trusts, if client and server ever drifted. **Mitigation:** before deleting the old hand-rolled round-wrap code, run both paths side-by-side in a non-production branch against recorded game histories and diff the results; only cut over once they match. This is exactly the "drift-safe" comparison the current code already gestures at (`routes.ts:640-641`), just made rigorous instead of assumed.

**Risk 3: `EngineCtx`'s shape churns again after Phase 3 ships it.** Both docs proposing changes to `{rng, catalog}` are dated the same day; a third opinion could show up. **Mitigation:** this doc's contradiction-resolution section is the tie-breaker of record. If a real need for `actor`-in-ctx or a clock appears later, it's an explicit, reviewed addition against a real use case — not a retroactive "we should have done this" churn.

**Risk 4: Dev A blocked on Dev B's real repos.** If Track 3.B's `gameRepo`/`heroRepo`/`settlementRepo` slip past Week 1, Track 3.A's `commandHandler.ts` still has `mockRepos.ts` to develop and test against, per the pre-agreed interface. **Mitigation is structural**, not a fallback plan — this is the entire point of agreeing the interface before either track starts.

**Rollback:** each port is its own PR (one command at a time, per the base plan's own file rule). A bad port rolls back independently; it doesn't take `commandHandler.ts` or any other already-shipped command with it.

## Week 2 follow-ups (#88, #89) — added 2026-08-17

The Week 2 `EndTurn` port (PR #87) was scoped to round-wrap logic and the charter/population-growth gap. Two regressions slipped past because neither was in scope at the time:

- **#88** — recruit/build/upgrade/charter/reorder/auto-trade/capture mutations are discarded on end turn (the legacy `PATCH /games/:name` fallback still ran these; the `EndTurn` command's persistence step never calls `saveHeroesAndSettlements` with the mutation deltas). Higher severity than #89 because the client still holds the values in memory and re-sends.
- **#89** — `settlement_snapshots` / `resource_transactions` audit rows stopped being written entirely the moment the `EndTurn` command replaced the old `/end-turn` route. The plan's port description never mentioned either table, so the regression went unnoticed for the lifetime of PR #87. Fixed by PR #92 (Track 3.B repo methods on `e955e83`, Track 3.A wiring on `470697f`).

Both must be closed before any Phase 4 rework of `EndTurn`'s persistence step, or that rework will inherit the same audit gap. The Phase 4 `commandHandler.ts` dual-write step (`2026-08-17-consolidated-phase-1-5-track-map.md` §6.1) should treat these as already-closed prior work, not reopen them.

## What this plan does NOT cover

- Phase 4 (database de-blobbing, dual-write, migrations) and Phase 5 (client command dispatcher, event-cursor sync, scene renderer seam) — see `2026-08-16-parallel-dev-phases-3-5.md` §4 for those, unchanged by this doc.
- Schema changes of any kind — Phase 3 ports endpoints onto commands against the *current* schema. Granular tables are Phase 4.
- `BuildStructure`'s actual validation logic — that's a `@heroes/engine` gap from Stage 6, a prerequisite for *a* Phase 3 port but not itself Phase 3 work.
- Lobby/auth/asset endpoints beyond the passing mention in the port order — they're session/social/CRUD layers, not game-rules, and Decision 1.C (in the master plan) already says reads and non-game CRUD stay plain REST, not commands.
- Resolving the multi-DB portability question for real (Oracle/MySQL adapters) — parked, per the `.fable.md` rewrites' own appendix decision, until a second DB vendor container actually exists.

## Decision needed

Confirm: (1) the `EngineCtx` contradiction resolution (no actor, no clock, `{rng, catalog}` only), (2) the repos location (`server/persistence/repositories/`, superseding the multi-DB docs' `server/db/repositories/` for this purpose), (3) the `EngineEvent` rename to dodge the `GameEvent` collision with `src/core/events.ts`. Once confirmed:
- Dev A begins Track 3.A (`EngineCtx`, first two commands, `commandHandler.ts` against the mock repo interface)
- Dev B begins Track 3.B (`gameRepo`/`heroRepo`/`settlementRepo` against the pre-agreed interface, `mockRepos.ts`)
- Either dev lands the `tsconfig.json` + two-bug-fix PR first, before both tracks' real work merges
