# Heroes JS

A turn-based, hex-grid adventure game inspired by *Heroes of Might & Magic*. Move a hero across a procedurally generated hex map, claim resource tiles by building settlements on them, accumulate resources per turn, and defend them against enemy heroes.

## Quick start

```
npm install
npm run dev      # start the client + API server (concurrently)
npm test         # run the smoke test
```

`npm test` boots the API and a headless browser, plays through movement / capture / battle / transfer / trade / economy flows, and asserts on the resulting state and HUD.

## Documentation

| If you want to know about… | Read |
|---|---|
| The tech stack, build setup, repo shape, languages | [TECHNICAL_SPECIFICATIONS.MD](./TECHNICAL_SPECIFICATIONS.MD) |
| Game design — resources, settlements, heroes, economy, map, art | [docs/README.md](./docs/README.md) |
| The TypeScript module layout under `src/` | [docs/architecture.md](./docs/architecture.md) |
| Front-end rendering performance TODOs | [docs/TODO-front-end-efficiency.md](./docs/TODO-front-end-efficiency.md) |

## Status

v1 is feature-complete enough for end-to-end playtesting: procedural map generation (incl. biome-aware resource placement), hero movement with A* pathfinding, settlements (L1–L3) with capture, per-turn economy (resource accumulation, decay, trade), battle resolution, gold transfer between hero purse and settlement treasury, and new/load/save flows are all implemented and covered by the smoke test.

Deferred to later milestones: tactical combat (auto-resolve only today), army upkeep + food, fog of war, in-settlement mines (city view exists but mines aren't yet placed).
