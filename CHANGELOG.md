# Changelog

All notable changes to this project are documented here. The app version is the
root `package.json` `version` field; release tags are `v<semver>`. Bump it with
`npm run version:bump -- patch|minor|major`. The settings panel's build-info
footer shows the version, commit hash and build time.

**minor** marks a real game addition — new content or capability. **patch** marks
a bug fix, a chore, or housekeeping (docs, tooling, tests). The pre-commit gate
chooses between them for you from the intended commit type, and only bumps when
the version has not already been bumped in that changeset.

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
