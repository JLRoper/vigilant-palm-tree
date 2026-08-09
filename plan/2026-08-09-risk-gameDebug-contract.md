# Plan: Formalize the `window.__gameDebug` contract

**Source risk:** `docs/architecture.md` line 128 — *`window.__gameDebug` in `main.ts` references many internals; after refactor it must keep working because the smoke test may read it.*
**Status:** Still a risk. The contract has changed shape and grown.

## Current state (verified against latest build)

- `__gameDebug` is attached by `src/io/debugCommands.ts:attachDebugApi(engine)` (`src/io/debugCommands.ts:44`), called from `src/managers/GameEngine.ts:175` (inside `initDebug`).
- The full surface (defined in `src/io/debugCommands.ts`) currently includes (non-exhaustive):
  - `getState`, `getGameState`, `getTurnController`, `endTurn`, `setSelectedHero`
  - `requestMove`, `teleportHero`, `captureSettlement`, `getSettlements`, `getHeroes`
  - `activeGameName`, `getMap`, `getCamera`
  - `settings` (with `.update`)
  - `events` (subscribe / getEntries / stats / clear / setCapacity / available)
  - `console` (show / hide / togglePin / setPinned / isOpen / isPinned)
  - `eventLog`
- Consumers (verified):
  - `test/smoke.ts:159, 212, 285, 431, 460`
  - `test/cityView.test.ts:113, 120, 127, 132, 137, 150, 311, 357, 370, 382, 392, 401, 417, 427, 467`
  - `test/dragDrop.test.ts:153, 163, 167`
  - `test/proposedPath.test.ts:79, 87, 91, 106, 129`
  - `src/views/developerSettingsMenu.ts:174, 176` (reads `__gameDebug.eventLog` for the dev console)
  - `docs/dev-console.md` (the only formal doc reference)
- The shape is duplicated informally across:
  - Inline `window as unknown as { __gameDebug?: { ... } }` casts in 4 test files.
  - No central type definition for the surface.
  - No deprecation / removal story.

**Net assessment:** The original risk ("must keep working after refactor") was met — it kept working — but the surface has grown well past what the architecture doc described. The risk now is: any rename of a callback on `attachDebugApi`'s engine interface silently breaks tests in four files with no compile-time or type-time error, because every consumer is untyped (`as any` / `as unknown as { __gameDebug?: ... }`).

## Goal

Make the `__gameDebug` contract:
1. Discoverable — one TS interface defines the full surface.
2. Type-safe — consumers type their reads against that interface.
3. Tested — a tiny contract test pins the surface so renames break the build, not production.
4. Documented — the existing `docs/dev-console.md` becomes the single source of truth.

## Plan

### 1. Export a `GameDebugApi` interface from `src/io/debugCommands.ts`

- Define `export interface GameDebugApi { ... }` listing every property currently attached at `src/io/debugCommands.ts:45`.
- Type the field as `(window as unknown as { __gameDebug?: GameDebugApi })`.
- Re-export from `docs/module-documentation-and-relationships.md` summary so consumers can `import type { GameDebugApi } from "../io/debugCommands"`.

### 2. Replace every `as any` / inline-cast consumer with the interface

Files to update (no behavior change):
- `test/smoke.ts` (5 sites)
- `test/cityView.test.ts` (~14 sites)
- `test/dragDrop.test.ts` (~3 sites)
- `test/proposedPath.test.ts` (~5 sites)
- `src/views/developerSettingsMenu.ts:174-176`

Each becomes:

```ts
import type { GameDebugApi } from "../io/debugCommands";
const dbg = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
```

### 3. Add a contract test

Create `test/debugContract.test.ts` (or extend `test/smoke.ts` if simpler) that:
- Boots the dev server (or the smoke harness).
- Asserts `typeof window.__gameDebug === "object"`.
- Asserts the presence of each documented method (`endTurn`, `requestMove`, `teleportHero`, `captureSettlement`, `getGameState`, `settings.update`, `events.subscribe`, `console.togglePin`, `eventLog`).
- Asserts no extra undeclared keys beyond the interface (loose check via `Object.keys`).

This pins the surface. Any future rename in `attachDebugApi` will break the test.

### 4. Document the surface in `docs/dev-console.md`

- Add a "Stable surface" subsection listing every property + a 1-line description and a stability note ("Public to the in-browser dev console and to e2e tests; changes require updating `test/debugContract.test.ts`").
- Cross-link from `docs/architecture.md` line 128 to `docs/dev-console.md`.

### 5. Deprecate the loose `as any` casts (lint)

Add an ESLint rule (or a `rg`-based check in `precommit-checker`) that fails if `window.__gameDebug` appears outside `src/io/debugCommands.ts` without going through the `GameDebugApi` type.

## Validation

- `npm run build` passes.
- `npm run test:all` passes (smoke + multiplayer.smoke + cityView + new debugContract).
- `precommit-checker` exits 0.
- Manually: rename `endTurn` → `nextTurn` in `attachDebugApi` and confirm `test/debugContract.test.ts` fails (revert before commit).

## Out of scope

- Changing the surface itself (no removal/rename of existing properties).
- Exposing `__gameDebug` to multiplayer peers (it remains browser-local).
- Type-safe RPC over the debug API.
