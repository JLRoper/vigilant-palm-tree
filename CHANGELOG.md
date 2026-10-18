# Changelog

All notable changes to this project are documented here. The app version is the
root `package.json` `version` field; release tags are `v<semver>`. Bump it with
`npm run version:bump -- patch|minor|major`. The in-game toolbar gear (⚙)
dropdown menu's build-info footer shows the version, commit hash and build time.

**minor** marks a real game addition — new content or capability. **patch** marks
a bug fix, a chore, or housekeeping (docs, tooling, tests). The pre-commit gate
chooses between them for you from the intended commit type, and only bumps when
the version has not already been bumped in that changeset.

## [0.13.0] - 2026-10-18

Startup districts: tier-2 settlements are born with 1 district and tier-3 with 2 (a couple of level-1 buildings each), every district must join the settlement's cluster (no floating districts, bridged across water only by a water district holding a shipyard), and the new water-only shipyard building + art.

## [0.12.0] - 2026-10-18

City view: per-settlement biome settlement diorama backdrop (default, with a watercolor-skybox fallback), a see-through outline-only grid with a City grid lines toggle, and a diorama plate sized from the measured grid footprint for 10x10/15x15 cities.

## [0.11.0] - 2026-10-18

Logistics panel: icon stockpiles with floating tooltips, inline wagon/cart purchases with price tooltips, and one-row compact route visualization

## [0.10.0] - 2026-10-18

Workforce staffing system: per-100-pop worker pool, assignable staffing scaling production/draft recharge/upgrade speed. The first assignment auto-crews the remaining pool (jobs first by kind, then houses), workers/draft survive the city-view round-trip, and drag/panel lifecycle fixes land with it (drops over UI cancel, the panel closes with the city, Escape closes it first).

## [0.9.1] - 2026-10-17

Move game version/build info from the settings panel footer into the toolbar gear dropdown
fix(economy): round stored settlement gold and warehouse quantities half-up to whole integers at the write points

## [0.9.0] - 2026-10-17

feat: uncharted fog-of-war mode

## [0.8.0] - 2026-10-17

feat(districts): add city districts on controlled territory hexes (5x5 district grids, adventure map district sprites, economy/storage pooling, and enemy hero occupation blocking) and 20 new Tier 1 settlement sprites (`4 variants × 5 building-count fullness stages`)

## [0.7.0] - 2026-10-17

feat(hud): isometric resource icons and a population capsule in the header bar

## [0.6.0] - 2026-10-16

Tier 4 large-map scaling (v3 mapGenVersion, proportional blobs/settlements, mandatory castle connectivity, AI reach scaling), charter/sprite optimizations, dirty-entity persistence, and nginx web-runtime

## [0.5.2] - 2026-10-12

chore: enable default worktree-first workflow in heroes-js; align AGENTS.md, agents, commands, skills; Phase 05 concurrency+recovery drill merged

## [0.5.1] - 2026-10-12

test: add tsconfig.test.json (ambient Vite types in scope) and a test:types script, gate unwired

## [0.5.0] - 2026-10-11

feat(heroes): add the lionheart mounted hero variant with banner, names and directional sprites

## [0.4.0] - 2026-10-11

feat(ui): restyle the toolbar with a two-row layout and selectable modern/classic-blue themes

## [0.3.8] - 2026-10-11

test(visual): classify the real target-close message in isReloadRace

## [0.3.7] - 2026-10-11

test(visual): harden the visual-regression gate against reload races

## [0.3.6] - 2026-10-11

chore(sprites): computed building-anchor offsets with drift gate

## [0.3.5] - 2026-10-11

nginx cache gateway in front of vite preview: immutable hashed /assets, no-cache index.html, no-store and unbuffered /api so the SSE event stream is never stalled

## [0.3.4] - 2026-10-11

fix(upkeep): suppress unfed-troops warnings while the entity is currently affordable (pure read-side evaluators, panel badge gates, weekly-charge cadence tooltips); the weekly charge itself is unchanged

## [0.3.3] - 2026-10-11

Make building-sprite coverage exhaustive over BuildingKind, so a new kind cannot ship a blank tile.

## [0.3.2] - 2026-10-11

Anchor the version gate's already-bumped check to the newest release tag so it stops going blind once another commit lands on top of a release.

## [0.3.1] - 2026-10-10

### Added

- **`npm run version:bump -- patch|minor|major|X.Y.Z`** — the app's version-bump
  routine. Rewrites the root `package.json` version in place (formatting
  preserved), prepends a `CHANGELOG.md` entry, and optionally commits, tags and
  pushes (`--commit` / `--tag` / `--push`). `--dry-run` previews without
  writing, and `-m "..."` overrides the default git-log summary.
- **`CHANGELOG.md`** — baseline entry for 0.3.0 (the contents of the current
  release) plus the versioning policy.
- **A Versioning section in `AGENTS.md`** — declares the root `package.json`
  version the single source of truth, the tag format `v<semver>`, and the
  semver meanings while the major is `0`.
- **Guard tests** (`test/core/version.test.ts`) — the app version must be valid
  semver, and `vite.config.ts` must keep stamping version, commit hash and build
  time from `package.json`, so the chain
  `package.json → define → core/version.ts → settings footer` cannot silently
  break.

### Fixed

- **Docker builds now stamp a real commit hash.** `.git` is excluded from the
  build context (179 MB of PNG art history; copying it in would grow the 340 MB
  context to ~520 MB), so the container could never resolve a commit and every
  deployed build reported the literal fallback — the settings panel's build info
  read `v0.3.0 (dev)`. `docker/Dockerfile` now takes
  `ARG VITE_COMMIT_HASH`, compose passes it to both `api` and `web`, and
  **`npm run docker:build`** resolves it on the host and forwards it. A bare
  `docker compose build` still defaults to `dev`, which is why `AGENTS.md` now
  routes Docker builds through the wrapper.
- **`.dockerignore` tightened** — `local/` (115 MB, and `AGENTS.md` forbids
  committing anything under it), `design/` (86 MB) and a bare `.env` now excluded.
  All three were shipping into every build context.

## [0.3.0] - 2026-10-10

Baseline entry, added when the changelog and the version-bump routine were
introduced. The version field had never been changed since the initial commit,
so the history before this entry is not itemized here — see `git log` for the
345 commits that precede it.

### What 0.3.0 contains

- **Rendering**: the whole draw path rebuilt around the SceneGraph seam
  (`buildAdventureScene`/`buildCityScene`/`buildBattleScene` → `paintScene`),
  entity rendering through `EntityMirror`, and the per-kind painter set
  consolidated to one implementation.
- **Sprites**: registry-driven arena unit art, horse run-cycle frames, four
  faction rosters (human, ashen, ironmark, verdant) with icons, banners and
  buildings, and a code generator that derives the building-sprite key list
  from the art folder (`npm run gen:sprite-keys`).
- **Gameplay**: AI enemy seats (client- and server-driven), settlement capture
  and garrison battles, per-hero battle verdicts, the trade-route/caravan
  logistics rework with no shared storage, bank pots, and per-settlement farms.
- **Multiplayer**: SSE event push alongside the poll fallback, presence-aware
  seat drop policy, and the log message panel.
- **Tooling**: Playwright visual-baseline gate, dependency-cruiser layer rules,
  Docker deployment stack, and a build-info footer in the settings panel.
