# Heroes JS

<!-- docs:verified 2026-10-12 -->

A turn-based, hex-grid adventure game inspired by *Heroes of Might & Magic*. Move a hero across a procedurally generated hex map, claim resource tiles by building settlements on them, accumulate resources per turn, and defend them against enemy heroes.

## Prerequisites

- Node.js 22.x (see `engines` in `package.json`)
- On Windows: [PowerShell Core](https://github.com/PowerShell/PowerShell) (`pwsh`, not the built-in Windows PowerShell 5.1) — `npm run cleanup` and `npm run dev:status` shell out to it

## Quick start

```
npm install
npm run dev      # start the client + API server (concurrently)
npm test         # run the smoke test
npm run docs:check # check maintained documentation links and source paths
```

`npm install`'s `postinstall` step also installs Playwright's Chromium binary, which `npm test` needs.

`npm test` boots the API and a headless browser, plays through movement / capture / battle / transfer / trade / economy flows, and asserts on the resulting state and HUD.

`npm run test:all` runs the full browser/e2e suite and the Node unit suites. See the [operations guide](./docs/operations.md) before running DB-backed tests: the smoke suite can delete games, and `.env.test` must keep test traffic on the local database.

## Documentation

| If you want to know about… | Read |
|---|---|
| The tech stack, build setup, repo shape, languages | [TECHNICAL_SPECIFICATIONS.MD](./TECHNICAL_SPECIFICATIONS.MD) |
| Player-facing controls and rules | [Player guide](./docs/player-guide.md) |
| Local development, database, tests, multiplayer, deployment | [Operations guide](./docs/operations.md) |
| Current documentation catalog and as-built status | [docs/README.md](./docs/README.md) |
| Current TypeScript module layout | [Module map](./docs/module-documentation-and-relationships.md) |
| Historical source-layout plan | [docs/architecture.md](./docs/architecture.md) |
| Rendering and asset pipeline | [Render technical spec](./src/render/docs/technical-spec.md), [sprite pipelines](./docs/sprite-pipelines.md) |
| Asset sources and known provenance gaps | [Asset provenance](./docs/asset-provenance.md) |
| Coding constraints + Kilo agent behavior in this repo | [AGENTS.md](./AGENTS.md) |
| Kilo subagents (session-tracker, doc-updater, precommit-checker) | [.kilo/agent/](./.kilo/agent/) |
| Per-session change logs (one file per day, YYYY-MM-DD.md) | [sessionTracking/](./sessionTracking/) |
| Kilo slash commands (`/dev`, `/precommit`, `/pre-pr`) | [.kilo/command/](./.kilo/command/) |

## Status

App version is `0.6.1` (the root `package.json` is the source of truth). The game has procedural map generation, A* hero movement, settlements and capture, a six-resource economy, fog of war, construction, recruitment, upkeep, caravans, combat resolution, and new/load/save flows.

The app now opens to a **home / landing page** (New Game / Load Game / Settings / Sign In) before the canvas is shown; Sign In is an email magic-link flow (short-term: the 6-digit code is also surfaced in dev for testing — real email delivery comes later). Sign-in is optional; once signed in, the button becomes **Profile** (with a separate Sign Out button) and opens a profile panel with the editable account name, read-only email, and per-user stats.

Tactical combat and quick resolution are both live. A human attacker can Fight, Quick Resolve, or Flee; a human defending an AI-offered battle can Fight or Quick Resolve, but cannot Flee because the AI's move is already committed. Garrison assaults offer Assault, Auto-resolve, or Cancel. Hero defeat, retreat, surrender, and settlement-garrison outcomes are applied by the shared engine/server paths. See [`docs/battle-view-architecture.md`](./docs/battle-view-architecture.md).

Food is a game resource but is not generated on world-map tiles; food spots, production, consumption, and weekly upkeep are implemented. Recruitment, wagons, physical trade-route caravans, and the human/ashen/ironmark/verdant faction rosters are live. New games support 1–4 human players and 0–3 AI enemies. AI enemies on server-flagged games are server-driven, including garrison recruitment, trade routes, and charter founding; the registry-driven faction picker and server recruit gate are live.

Known economy caveat: market `goldPerTurn` is currently a projection-only value and is not credited to the treasury by End Turn. This remains open as finding F2 in [`docs/resource-gathering.md`](./docs/resource-gathering.md).
