# Phase 1–5 Track Map (published)

**Status:** Published 2026-10-10 from the retired session-plan track map. This is a **point-in-time snapshot**: the original was a working document maintained outside version control, and the per-item status below was re-verified against the tree on the publication date. It moves — the linked plan files and [architecture.md](./architecture.md) are the live record.

## What this is

The Phase 1–5 track map was the master plan for the multi-PR reorganisation of heroes-js: extract the shared contracts, move the engine out of the client, reorganise `src/`, port the remaining commands and combat onto the server-authoritative path, de-blob the database, and finally cut the render path over to a pure scene-graph seam. It carried the per-phase item lists, the per-PR status charts, the ownership matrix, and the standing validation gates.

Until 2026-10-10 none of that was in the repository. The track map lived in `plan/` (later `.plans/`), which is gitignored, so anyone reading the repo could not see the plan its own architecture was executed against. Issue #183 filed that gap; this document is the fix — a tracked summary of the essential content, with the live `.plans/` plans cross-linked rather than duplicated.

## Where this content came from

The named source no longer exists on disk. `plan/2026-08-17-consolidated-phase-1-5-track-map.md` and its companion `plan/2026-08-19-phase-1-5-audit-issue-sequencing.md` were moved to `.plans/` by commit `01f7b48` and later retired under the `_COMPLETE` cleanup rule; because `.plans/` is gitignored, no history preserves them. Verified 2026-10-10: the only tracked artifact of the track map is [../analysis/2026-08-24-phase-1-5-track-map-audit.md](../analysis/2026-08-24-phase-1-5-track-map-audit.md), which audited the track map against the tree at `main@0cff923`.

That audit, plus [architecture.md](./architecture.md) (the canonical current-state map, whose "Subsequent additions" sections record what landed after each phase) and the live `.plans/` filename suffixes, are what this document was written from. Per-item status below was re-checked, not copied — where the original document's prose was already stale, the status here follows the code.

## Phase 1–5 item list and current status

Status values: **Landed** (shipped, verified in the tree), **Open** (not finished; the plan file is linked), **Cancelled** (superseded or abandoned; the plan file is kept as revivable history).

### Phase 1 — workspaces and `@heroes/contracts`

| Item | Status | Evidence |
|---|---|---|
| npm workspace scaffolding | Landed | `package.json` workspaces; `packages/contracts`, `packages/engine` |
| `@heroes/contracts` extraction (shared type source) | Landed | `packages/contracts/` owns the command, event, building and game-state shapes; `server/`, `packages/engine` and `src/` all import from it |

### Phase 2 — engine extraction and the `src/` layout

| Item | Status | Evidence |
|---|---|---|
| `shared/` → `@heroes/engine` move (economy, charter, settlement, hero, turn) | Landed | `packages/engine/src/*` domain modules |
| The 7-directory `src/` layout (`core/`, `entities/`, `io/`, `map/`, `render/`, `systems/`, `views/`) | Landed | [architecture.md](./architecture.md) is the executed plan for this move |
| Layer rules machine-enforced (`core/` leaf-only, no cycles, `paint2d/` asset seam) | Landed | `dependency-cruiser.cjs` via `npm run lint:deps` |
| Intra-`src/` circular imports | Landed (7 fixed 2026-08-10) | commit `526398e`; see architecture.md's "Linked mitigation plans" |

### Phase 3 — command ports and combat decomposition (Track 3.A)

| Item | Status | Evidence |
|---|---|---|
| Command ports into `server/app/commandHandler.ts` | Landed | 13 ported commands, all client-wired (audit §4); reducer-first client paths in `src/io/commands.ts` + `src/state/turnController.ts` |
| Remaining command ports (`UpgradeBuilding`, `UpgradeSettlement`) | Landed | both present in the handler; the `mergeFromEndTurn` overwrite gap closed |
| Combat SRP decomposition | Landed | `packages/engine/src/combat/*` (types, damage, grid, manualBattle, resolveBattle, combatConfig) + `test/combat/*` |
| Arena as a playable feature (animation, deployment, defender flow) | Landed | `20261001-2156_issue-139-arena-player-move-animation_COMPLETE.md`, `20261010-0311_arena-attacker-left-deployment_COMPLETE.md`, `20261010-0317_arena-defender-fight-e2e_COMPLETE.md` |

### Phase 4 — database de-blobbing (Track 4.A)

| Item | Status | Evidence |
|---|---|---|
| `hydrate.ts` plus dual-write wiring | Landed | `packages/engine/src/hydrate.ts`, `server/persistence/hydrate.ts` |
| `game_events.id` BIGSERIAL as the event cursor | Landed | migration `010_event_seq.sql`; consumed by `server/http/routes/eventStream.ts` |
| Repository layer | Landed | `server/persistence/repositories/*` |
| Snapshot / transaction tables (#89) | Landed | widened to `NUMERIC` by migration `027_numeric_columns.sql` (2026-10-02) |
| Retire the JSONB blob and end dual-write (#154) | **Open** | `20261001-2156_issue-154-jsonb-blob-retirement_UNCLAIMED.md` — a read-only step-1 audit is recorded in-file, with no code, migration or test changes. The audit's confirmed finding still holds: `server/persistence/repositories/gameRepo.ts`'s `saveHeroesAndSettlements()` writes the normalised tables *and* the JSONB columns on every call |

### Phase 5 Track 5.A — client command and event-cursor sync

| Item | Status | Evidence |
|---|---|---|
| `src/io/commands.ts` client command surface | Landed | typed command wrappers over `apiFetch` |
| `multiplayerSync.ts` event-cursor rewrite | Landed (superseded the poll-only design) | SSE push landed 2026-09-28 (`src/io/multiplayerSync.ts`, `server/migrations/017_game_events_notify.sql`, `server/persistence/eventsNotifier.ts`), with the 2 s poll demoted to backstop and resume path |
| `GameSessionManager.ts` cursor init | Landed | `src/managers/GameSessionManager.ts` |
| Remove the `SessionManager.manualSave()` full-state push (#147) | Landed | audit §1 verified in code: `manualSave()` now calls `flushPendingCommands()` and reads `getLastPersistedAt()`; the full-state `PATCH` is gone |
| Server-side `?after=<seq>` ownership for the events endpoint | Landed | `server/http/routes/eventStream.ts` shares the poll route's SQL, so a cursor means the same thing on both transports |
| Auth wiring (#179, PR #181) | Landed — sign-in deliberately optional | `server/auth.ts`, `src/io/auth.ts`, `docs/auth-model.md` |

### Phase 5 Track 5.B — the scene-graph seam

| Item | Status | Evidence |
|---|---|---|
| `SceneNode` union | Landed | `src/render/scene/types.ts` |
| Scene builders (adventure / city / battle) | Landed | `src/render/scene/sceneBuilder/{adventureScene,cityScene,battleScene}.ts` |
| `entityMirror.ts` built and consumed by the sync path | Landed | `src/render/scene/entityMirror.ts`, `src/io/multiplayerSync.ts` |
| Render path consumes the mirror (#180) | Landed 2026-10-10 | commits `a0dda56`, `45b1710`; `20261001-2156_issue-180-entity-mirror-render-wiring_COMPLETE.md` — closes the second half of the track map's §7.2 exit criterion |
| `scene/paint2d/` per-kind painters | Landed | 27 kinds behind the `Paint2DDep` seam; `?paint=legacy` is the escape hatch |
| Renderer / city-renderer cutover (#148) | Landed | `MapRenderer.draw()` and `drawCityView()` both build `SceneNode[]` and call `paintScene()`; the parallel `painter/` implementation was deleted; `npm run test:visual` is the gate |
| Arena scene-graph consumption and sprites | Landed | `src/screens/combat/arena/paint.ts`, registry-driven `UNIT_ARENA_DESCRIPTORS` |
| Remove the city view's procedural building-style system | **Open** | `20261004-0627_remove-city-building-styles_UNCLAIMED.md` |

### Cross-cutting issues from the track map's issue table

| Issue | Subject | Status |
|---|---|---|
| #83 | Dependency-boundary rules for the repository layer | Landed |
| #88 | Remaining command ports (`UpgradeBuilding`, `UpgradeSettlement`) | Landed |
| #89 | Snapshot / transaction tables | Landed |
| #141 | AI battle resolution ordering and result-card policy | Closed (fix `966fe20`) |
| #144–#147 | Track 5.A dependencies, including the `manualSave()` full-state push | Closed |
| #148 | Render cutover to the scene graph, deletion of `painter/` | Closed |
| #152 | Delta events for the sync path | Closed (revision note 12, 2026-08-23) |
| #153 | Move `upgradePopulationGate` server-side | Closed (fix `f1599eb`, 2026-10-03); its deep-dive plan is `_CANCLED` as superseded — `20261002-1930_issue153-deep-dive_CANCLED.md` |
| #154 | Retire the JSONB blob and end dual-write | Open — `_UNCLAIMED`; a read-only step-1 audit is recorded in-file, implementation not started |
| #175 | `test/smoke.ts`'s real flow was dead code | Closed (commit `fc8081f`); plan `_COMPLETE` |
| #179 | Auth wiring / per-game membership | Closed |
| #180 | `EntityMirror` drives the live render path | Closed (commits `a0dda56`, `45b1710`); plan `_COMPLETE` |
| #183 | This publication | Open — claimed `_26144`; implementation done, push and issue close still pending |

### Other open work currently sitting in `.plans/`

| Plan | Owner | Scope |
|---|---|---|
| `20261001-2156_issue-154-jsonb-blob-retirement_UNCLAIMED.md` | unclaimed | read-only step-1 audit recorded in-file; no code, migration or test changes |
| `20261002-1900_ai-actor-phase-3_UNCLAIMED.md` | unclaimed | Phase 3 of the server-side AI actor — watchdog and pool hardening landed 2026-10-05, B3 (AI chartering) remains and needs user sign-off |
| `2026-08-24-sign-in-flow-enhancements_UNCLAIMED.md` | unclaimed | gaps in the existing magic-link flow (delivery, rate limiting, session lifecycle) |
| `20261002-1900_visual-baseline-drift-audit_UNCLAIMED.md` | unclaimed | diagnose and justify a regeneration of the pre-existing visual-baseline drift; a bounded probe assignment is recorded in-file |
| `20261004-0627_remove-city-building-styles_UNCLAIMED.md` | unclaimed | remove the city view's procedural building-style system |

### Standing gates

Every phase item above was held to the same bar, and any future item is too:

```
npm run build            # tsc + vite build
npm run lint:deps        # dependency-cruiser boundary rules
npm run test:all         # smoke + multiplayer.smoke + cityView + settlements + aiDefender + logpanel + visual, then test:unit
```

Sprite and asset work additionally runs `npm run validate-assets`, and render-path changes are pinned by `npm run test:visual` against the committed baselines in `test/visual-baselines/`.

## How session plans work

Session plans live at `.plans/YYYYMMDD-HHmm_<plan-name>_<status>.md` and each file ends with a status keyword where the owner PID used to sit:

| Suffix | Meaning | Takeover candidate? | Cleanup target? |
|---|---|---|---|
| `_<PID>` | A live session owns it. If the PID is dead the file is **orphaned** | Yes, when orphaned — user confirmation required | No |
| `_UNCLAIMED` | Prepared but unowned; objective verbatim plus a handoff note | Always — user confirmation required | No |
| `_COMPLETE` | Work concluded; kept as history with an in-file `## Disposition` reason | No | Yes, only once the file is 30+ days old |
| `_CANCLED` (legacy `_FAILURE`) | Given up, obsoleted or superseded; the in-file reason is mandatory | No — revival needs the user's explicit go-ahead | No |

Two rules matter when reading a plan file:

- **`.plans/` is gitignored** (`.gitignore:15`), so session plans never reach the repository. Same for `local/`, `.kilo/plans/` and `.kilo/worktrees/`. That is the whole reason this document exists: the plan and its status were invisible to anyone reading the repo.
- **Taking over a plan requires user confirmation.** The takeover is then mechanical: rename the file to your own PID (or claim an `_UNCLAIMED` file), append a handoff line recording the sweep that found it and who authorised it, and rename the session to `<plan-name> [<PID>]`. `_COMPLETE` and `_CANCLED` files are never renamed back without the user asking.

Plans are deleted when their work finishes — the git history and this document are the record. Only abandoned plans are kept, as `_CANCLED`.

## Known gaps / deliberately not tracked

- **The original documents are gone.** The track map, the sequencing doc, the per-phase dev plans (`phase-3-parallel-dev-plan`, `phase-4-db-deblobbing-dev-plan`, `phase5-final-renderer-rewrite`), the fight-screen G1–G8 backlog and the SRP reorganisation plan all lived only in the gitignored plan directory and have been retired from disk. This document summarises them; it does not replace their per-PR detail, effort notes or decision records. Everything here that is still load-bearing now lives in code, in `docs/`, or in a live `.plans/` file.
- **The auth/trust correction (audit finding §2) is recorded here for the first time in a tracked file.** `docs/auth-model.md:6-8,18-20` and `server/middleware/attachPlayerSeat.ts:44-50` both state that sign-in is optional and that an anonymous caller stays trusted on the client-supplied `actor` field. The retired track map's companion doc had claimed the opposite about issue #153's trigger condition ("every route requires an authenticated, seat-claimed caller"), and the contradiction was only ever corrected in a GitHub issue comment. The shipped behaviour is the optional-auth one; the docs were never wrong, but no committed file said so.
- **Per-PR granularity is intentionally not reproduced here.** The original status charts tracked individual pull requests per wave. This table tracks phases and issues, which is the level a repo reader needs; the PR-level detail belongs to the plan files that produced the commits, and the commit history is the record of what actually shipped.
- **Numbers move.** Unit-test counts, module counts and dependency counts all advance; the values quoted above are the ones verified on 2026-10-10 at commit `b11c926`. Re-check before relying on any of them.

## See also

- [architecture.md](./architecture.md) — the executed plan for the `src/` layout, plus a dated "Subsequent additions" record of everything that landed after each phase.
- [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) — the maintained module-by-module dependency map.
- [../analysis/2026-08-24-phase-1-5-track-map-audit.md](../analysis/2026-08-24-phase-1-5-track-map-audit.md) — the audit of the original track map against the tree; still the most detailed surviving record of what was verified and what was wrong.
