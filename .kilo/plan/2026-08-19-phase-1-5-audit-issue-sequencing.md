# Phase 1–5 Audit: Findings, Issues, and Execution Order

*Authored: 2026-08-19*
*Audits: `plan/2026-08-17-consolidated-phase-1-5-track-map.md` against the tree at `f395e95` (main, post-#138).*
*Produces: issues #143–#155, and the wave ordering below.*
*Repo: `JLRoper/vigilant-palm-tree`*
*Status reviewed: 2026-08-24, against `origin/main@e69a7d3`.*

---

**2026-08-24: this doc's job is done — folded back into the track map.** Per the decision recorded in `plan/2026-08-17-consolidated-phase-1-5-track-map.md`'s revision note 13 (issue #183): this doc's original 13-issue audit set is 11/13 closed, and the 2026-08-24 update below (§0) is itself the example of why splitting status across two docs is risky — it made a claim about PR #181 that turned out to be a pre-merge prediction, got corrected in a GitHub comment on #153, and that correction sat uncommitted here for the rest of the day because nothing forced this doc back into sync with the track map. §0 below is corrected in place rather than left wrong, but **this document is now historical — future status updates land directly in the track map, not here.**

---

## 0. Status Update (2026-08-24)

Checked against live GitHub issue/PR state.

**#153's blocker is now concretely in flight, not just theoretical.** Investigating #153 for implementation found that its second trigger condition — *"the game first accepts untrusted players"* — depended on a completely separate, orphaned plan (`plan/2026-08-17-auth-wiring-and-per-game-membership.md`) that had no tracking issue and had already silently missed its own stated deadline (it says it must land before #146's `multiplayerSync.ts` rewrite merges; that rewrite merged 2026-08-21 with no auth in front of it). Filed **#179** to track it, then implemented and opened **[PR #181](https://github.com/JLRoper/vigilant-palm-tree/pull/181)**: wires `requireAuth` + a new `requireGamePlayer` membership middleware into every route that reads or mutates a game — including `POST .../commands`, previously the one unauthenticated mutation path in the entire app.

**CORRECTED 2026-08-24 (was wrong the same day it was written — see track map revision note 13):** the line originally here claimed "every route requires an authenticated, seat-claimed caller" once PR #181 merges. That was a prediction against #181's in-review design, written before the PR changed direction. **PR #181 merged with sign-in optional everywhere, not required** — see `docs/auth-model.md`: *"Nothing rejects an anonymous caller; being signed in only ever adds protection on top of what an anonymous caller already gets."* Anonymous callers stay fully trusted on the client-supplied `actor` field, identical to pre-#179 behavior. A comment on #153 itself (posted after #181 merged) caught this and laid out two ways to re-scope the trigger: **(a)** redefine it as "once real accounts/sessions are load-bearing for something," which #181 alone doesn't establish, or **(b)** leave `upgradePopulationGate` client-trusted until there's an actual hard auth wall, consistent with every other client-trusted field in the app. #153 stays open under option (b) — PR #181 does not itself touch `upgradePopulationGate` or #153's own plan, and there is still no hard auth wall for the second trigger to have fired against.

**#154 is unchanged:** still open, unowned, tail work.

**#179/PR #181 are outside this doc's original 13-issue set** (§2's table is left as-is, describing only what the 2026-08-19 audit found) — noted here because it's what actually moves #153 forward, and because the orphaned-plan pattern that produced it (a real, time-pinned plan with no tracking issue, silently missing its own deadline) is worth watching for elsewhere in this backlog too.

---

## 0.1 Status Update (2026-08-23) — historical

Checked against live GitHub issue state.

**Closed since the 2026-08-22 update:** #147, #150, #152 — the entire wave 3 frontier plus the #150 test-guard item (closed by PR #160 on 2026-08-23).
- **#147** — `SessionManager.manualSave()` now goes through the command pipeline instead of PATCHing full state (landed 2026-08-23).
- **#150** — `mockRepos.ts` now has `snapshotCalls`/`transactionCalls` recorded-call arrays, and `commandHandler.test.ts` asserts `EndTurn` writes `settlement_snapshots` only for the actor's own settlements and `resource_transactions` only for transfers that actually fired.
- **#152** — `AdvanceCharterTravel` server command landed; charter travel-stepping is no longer client-authoritative.

**Only 2 of 13 issues remain open, both by design, not by neglect:**
- **#153** — trigger-gated per §5; waits on the settings slider being hidden or the game accepting untrusted players. No action expected yet.
- **#154** — Phase-6-shaped JSONB blob retirement; tail work, unowned as flagged.

**Net effect on the wave plan:** Waves 1–3 are fully done — all 11 non-tail, non-trigger-gated issues in this audit's set are closed. Wave 4 (#154) is the only unscheduled work item left; #155's doc refresh already landed. This sequencing plan's active job is finished — what's left is #153's trigger and #154's six-step retirement, both already fully specified in §5 and their own issue bodies.

---

## 0.2 Status Update (2026-08-22) — historical

Checked against live GitHub issue state and spot-verified in the tree (`origin/main@4c89d9a`), before #147/#150/#152 closed.

**Closed (9 of 13):** #143, #144, #145, #146, #148, #149, #151, #155 — plus #140/#142 from the same period (not part of this audit's issue set, but merged in the same window). Verified in-tree, not just by issue status:
- #143 — arena double-paint fixed.
- #144 + #145 — landed together as required; `eventRepo.append()` and `actor_seat` plumbing done.
- #146 — `src/io/multiplayerSync.ts` (moved from `src/net/`) is now cursor-based (`this.cursor`, `ResyncReason`), wired to `EntityMirror`. No longer a full-state poller.
- #148 — `cityRenderer.ts` and `sceneBuilder/` now consume/produce `SceneNode[]`; single painter path confirmed.
- #149, #151, #155 — closed per GitHub; not re-verified line-by-line this pass.

**Still open (5 of 13):**
- **#147** — `SessionManager.manualSave()` (now `src/managers/SessionManager.ts`) still PATCHes `hero_q`/`hero_r`/`turn`/`gold`/`enemy_positions` directly. Unblocked now that #146 is done — this is the next Track A item.
- **#150** — `test/server/commandHandler.test.ts`'s fake pool client accepts `INSERT INTO settlement_snapshots`/`resource_transactions` but nothing asserts EndTurn actually issues them. Still just a permissive stub, not a guard.
- **#152** — `stepTravelCharter()` is still client-local only (`src/state/turnController.ts:425`); no `AdvanceCharterTravel` server command exists. Now unblocked (#144/#145 landed, `commandHandler.ts` is quiet).
- **#153** — trigger-gated per §5, not expected to move until the settings slider is hidden. No action needed yet.
- **#154** — `gameRepo.ts` still writes `heroes`/`settlements` as JSONB. Unowned, as flagged; tail work.

**Net effect on the wave plan:** Wave 1 is fully done. Wave 2 is done except the trigger-gated #153. Wave 3 (#147, #152) is now the active frontier — both are unblocked and independent of each other (different files: `SessionManager.ts` vs `turnController.ts`/`commandHandler.ts`). Wave 4 (#154) remains tail work; its step 2 (real-data migration dry run) can still be done early per §5 if not already done.

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

| # | Title | Kind | Wave | Status (2026-08-23) |
| :--- | :--- | :--- | :--- | :--- |
| [#143](https://github.com/JLRoper/vigilant-palm-tree/issues/143) | Arena double-paints under `?paint=scenebuilder` | bug | 1 | ✅ Closed |
| [#144](https://github.com/JLRoper/vigilant-palm-tree/issues/144) | `game_events.actor_seat` is dead schema | bug | 1 | ✅ Closed |
| [#145](https://github.com/JLRoper/vigilant-palm-tree/issues/145) | No `?after=` cursor; `eventRepo.append()` discards the id | refactor | 1 | ✅ Closed |
| [#146](https://github.com/JLRoper/vigilant-palm-tree/issues/146) | `multiplayerSync.ts` still a full-state poller | refactor | 2 | ✅ Closed |
| [#147](https://github.com/JLRoper/vigilant-palm-tree/issues/147) | `SessionManager.manualSave()` still PATCHes full state | refactor | 3 | ✅ Closed |
| [#148](https://github.com/JLRoper/vigilant-palm-tree/issues/148) | Two parallel painter sets; no renderer consumes `SceneNode[]` | refactor | 2 | ✅ Closed |
| [#149](https://github.com/JLRoper/vigilant-palm-tree/issues/149) | Phase 5's visual-regression gate does not exist | enhancement | 1 | ✅ Closed |
| [#150](https://github.com/JLRoper/vigilant-palm-tree/issues/150) | #89 follow-up: no unit guard on audit-row writes | bug | 1 | ✅ Closed |
| [#151](https://github.com/JLRoper/vigilant-palm-tree/issues/151) | No client test for the `drainPendingCommands()` barrier | bug | 1 | ✅ Closed |
| [#152](https://github.com/JLRoper/vigilant-palm-tree/issues/152) | Charter travel-stepping still client-authoritative | refactor | 3 | ✅ Closed |
| [#153](https://github.com/JLRoper/vigilant-palm-tree/issues/153) | `upgradePopulationGate` is client-trusted | bug | 2 (trigger-gated) | 🟡 Open — trigger not yet fired; PR #181 shipped optional auth, not a hard wall, see §0 |
| [#154](https://github.com/JLRoper/vigilant-palm-tree/issues/154) | JSONB blob retirement is unowned | refactor | 4 | 🟡 Open — tail work |
| [#155](https://github.com/JLRoper/vigilant-palm-tree/issues/155) | Track map stale; in-code comments contradict the code | documentation | 4 | ✅ Closed |

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

### Wave 1 — 4 concurrent lanes — ✅ done 2026-08-23

| Lane | Work | Notes |
| :--- | :--- | :--- |
| **A-server** | ~~#144~~ **+** ~~#145~~ ✅ as one PR | The signature change happens once. See §3. |
| **B-render** | ~~#149~~ ✅ | Capture baselines from `main` first, before #143 or #148 touch anything. |
| **Test** | ~~#150~~, ~~#151~~ ✅ | Both test-only. #150 touches `mockRepos.ts`; see §6. |
| **Bug** | ~~#143~~ ✅ | Smallest, most self-contained. Good first win. |

Four lanes is the realistic ceiling for this backlog.

### Wave 2 — 2–3 concurrent lanes — done except #153 (trigger-gated, see below)

| Lane | Work | Unblocked by |
| :--- | :--- | :--- |
| **A** | ~~#146~~ ✅ — rewrite `multiplayerSync.ts` against the cursor; wire `entityMirror.ts` in | #145 |
| **B** | ~~#148~~ ✅ — reconcile `src/render/painter/` vs `paint2d/`, cut `MapRenderer` over | #149 |
| **Opportunistic** | #153 — still 🟡 open; PR #181 merged but shipped optional auth, so the trigger has not fired (see §0/§5) | Nothing — but see §5 |

### Wave 3 — 2 concurrent lanes — ✅ done 2026-08-23

| Lane | Work | Unblocked by |
| :--- | :--- | :--- |
| **A** | ~~#147~~ ✅ — retire the full-state PATCH | #146 |
| **A2** | ~~#152~~ ✅ — `AdvanceCharterTravel` command | #144/#145 landing; `commandHandler.ts` quiet |

### Wave 4 — tail

| Work | Notes |
| :--- | :--- |
| #154 | Phase-6-shaped. Sequence its own six steps internally; but see §5 on step 2. |
| #155 | One doc pass at the end. See §6. |

---

## 5. Scheduling Caveats

**#153 is trigger-gated, not wave-gated.** Its own plan says the obligation fires "once the settings slider is hidden behind a wall later in development." It has no code dependency on anything here, so schedule it by that event — or by the first time the game accepts untrusted players, whichever comes first. Link it from whatever change hides the slider. Wave 2 is a suggestion, not a deadline. **Update 2026-08-24 (corrected):** [PR #181](https://github.com/JLRoper/vigilant-palm-tree/pull/181) merged, but shipped optional sign-in rather than a hard auth wall — see the correction in §0. The game still doesn't accept untrusted players in the sense this trigger means; #153 is not yet ready to pick up on that basis and stays scheduled by trigger, not by this PR landing.

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
- `plan/2026-08-17-auth-wiring-and-per-game-membership.md` — the orphaned plan behind #153's second trigger; tracked as #179, implemented by PR #181
