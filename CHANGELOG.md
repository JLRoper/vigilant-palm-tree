# Changelog

All notable changes to this project are documented here. The app version is the
root `package.json` `version` field; release tags are `v<semver>`. Bump it with
`npm run version:bump -- patch|minor|major`. The settings panel's build-info
footer shows the version, commit hash and build time.

While the major version is `0`, **minor** bumps carry breaking changes and
**patch** bumps carry features and fixes.

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
