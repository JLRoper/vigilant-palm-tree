# Project Review — Heroes JS (2026-08-29)

*Reviews the tree at `main@d89c0f6` (2026-08-24), plus live GitHub issue/PR state
(`JLRoper/vigilant-palm-tree`).*

*Method: read the repo layout, `AGENTS.md`, `README.md`, the plan/docs corpus, and
`analysis/2026-08-24-phase-1-5-track-map-audit.md`; then independently verified the
load-bearing claims against code and by running things — `npm run build`,
`npm run lint:deps`, `npm run test:unit`, and direct `tsx --test` runs of the test
files no npm script covers. Where a doc and the code disagreed, the code won.*

*Caveat on the environment: this was run without a local Postgres on :5432, so
every DB-backed test reports `ECONNREFUSED`. Those failures are called out as
environmental below and are not counted as defects.*

> **Update (same day): recommendation 1 has been implemented, and most of
> recommendation 2 with it.** Sections 1 and 2 below record the problem as found
> and then what changed. Acting on them turned up two further findings that were
> not visible from reading alone — a castle spawn-fairness regression (§3) and the
> fact that `test/` is excluded from typechecking (§4). Recommendation 3 (#154) is
> untouched and still the most important open item.

---

## Summary

The project is in good structural health and has a real discipline problem in its
test gate.

The architecture holds up under mechanical checking — `lint:deps` is clean across
336 modules, the build is green, and the `contracts` → `engine` → `src`/`server`
layering is genuinely enforced rather than merely documented. The command pipeline
and event-cursor sync landed properly.

Against that, as found: **CI proved almost nothing**, 15 test files were wired to
no script at all and several had already rotted against code that moved without
them, and the one piece of Phase 4 that Phase 4 existed to deliver (retiring the
JSONB blob) is unowned and drifting toward permanence.

The first two are now fixed (§1, §2) — CI runs 499 tests where it ran none. Doing
that surfaced a live gameplay regression the dormant tests had been hiding (§3),
which is the best available argument that the gate was worth closing. The JSONB
item is untouched and is now the top priority.

Recommendations, including what was deliberately *not* done, are at the end.

---

## Shape of the project

- 468 commits since 2026-07-18 — about six weeks.
- 35.5k lines of TypeScript: `src/` 26.3k (139 files), `server/` 4.0k (20),
  `packages/engine` 4.2k (48), `packages/contracts` 0.9k (27).
- 13.5k lines of tests across 48 `*.test.ts` files.
- 186 PRs, 7 open issues.
- Four contributor identities plus agent commits.
- Cadence peaked at 159 commits in W34; quiet since 2026-08-24.

---

## What's genuinely solid

- **Architecture boundaries are real, not aspirational.** `npm run lint:deps`
  passes clean across 336 modules / 1016 dependencies. At this size that's rare,
  and it's the main reason the codebase still feels tractable.
- **`npm run build` is green.** No type debt accumulating.
- **Zero `TODO`/`FIXME`/`HACK` in the entire source tree.** Deferred work lives in
  issues and docs rather than rotting in comments. That's real discipline — but it
  makes the docs load-bearing, which matters given the drift noted below.
- **The command pipeline and event-cursor sync landed properly.** 13 ported
  commands, all client-wired; `multiplayerSync` runs off an event cursor rather
  than a full-state poller (#146). The server-authoritative direction is being
  followed through consistently rather than half-applied.
- **The 2026-08-24 self-audit is excellent work.** It verified its own plan docs
  against the code instead of narrating them, and caught a doc that had shipped a
  prediction about a PR that changed shape mid-review. That habit is worth keeping.

---

## 1. The CI gate is hollow

`.github/workflows/validate-game.yml` runs exactly two substantive things on a
pull request: `npm run build` and `npm test`.

`npm test` is `test/smoke.ts` — and that file's `run()` has been dead since
2026-07-30. `test/smoke.ts:541` is still the literal placeholder:

```
    // ... rest of the test flow unchanged ...

    console.log(">> ALL TESTS PASSED");
```

`runNewLoadSaveFlow` (line 181) and `runTilesEndpointChecks` (line 131) are
defined and never called.

So CI proves: the dev server boots, the bundle compiles, the client initializes.
Nothing else. **The 310 unit tests never run in CI at all** — `test:unit` is not in
the workflow, and neither is `lint:deps`.

This is filed as #175, but the issue's framing undersells it. The problem isn't
only that `smoke.ts` is gutted; it's that nothing else is wired to the PR gate to
compensate. Every "`npm run test:all` green" claim in the plan docs since late July
was a local-machine claim resting on someone running the `precommit-checker`
agent, not an enforced one.

`AGENTS.md` does specify a `precommit-checker` gate running `build` + `test:all`,
and `test:all` does chain `test:unit`. That's the right intent — it just isn't
enforced by anything, and it needs a local Postgres to be meaningful.

### Fixed

`validate-game.yml` now runs, after the build and before the smoke test:

- `npm run lint:deps` — the dependency-boundary check, which was passing locally
  and gating nothing.
- `npm run db:schema` — a new script that calls `initSchema()` against the
  workflow's existing `postgres:16-alpine` service. Added so the unit step doesn't
  depend on the earlier `npm run dev` boot step having incidentally created the
  tables. `schema.sql` and the migrations are idempotent, so it is safe to re-run.
- `npm run test:unit` — 499 tests.

`db:schema` deliberately takes **no** `--env-file`. `server/persistence/db.ts`'s
defaults (`localhost:5432 / gameuser / gamepass / game_poc`) already match both the
docker-compose container and the CI service, and reading `.env` would risk
following `PGHOST` to the gameserver — exactly what `.env.test` exists to prevent.
`.env` has also been deleted by that point in the workflow, so a `--env-file=.env`
would fail outright.

---

## 2. Fifteen test files are orphaned, and several have already rotted

`test:unit`'s glob covers `test/server`, `test/persistence`, `test/migrations`,
`test/render`, `test/engine`, `test/io`, `test/net`, and `test/screens`.

It does **not** cover `test/charter/`, `test/combat/`, `test/state/`, `test/map/`,
or the five root-level `test/*.test.ts` files. No other npm script picks them up
either.

Running them directly: **23 of 170 fail**, and the failures are not all
environmental.

| File | Failure | Reading |
|---|---|---|
| `test/state/economy.test.ts` | `@heroes/engine` does not provide an export named `BUILDING_UPKEEP_STONE` | Won't even load. The export was removed and nothing noticed. |
| `test/state/income.test.ts` | `TypeError: s.buildings is not iterable` | Fixtures predate the current settlement shape. |
| `test/map/castlePlacement.test.ts` | `AssertionError: expected 15, actual 6` | Map-gen behavior changed; the test was never re-run against it. |
| `test/dragDrop.test.ts`, `test/proposedPath.test.ts` | `ECONNREFUSED ::1:5432` | Environmental — these need a live DB. |

Worth calling out specifically: `test/combat/resolveBattle.test.ts`,
`test/combat/manualBattle.test.ts`, and the four files in `test/charter/` cover the
battle resolver and the charter travel that **just shipped in #152** — and none of
them has ever been in a script.

The other 70 failures inside `test:unit` proper are all `ECONNREFUSED` from the
persistence suite, which is fine. But note they hard-fail rather than skip, so
"the database is down" and "persistence is broken" produce an identical signal.
Worth a guard that skips with a clear message when :5432 is unreachable.

### Fixed, with two deliberate exclusions

`test:unit` now covers `test/charter`, `test/combat`, `test/map`, `test/state`, and
the three standalone root files (`cityGrid`, `citySpots`, `minimap`) on top of what
it had. **499 tests, up from 310** — the 189 added all pass.

The three rotted files were repaired rather than deleted. In each case
`git log -S` showed the implementation change came from a deliberate feature
commit and the test was simply never re-run, so the test was the stale side:

- **`test/state/economy.test.ts`** — flat `BUILDING_UPKEEP_WOOD`/`_STONE`
  constants became a per-kind registry lookup (`buildingUpkeep(kind, level)`) in
  the "extract economy domain into packages/engine" refactor. Rewrote the upkeep
  and supplies-deficit tests against the registry; they now assert real per-building
  costs instead of the old "it's 0 for now" placeholder.
- **`test/state/income.test.ts`** and **`test/state/gameState.test.ts`** — fixtures
  predated `buildings`/`citySpots`/`cityMines`/`castleVariant` becoming required on
  `SettlementState`, so `buildingUpkeepRequired` threw `s.buildings is not
  iterable`. Fixtures completed.
- **`test/map/castlePlacement.test.ts`** — see §3; the constants moved (`MIN` 2→4,
  `MAX` 5→15) and the human now gets two castles.

**Still orphaned, deliberately: `test/dragDrop.test.ts` and
`test/proposedPath.test.ts`.** These are not unit tests — they spawn their own API
and `vite preview` servers and drive Chromium via Playwright. `proposedPath` also
hardcodes ports 4174/3002, which bypasses the per-worktree port allocation that
`scripts/allocate-ports.ts` exists to guarantee. They belong in the
`tools/run-test.mjs` harness alongside smoke/multiplayer/cityview/visual, not in
`test:unit`, and wiring them there needs port plumbing that is out of scope here.
Left as-is rather than silently folded into a glob where they would fail.

---

## 3. New — a castle spawn-fairness regression the dormant test was hiding

This is the clearest argument for everything above: turning the dormant test back
on immediately surfaced a live gameplay bug.

`test/map/castlePlacement.test.ts` asserted "player in left half, AI in right
half." That test has not run since `HUMAN_CASTLE_COUNT` went from 1 to 2 in the
"world scaling progress" commit — and it no longer holds.

`src/map/castlePlacement.ts:106` still places castles using the old layout array:

```ts
const order: ("left" | "right" | "any")[] = ["left", "right", "any", "any", "any"];
```

Index 0 is placed left, index 1 right. But `ownerForIndex` now assigns **both**
index 0 and index 1 to the human. So the "right" slot is the human's *second*
castle, and the AI slides down to index 2 — `"any"` — which can put it anywhere,
including inside the human's half.

Observed on map seed 42, `playerCount: 2` (map width 24, midpoint 12):

| Castle | Owner | q |
|---|---|---|
| #0 | human (capital, L1) | 7 |
| #1 | human (L2) | **12** — the "right" slot |
| #2 | **AI** | **2** — deep in the human's half, 5 tiles from the capital |
| #3 | neutral | 13 |

The starting-position fairness guarantee is gone: the AI can spawn closer to the
human capital than the human's own second castle. The placement `order` array and
`ownerForIndex` encode two different designs.

**I did not fix this** — how the second human castle and the rivals *should* be
distributed is a game-design decision, not a mechanical one. The test now asserts
only what is genuinely guaranteed today (the human capital is in the left half),
with a comment explaining why it deliberately does not assert the AI's side. Locking
the current behavior into a test would have cemented the regression; leaving the old
assertion would have kept CI red. Needs an issue and a design call.

---

## 4. New — `test/` is excluded from typechecking

`tsconfig.json`'s `include` is `["src", "packages/contracts/src",
"packages/engine/src", "server"]`. Test files are never typechecked by
`npm run build`.

That is how the rot in §2 stayed invisible. Concretely, every `generateCastles`
call in `castlePlacement.test.ts` omitted `playerCount` — a **required** field on
`CastlePlacementOptions` — and nothing complained. The settlement fixtures were
likewise missing four required `SettlementState` fields.

Adding `test` to `include` is a one-line change, but it will surface a batch of
existing errors across the suite, so it wants its own PR rather than riding along
with this one.

---

## 5. Structural debt worth naming

### Phase 4 didn't finish the thing Phase 4 was for

`server/persistence/repositories/gameRepo.ts:146` still builds
`sets = ["heroes = $1::jsonb", "settlements = $2::jsonb"]` on every
`saveHeroesAndSettlements()` call. The granular tables are a second copy, not *the*
copy.

Dual-write was meant to be a migration step and has quietly become the permanent
architecture. This is #154 — open and unowned since 2026-08-19. The longer both
paths stay live, the more expensive the eventual cutover gets: `hydrate.ts` already
carries fallback logic for partial/inconsistent state between the two.

This is the one item on this list whose cost is still actively growing.

### EntityMirror is plumbed but inert

#180 step 1 shipped: `renderer.ts:34` stores the mirror and `renderer.ts:82`
exposes `getMirror()`. That is the entire extent of it — nothing reads it.
`adventureScene.ts` still builds `Hero[]`/`Castle[]`/`Settlement[]` from the
`GameState`-derived snapshot.

Concretely: `HeroMoved` deltas snap instead of tweening, and captured-settlement
owner colors don't reach the canvas until the next full resync — even though the
mirror already holds both.

### Manual combat is the repo's largest file and it's off the player path

`src/screens/combat/arena/openManualBattleArena.ts` is 1598 lines — the biggest TS
file in the project — and its only callers are the compatibility shim and the dev
console. `src/game/turnHooks.ts:140` auto-resolves on hero collision.

Two open bugs sit against code no player currently reaches: #139 (platoons teleport
instead of walking) and #141 (orphaned modal scrim that reads as a game freeze).

### Auth exists but confers nothing

`server/middleware/attachPlayerSeat.ts` never rejects a request; anonymous callers
fall through to the client-supplied `actor` field exactly as before #179/#181. This
is a deliberate and well-documented choice (`docs/auth-model.md`), not an
oversight — but the consequence is that the `upgradePopulationGate` client-trust
hole (#153) has no closing date, and the sign-in wiring work didn't actually change
the trust model. The 2026-08-24 audit's §2 covers how the plan docs got this
backwards; the correction still only exists in a GitHub comment.

---

## 6. Docs and repo hygiene

**Doc volume has outgrown its maintenance.** 37 files in `plan/`, 23 in `docs/`,
plus `analysis/` and `feature-plans/`. The 08-24 audit's own §1 finding was that
status tracking silently forked across two documents which then disagreed — that's
a symptom of the volume. #183 (fold them back into one) is the right fix and is
still open.

`README.md` also still points at `sessionTracking/` as a live per-session log. It
stopped on 2026-08-05.

**Seven junk files are tracked in git at the repo root:**

- `PlatoonStripDetail.java` and `PlatoonStripDetail1.java` — byte-identical to each
  other, and Java in a TypeScript project.
- `bash_test_file.txt`
- `pixel-art.html`
- `copy.mjs`
- `screenshot.js` and `screenshot.mjs` — near-duplicates of each other.

Separately, root `pixel-gen.mjs` **differs from** `tools/sprites/pixel-gen.mjs`,
which is the one `npm run sprites:generate` actually invokes. The root copy is a
stale fork that someone could edit by mistake and never notice.

---

## Recommendations

### Done in this pass

1. ~~**Add `test:unit` and `lint:deps` to `validate-game.yml`, and widen the
   `test:unit` glob.**~~ Done — see §1 and §2. CI now runs `lint:deps`,
   `db:schema`, and 499 unit tests on every PR. Two files were deliberately left
   out of the glob with reasons given, so "all 48" became 46.

2. ~~**Fix or delete the rotted orphan tests.**~~ Mostly done — the four rotted
   files were repaired against the shipped behavior, with `git log -S` used in each
   case to confirm the implementation change was deliberate and the test was the
   stale side. **Not done:** the skip-with-message guard for an unreachable :5432.
   DB-down still looks identical to persistence-broken, which cost real time during
   this review. Worth a small helper in `test/helpers/pgTestTx.ts`.

### Still open, in priority order

3. **Give #154 an owner and a date.** Unchanged and now the most important item on
   the list. Permanent dual-write taxes every future change to persistence, and the
   cost compounds. Everything else here is bounded work that can wait.

4. **Decide the castle spawn-fairness question (§3) and file it.** The AI can
   currently spawn deeper in the human's half than the human's own second castle.
   This needs a design call on how rivals should be distributed once the human holds
   two castles, then a fix to the `order` array in
   `src/map/castlePlacement.ts:106`. The test is written to accept either outcome
   without needing a rewrite.

5. **Add `test` to `tsconfig.json`'s `include` (§4).** One line, but it will
   surface a batch of existing errors, so give it its own PR. Until then the test
   suite is the one part of the codebase with no type safety at all — which is how
   §2's rot went unnoticed for a month.

6. **Move `dragDrop` and `proposedPath` into `tools/run-test.mjs`** so the last two
   orphans get a home, and fix `proposedPath`'s hardcoded ports while doing it.

### Verification note

`build`, `lint:deps`, and the 189 newly-included tests were all run green locally.
The 70 DB-backed tests could **not** be verified locally — Docker was not running
on this machine, so Postgres was unavailable. They fail identically before and
after this change (69 × `ECONNREFUSED`, 1 × a 500 from the auth request-code route,
also DB-backed), so this pass did not introduce them, but the first CI run on this
PR is the real check that the `db:schema` step plus the persistence suite go green
against the workflow's Postgres service.
