# Heroes JS

A turn-based, hex-grid adventure game inspired by *Heroes of Might & Magic*. Move a hero across a procedurally generated hex map, claim resource tiles by building settlements on them, accumulate resources per turn, and defend them against enemy heroes.

## Prerequisites

- Node.js 22.x (see `engines` in `package.json`)
- On Windows: [PowerShell Core](https://github.com/PowerShell/PowerShell) (`pwsh`, not the built-in Windows PowerShell 5.1) — `npm run cleanup` and `npm run dev:status` shell out to it

## Quick start

```
npm install
npm run dev      # start the client + API server (concurrently)
npm test         # run the smoke test
```

`npm install`'s `postinstall` step also installs Playwright's Chromium binary, which `npm test` needs.

`npm test` boots the API and a headless browser, plays through movement / capture / battle / transfer / trade / economy flows, and asserts on the resulting state and HUD.

## Documentation

| If you want to know about… | Read |
|---|---|
| The tech stack, build setup, repo shape, languages | [TECHNICAL_SPECIFICATIONS.MD](./TECHNICAL_SPECIFICATIONS.MD) |
| Game design — resources, settlements, heroes, economy, map, art | [docs/README.md](./docs/README.md) |
| The TypeScript module layout under `src/` | [docs/architecture.md](./docs/architecture.md) |
| Front-end rendering performance TODOs | [docs/TODO-front-end-efficiency.md](./docs/TODO-front-end-efficiency.md) |
| Coding constraints + Kilo agent behavior in this repo | [AGENTS.md](./AGENTS.md) |
| Kilo subagents (session-tracker, doc-updater, precommit-checker) | [.kilo/agent/](./.kilo/agent/) |
| Per-session change logs (one file per day, YYYY-MM-DD.md) | [sessionTracking/](./sessionTracking/) |
| Kilo slash commands (`/dev`, `/precommit`, `/pre-pr`) | [.kilo/command/](./.kilo/command/) |

## Status

v1 is feature-complete enough for end-to-end playtesting: procedural map generation (incl. biome-aware resource placement), hero movement with A* pathfinding, settlements (L1–L3) with capture, per-turn economy (resource accumulation, decay, trade), battle resolution, gold transfer between hero purse and settlement treasury, fog of war (hero vision rings + castle control range), and new/load/save flows are all implemented and covered by the smoke test.

The app now opens to a **home / landing page** (New Game / Load Game / Settings / Sign In) before the canvas is shown; Sign In is an email magic-link flow (short-term: the 6-digit code is also surfaced in dev for testing — real email delivery comes later).

Tactical (manual) combat **is** the adventure-map collision outcome as of 2026-09-27 ([`packages/engine/src/combat/manualBattle.ts`](./packages/engine/src/combat/manualBattle.ts), [`src/screens/combat/arena/`](./src/screens/combat/arena/)): collision → BATTLE phase → `GameActions.maybeAutoResolveBattle()` → battle modal offering **Fight** (the tactical arena, played out with the two heroes' real armies, result submitted back via the `SubmitBattleResult` command and streamed row-by-row to the `battle_actions` table), **Quick Resolve** (the original server auto-resolver, [`packages/engine/src/combat/resolveBattle.ts`](./packages/engine/src/combat/resolveBattle.ts)), or **Flee**. Hero-vs-hero collisions between two human players still quick-resolve (a client only ever plays its own hero's army). See [`docs/battle-view-architecture.md`](./docs/battle-view-architecture.md) for the full flow.

Deferred to later milestones: army upkeep + food, in-settlement mine upgrades beyond Level 1 (mines themselves are live; the schema supports Levels 1–3), real email delivery for sign-in codes.
