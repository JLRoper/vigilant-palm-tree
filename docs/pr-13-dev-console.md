# PR #13 — Dev Console: real-time event log with pin/persist

- **Repo:** `Millerfly91/vigilant-palm-tree`
- **PR:** https://github.com/Millerfly91/vigilant-palm-tree/pull/13
- **Branch:** `feature/dev-console-realtime-events` → `main`
- **Status:** Merged
- **Merge commit:** see `main` history
- **Commits (oldest → newest):**
  1. `8923c28` — feat: Implement dev console with event logging and persistence features
  2. `38d59ce` — test(cityView): pin home-view load selector to avoid hidden toolbar match
  3. `606b214` — Revert "feat(devConsole): float + translucent pinned panel with body-drag"

---

## Summary

Adds a new `src/debug/` module that surfaces the existing event bus and
turn-hook traffic in an in-game console. No engine changes are required to
use it; everything hooks through the existing `core/eventBus` and
`TurnControllerHooks.logEvent`.

A follow-up enhancement to make the pinned console float (transparent
backdrop, translucent panel, body-drag) was prototyped on this branch but
reverted before merge — that work is captured in commit history but not
part of the shipped code.

## What's included

- **`EventLog`** (`src/debug/eventLog.ts`) — ring-buffered log with
  `subscribe`, `getEntries` (`limit` / `typePrefix` / `source` / `sinceMs`),
  `stats`, and `clear`. `attachEventLog()` wires the log to the bus +
  turn-hook and returns a `wrapHooks()` helper so consumers don't need to
  edit `turnHooks.ts`.
- **`openDevConsole(log, opts)`** (`src/debug/devConsole.ts`) — draggable
  centered modal with: type-prefix filter, source dropdown (`all`/`bus`/
  `hook`), Pause / Resume, Clear, Copy JSON, and **Pin**.
- **`mountDevConsoleFooter(log, opts)`** — sticky bottom bar that shows
  the last N events without intercepting clicks.
- **`mountPersistentDevConsole(log, opts)`** — reads the persisted pin
  state on boot and re-opens the console with the same filters if it was
  pinned last run.
- **`__gameDebug.console`** — DevTools API (`isOpen`, `isPinned`, `show`,
  `hide`, `togglePin`, `setPinned`) so you can re-show a hidden pinned
  console without leaving DevTools.

## Pin / persist behaviour

When the user clicks **Pin**:

- The × button on the modal hides the console instead of destroying it
  (filters, paused state, and contents are preserved).
- `handle.show()` / `__gameDebug.console.show()` re-displays the console.
- Pin state + type prefix + source filter + paused state are persisted
  to `localStorage` under `devConsole.state.v1` (configurable via
  `DevConsoleOptions.persistKey`; pass `null` to disable).
- On next boot, `GameEngine.initDebug()` calls
  `mountPersistentDevConsole(eventLog)` which auto-reopens the console
  with the same filters if it was pinned.

To force-destroy a pinned console from code:

```ts
handle.setPinned(false);
handle.close();
```

## Wiring

- `GameEngine.initGameState()` runs `attachEventLog()` and stores the log
  on the engine.
- `GameEngine.initDebug()` runs `mountPersistentDevConsole()` and stores
  the handle; `attachDebugApi()` exposes both via `__gameDebug.events`
  and `__gameDebug.console`.
- The Developer Settings menu gets a new "Dev Console" button that opens
  the console against `__gameDebug.eventLog`.
- `attachDebugApi()` also exposes the log under
  `__gameDebug.events.{available, subscribe, getEntries, clear, stats,
  setCapacity}` for spot checks from the browser console.

## Test fix (in this PR)

The `test/cityView.test.ts` splash-load step used
`button:hasText("Load") + .first()`. Playwright's DOM-order match
resolved to the toolbar's hidden dropdown `📂 Load` button rather than
the home view's visible `Load Game` button, so the click silently timed
out and the rest of the suite never ran. Fixed by pinning the selector to
the exact `Load Game` text on the home overlay and only clicking `Open`
when at least one visible button matches.

## Tests

- `npm run build` clean (1 non-fatal Vite dynamic-import warning for
  `src/map/gameMap.ts` reused across entry points — cosmetic, not
  blocking).
- `npm run test:all` clean — smoke, multiplayer.smoke, and cityView all
  pass.

## Files

| Change | File |
| --- | --- |
| New | `src/debug/eventLog.ts`, `src/debug/devConsole.ts` |
| Updated | `src/managers/GameEngine.ts`, `src/io/debugCommands.ts`, `src/views/developerSettingsMenu.ts`, `src/views/homeView.ts`, `src/views/manualBattleArena.ts`, `src/io/api.ts`, `docs/dev-console.md`, `docs/event-system.md`, `docs/module-documentation-and-relationships.md`, `docs/README.md` |
| Test fix | `test/cityView.test.ts` |
| Tracking | `sessionTracking/2026-08-02.md`, `sessionTracking/2026-08-03.md` |

## Reviewer notes

- The console lives under `src/debug/` so production builds
  (`npm run build`) keep it. If you want it stripped from production,
  gate `attachEventLog()` in `GameEngine.initGameState` behind a `DEV`
  flag — this PR does not add that gate.
- `EventLog` has no async cleanup. `clear()` wipes the buffer;
  `setCapacity` reclaims memory if you want to tighten the ring after
  debugging.
- `mountDevConsoleFooter()` uses `pointer-events: none` so it doesn't
  intercept canvas clicks.
- The `homeView.ts` delete-game feature and load-row refactor were
  bundled into `8923c28` for atomic review; they're isolated changes but
  ship in the same commit.
