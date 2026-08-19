# Phase 1–5 Audit: Findings, Issues, and Execution Order

*Authored: 2026-08-19*
*Audits: `plan/2026-08-17-consolidated-phase-1-5-track-map.md` against the tree at `f395e95` (main, post-#138).*
*Produces: issues #143–#155, and the wave ordering below.*
*Repo: `JLRoper/vigilant-palm-tree`*

---

## 1. Audit Result at a Glance

```
Phase 1  Workspaces & Contracts foundation         [✅ DONE — verified]
Phase 2  Pure deterministic engine extraction      [✅ DONE — verified]
Phase 3  Server Command Loop & Repositories        [✅ DONE — verified, and ahead of the track map]
Phase 4  Database De-blobbing & Dual-Write         [✅ exit criteria met — but the stated goal is not, see #154]
Phase 5  Client Event Sync & Scene Renderer Seam   [🟡 IN PROGRESS]
   ├── 5.A  Client command dispatcher & event sync  [🟡 command half done; sync half not started]
   └── 5.B  Scene graph builder & entity mirror     [🟡 further along than the track map says]
```

### Verification gates run during this audit

| Gate | Result |
| :--- | :--- |
| `npm run build` | ✅ green |
| `npm run lint:deps` | ✅ 0 violations (342 modules, 994 deps) |
| `npm run validate-assets` | ✅ all 31 registered sprites present |
| `npm run test:unit` | ✅ 232/232 |
| `npm run test:all` browser suites (smoke / multiplayer / cityView) | ⬜ **not run** during this audit |

### Confirmed complete

- **Phase 1–2** — workspaces, branded IDs, hex geometry, and every engine domain (`economy/`, `charter/`, `settlement/`, `hero/`, `combat/`, `map/`, `turn/`, `validation/`) present as described.
- **Phase 3** — **13** commands ported, not the 10 the track map records: `MoveHero`, `TransferGold`, `EndTurn`, `TradeResources`, `ResolveBattle`, `RecruitHero`, `UpgradeTownHall`, `SetAutoTrade`, `ReorderStack`, `CaptureSettlement`, `StartCharter`, `UpgradeBuilding`, `UpgradeSettlement`. All 13 have client wiring in `src/io/commands.ts` and `src/game/turnHooks.ts`. All 6 repos present in `server/persistence/repositories/`.
- **Phase 4** — `hydrate.ts` with granular-first read + per-game JSONB fallback; `dualWriteEntities()` called at 16 sites in `commandHandler.ts`; migrations `009_granular_entities.sql` and `010_event_seq.sql`; `scripts/migrate-jsonb-to-tables.ts`; 21 repo tests plus `test/migrations/migration.test.ts`.

### Where the track map is stale

Track 5.B is **further along** than `plan/2026-08-17-consolidated-phase-1-5-track-map.md` records. Its last revision (note 9) covers PR #118; ten PRs have merged since, three of which change 5.B's status materially — #117 (CB-4 merged), #122 (`Renderer` → `MapRenderer` + `src/render/painter/`), and #135/#136 (all 27 paint2d painters transcribed). Track 5.A is exactly where the doc says it is: not started. Full list in **#155**.

---

## 2. The Thirteen Issues

| # | Title | Kind | Wave |
| :--- | :--- | :--- | :--- |
| [#143](https://github.com/JLRoper/vigilant-palm-tree/issues/143) | Arena double-paints under `?paint=scenebuilder` | bug | 1 |
| [#144](https://github.com/JLRoper/vigilant-palm-tree/issues/144) | `game_events.actor_seat` is dead schema | bug | 1 |
| [#145](https://github.com/JLRoper/vigilant-palm-tree/issues/145) | No `?after=` cursor; `eventRepo.append()` discards the id | refactor | 1 |
| [#146](https://github.com/JLRoper/vigilant-palm-tree/issues/146) | `multiplayerSync.ts` still a full-state poller | refactor | 2 |
| [#147](https://github.com/JLRoper/vigilant-palm-tree/issues/147) | `SessionManager.manualSave()` still PATCHes full state | refactor | 3 |
| [#148](https://github.com/JLRoper/vigilant-palm-tree/issues/148) | Two parallel painter sets; no renderer consumes `SceneNode[]` | refactor | 2 |
| [#149](https://github.com/JLRoper/vigilant-palm-tree/issues/149) | Phase 5's visual-regression gate does not exist | enhancement | 1 |
| [#150](https://github.com/JLRoper/vigilant-palm-tree/issues/150) | #89 follow-up: no unit guard on audit-row writes | bug | 1 |
| [#151](https://github.com/JLRoper/vigilant-palm-tree/issues/151) | No client test for the `drainPendingCommands()` barrier | bug | 1 |
| [#152](https://github.com/JLRoper/vigilant-palm-tree/issues/152) | Charter travel-stepping still client-authoritative | refactor | 3 |
| [#153](https://github.com/JLRoper/vigilant-palm-tree/issues/153) | `upgradePopulationGate` is client-trusted | bug | 2 (trigger-gated) |
| [#154](https://github.com/JLRoper/vigilant-palm-tree/issues/154) | JSONB blob retirement is unowned | refactor | 4 |
| [#155](https://github.com/JLRoper/vigilant-palm-tree/issues/155) | Track map stale; in-code comments contradict the code | documentation | 4 |

### The two real defects

Everything else is a gap, a test hole, or unowned work. These two are things that are actively wrong today:

- **#143** — `paintSceneForArena()` (`src/screens/combat/arena/paint.ts:63`) runs `paintScene()` and then unconditionally calls `drawFallback()`. Correct when CB-4 landed and every battle painter was a no-op stub; PR #136 transcribed all eight, so the arena now paints the battlefield twice under the flag. The flag exists to let someone compare the scene-builder path against legacy, and in this state it cannot — legacy always wins compositing order. A test at `test/screens/combat/arena.test.ts:423` pins the behavior in place. Not user-visible (flag defaults off).
- **#144** — `game_events.actor_seat`, added by `010_event_seq.sql` specifically to serve Phase 5's event sync, is never written and never read. A repo-wide grep returns three hits, all inside the migration file. Same class of gap as the `next_charter_id`/`next_settlement_id` bug PR #105 found and fixed: a migration added a column that no repo layer was ever taught about. An index on `(game_id, actor_seat)` is being maintained on every insert for no benefit.

---

## 3. Dependency Structure

### Critical path — 4 deep, all Track A

```
#144 actor_seat  →  #145 cursor plumbing  →  #146 multiplayerSync  →  #147 manualSave
```

This is the longest chain and it gates every remaining Track 5.A item.

**#144 and #145 must not be worked concurrently.** Both change `EventRepo.append()`'s signature (`server/persistence/repositories/eventRepo.ts:9`, declared `Promise<void>`), both change its implementation, both touch `test/helpers/mockRepos.ts`, and both touch the 17 `append()` call sites in `server/app/commandHandler.ts`. Running them as separate branches means rewriting the same signature twice and resolving a guaranteed conflict across four files. **Land them as a single PR, or strictly back-to-back with #144 first.**

### Secondary path — 2 deep, Track B

```
#149 visual-regression gate  →  #148 renderer cutover
```

Order matters for a substantive reason, not convenience: #149's baselines must be captured from `main` **before** any render change lands. Baselines captured alongside the change they are meant to validate are baselines of the new code, which makes the gate worthless. This is also the reason #149 sits in wave 1 despite nothing depending on it yet — the renderer cutover is the single highest-risk change left in Phase 5 and the only one that touches the live render path.

### Independent

- **#151** — creates `test/state/turnController.test.ts` and changes no source. Zero conflict with anything.
- **#143** — confined to `src/screens/combat/arena/paint.ts` and its test.
- **#150** — `test/helpers/mockRepos.ts` plus `test/server/commandHandler.test.ts`. Test-only.
- **#153** — trigger-gated (see §5).
- **#152** — needs `commandHandler.ts` quiet, so it follows the #144/#145 lane.
- **#154**, **#155** — tail work.

---

## 4. Wave Plan

Lanes map onto the track map's existing §2 split (Track A = server & client logic, Track B = persistence & rendering), so each lane can be handed to a separate worktree with near-zero conflict surface — the same property that split was designed for.

### Wave 1 — 4 concurrent lanes

| Lane | Work | Notes |
| :--- | :--- | :--- |
| **A-server** | #144 **+** #145 as one PR | The signature change happens once. See §3. |
| **B-render** | #149 | Capture baselines from `main` first, before #143 or #148 touch anything. |
| **Test** | #150, #151 | Both test-only. #150 touches `mockRepos.ts`; see §6. |
| **Bug** | #143 | Smallest, most self-contained. Good first win. |

Four lanes is the realistic ceiling for this backlog.

### Wave 2 — 2–3 concurrent lanes

| Lane | Work | Unblocked by |
| :--- | :--- | :--- |
| **A** | #146 — rewrite `multiplayerSync.ts` against the cursor; wire `entityMirror.ts` in | #145 |
| **B** | #148 — reconcile `src/render/painter/` vs `paint2d/`, cut `MapRenderer` over | #149 |
| **Opportunistic** | #153 | Nothing — but see §5 |

### Wave 3 — 2 concurrent lanes

| Lane | Work | Unblocked by |
| :--- | :--- | :--- |
| **A** | #147 — retire the full-state PATCH | #146 |
| **A2** | #152 — `AdvanceCharterTravel` command | #144/#145 landing; `commandHandler.ts` quiet |

### Wave 4 — tail

| Work | Notes |
| :--- | :--- |
| #154 | Phase-6-shaped. Sequence its own six steps internally; but see §5 on step 2. |
| #155 | One doc pass at the end. See §6. |

---

## 5. Scheduling Caveats

**#153 is trigger-gated, not wave-gated.** Its own plan says the obligation fires "once the settings slider is hidden behind a wall later in development." It has no code dependency on anything here, so schedule it by that event — or by the first time the game accepts untrusted players, whichever comes first. Link it from whatever change hides the slider. Wave 2 is a suggestion, not a deadline.

**#154 step 2 should happen early, out of band.** Running `scripts/migrate-jsonb-to-tables.ts` against real data is an ops step with no code dependency, and §6.2 of the track map is explicit that it has only ever run against representative fixtures — *"No real production historical dataset has been run through it yet."* The script is idempotent and has a dedicated convergence test. Do this whenever convenient rather than waiting for wave 4; you want to know now if real data surprises it, not at the end of a six-step retirement.

**#143 gets a second, stronger check later.** It is provable by unit test today, so it does not need to wait for #149. Once the visual gate exists, the arena double-paint is a good first real test case for it.

---

## 6. Conflict Surfaces

Things that will collide if worked concurrently:

| File | Issues | Severity |
| :--- | :--- | :--- |
| `server/persistence/repositories/eventRepo.ts` | #144, #145 | **Hard** — same signature. Combine or serialize. |
| `server/app/commandHandler.ts` | #144 (17 `append()` sites), #152 (new case) | **Hard** — hence #152 in wave 3. |
| `test/helpers/mockRepos.ts` | #144 (eventRepo stub), #150 (gameRepo record arrays) | Mild — different sections of one file. |
| `plan/2026-08-17-consolidated-phase-1-5-track-map.md` | all of them | Mild but chronic — see below. |

**On the track map specifically:** this repo has already had two branches independently add a "Revision note 5" at the same insertion point, and then two more independently add a "Revision note 6" — both collisions are recorded in the doc's own revision notes. The pattern that avoids it: each PR edits **only its own status row**, and the full §11/§12 rewrite happens once, at the end, as #155. Do not let every branch append a revision note.

---

## 7. Deliberately Not Filed

**R6 — `BuildStructure` / `StructureBuilt`.** Confirmed still absent: zero occurrences of either across `packages/`, `src/`, and `server/`. This is not incomplete refactor work — it is an engine reducer for a feature that has not been designed, and the track map already tracks it at §10 R6 with a clear reason and an explicit ∞ horizon. It does have one downstream consequence worth remembering: `src/render/scene/entityMirror.ts` cannot implement `StructureBuilt`, and #146's event subscription must not assume the variant exists. That constraint is written into #146.

Raise it as an issue if the feature gets scheduled.

---

## 8. Quick Reference — What Was Verified, File by File

Claims spot-checked against the tree rather than taken from the track map's narrative:

| Claim | Verified state |
| :--- | :--- |
| `renderer.ts` / `cityRenderer.ts` consume `SceneNode[]` | ❌ zero `SceneNode`/`paintScene`/`buildAdventureScene` references in either |
| `paint2d/` per-kind painters are stubs | ❌ **stale** — all 27 kinds dispatch to painters with real `ctx.*` calls |
| `paint2dDefaults.ts` / `skybox.ts` do not exist | ❌ **stale** — both exist (commit `866982b`) |
| `GET /games/:name/events` has `?after=` filtering | ❌ `server/routes.ts:486` has no `AND id > $2` |
| `eventRepo.append()` returns the inserted id | ❌ `eventRepo.ts:9` declared `Promise<void>`, no `RETURNING id` |
| `multiplayerSync.ts` is a full-state poller | ✅ still `api.getGame()` → `hydrateGameState()` at `:79`/`:86` |
| `SessionManager.manualSave()` PATCHes full state | ✅ still `hero_q`/`hero_r`/`turn`/`gold`/`enemy_positions` at `:80` |
| `game_events.actor_seat` is populated | ❌ never written, never read |
| `stepTravelCharter()` has a server command | ❌ client-local only, `turnController.ts:425` |
| `BuildStructure` / `StructureBuilt` exist | ❌ zero occurrences repo-wide |
| JSONB blob writes have stopped | ❌ `gameRepo.ts:146` still writes `heroes`/`settlements` as jsonb |
| CB-4 is in progress on a branch | ❌ **stale** — merged as PR #117 |
| `manualBattleArena.ts` is a thin shim | ✅ 17 lines; bulk lives in `arena/openManualBattleArena.ts` (1592 lines) |
| 13 commands ported and client-wired | ✅ both `commandHandler.ts` cases and `src/io/commands.ts` exports |

---

## 9. Related Docs

- `plan/2026-08-17-consolidated-phase-1-5-track-map.md` — the doc this audits; #155 refreshes it
- `plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md` — Phase 4 deep dive, context for #154
- `plan/2026-08-17-combat-decomposition-finishing-breakout.md` — §9.3/§9.4 define the flag #143 fixes
- `plan/2026-08-17-issue-88-remaining-command-ports.md` — "Resolved decisions" section, context for #153
- `plan/2026-08-17-issue-89-track-and-phase-assignment.md` — the audit that flagged #150's item originally
