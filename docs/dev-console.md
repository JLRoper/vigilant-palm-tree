# Dev Console — Real-time Event Log

A lightweight in-game console that captures and displays game events as they
happen. Useful for debugging turn/move/battle flows without scraping
`console.log` or replaying saves.

The console is built on top of a small event-log module that subscribes to the
existing `core/eventBus` and to `TurnControllerHooks.logEvent` — no engine
changes are required to use it.

---

## 1. Files

| File | Role |
|---|---|
| `src/debug/eventLog.ts` | `EventLog` class + `attachEventLog()` wiring |
| `src/debug/devConsole.ts` | `openDevConsole()` modal + `mountDevConsoleFooter()` sticky bar |
| `src/io/debugCommands.ts` | Exposes `__gameDebug.events` for the browser console |
| `src/managers/GameEngine.ts` | Creates the log in `initGameState` and wraps `turnHooks.logEvent` |

The console lives under `src/debug/` so the production build (`npm run build`)
keeps it. If you want it stripped from production, gate the wiring in
`GameEngine.initGameState` behind a `DEV` flag.

---

## 2. Public API

### `EventLog` (`src/debug/eventLog.ts`)

A ring-buffered, append-only log of game events.

```ts
import { EventLog } from "./debug/eventLog";

const log = new EventLog();
log.setCapacity(1000);

const unsubscribe = log.subscribe((entry) => {
  console.log(entry.ts, entry.source, entry.type, entry.payload);
});

log.getEntries({ limit: 50, source: "bus" });
log.getEntries({ typePrefix: "hero:" });
log.stats();           // { total, capacity, oldestTs, newestTs, bySource, byType }
log.clear();
```

**Entry shape**

```ts
interface LogEntry {
  ts: number;                          // Date.now() at capture
  type: string;                        // e.g. "hero:moved", "move_completed"
  source: "bus" | "hook";              // where it came from
  payload: Record<string, unknown>;
}
```

- `source: "bus"` — captured from `core/eventBus`
- `source: "hook"` — captured from `TurnControllerHooks.logEvent`

**`getEntries(query)` filters**

| Field | Meaning |
|---|---|
| `limit` | Max entries to return (most-recent first). Default = all |
| `typePrefix` | Only entries whose `type` starts with this string |
| `source` | Restrict to `"bus"` or `"hook"` |
| `sinceMs` | Only entries with `ts >= sinceMs` |

### `attachEventLog()` (`src/debug/eventLog.ts`)

Boilerplate-free wiring helper. Subscribes the new log to the event bus and
returns a hook-wrapper that lets you intercept `turnHooks.logEvent` without
editing `turnHooks.ts`.

```ts
import { attachEventLog } from "./debug/eventLog";

const attached = attachEventLog();
const tcHooks   = buildTurnHooks({ /* ... */ });
const wrapped   = attached.wrapHooks(tcHooks);
turnController.setHooks(wrapped);
// later: attached.detach();
```

Returned object:

| Member | Purpose |
|---|---|
| `log: EventLog` | The created log instance |
| `wrapHooks(hooks)` | Returns a copy of `hooks` with `logEvent` intercepted |
| `detach()` | Unsubscribes the bus listeners (does **not** unwrap hooks) |

Default bus subscriptions are listed in `DEFAULT_BUS_EVENT_TYPES` (state,
movement, battle, turn, economy). Pass `{ busEventTypes: [...] }` to override.

### `openDevConsole(log, opts?)` (`src/debug/devConsole.ts`)

Opens a centered modal showing the log live, with controls:

- **type prefix filter** — text input, narrows the visible list
- **source filter** — `all` / `bus` / `hook` dropdown
- **Pause / Resume** — freeze live updates so you can inspect
- **Clear** — wipe the buffer
- **Copy JSON** — copies the currently visible entries to clipboard
- **Pin** — pin the console so it persists on screen (see below)

```ts
import { openDevConsole } from "./debug/devConsole";
const handle = openDevConsole(log, { parent: document.body, width: 800 });
// handle.close()         // dismiss (or hide, if pinned)
// handle.show()          // re-show a hidden pinned console
// handle.hide()          // hide but keep state (only meaningful when pinned)
// handle.isPinned()      // current pin state
// handle.setPinned(true) // toggle programmatically
// handle.togglePin()     // flip and return new state
```

The modal re-renders on every new entry (unless paused) and auto-scrolls to
the bottom.

**`DevConsoleOptions`**

| Field | Default | Meaning |
|---|---|---|
| `parent` | `document.body` | Mount point |
| `title` | `"Dev Console — Event Log"` | Modal title |
| `width` | `720` | Modal width in px |
| `pageSize` | `200` | Max entries rendered per refresh |
| `persistKey` | `"devConsole.state.v1"` | `localStorage` key for pin + filters. Pass `null` to disable persistence |

**Pin / persist behaviour**

When **Pin** is toggled on:

- Clicking the modal's × button **hides** the console instead of destroying it
  (filters, paused state, and modal contents are preserved).
- The console can be re-shown via `handle.show()`, or from the browser console
  via `__gameDebug.console.show()`.
- Pin state plus the current filters (type prefix, source, paused) are saved to
  `localStorage` under `persistKey`.
- On next page load, if pin was on, the console auto-reopens with the same
  filters and paused state — call `mountPersistentDevConsole(log)` once during
  boot to opt into this. The engine does this in `GameEngine.initDebug()`.

To force-destroy a pinned console from code:

```ts
handle.setPinned(false);
handle.close();
```

### `mountPersistentDevConsole(log, opts?)` (`src/debug/devConsole.ts`)

Reads the persisted pin state and, if it was on, opens the console so it
reappears with the same filters. Returns the handle, or `null` if the previous
run was not pinned. Idempotent and safe to call on every boot.

```ts
import { mountPersistentDevConsole } from "./debug/devConsole";
const handle = mountPersistentDevConsole(log);
// handle is null if the console wasn't pinned last run
```

`GameEngine.initDebug()` already calls this, so in normal use you don't need
to.

### `__gameDebug.console` (browser console)

Mirrors the active dev console handle (if any) so you can re-show / unpin from
DevTools:

```js
__gameDebug.console.isOpen;     // true if a console is currently mounted
__gameDebug.console.isPinned;   // current pin state
__gameDebug.console.show();     // re-show a hidden pinned console
__gameDebug.console.hide();     // hide (only meaningful when pinned)
__gameDebug.console.togglePin();// flip pin state, return new value
__gameDebug.console.setPinned(true);
```

### `mountDevConsoleFooter(log, opts?)` (`src/debug/devConsole.ts`)

A minimal sticky bottom bar that shows the last N events (default 5) without
cluttering the screen. Pointer-events disabled so it doesn't intercept clicks.

```ts
import { mountDevConsoleFooter } from "./debug/devConsole";
const footer = mountDevConsoleFooter(log, { maxLines: 3 });
// footer.destroy()
```

### `__gameDebug.events` (browser console)

Available automatically once the engine boots. Equivalent to `EventLog` but
safe to call without an `import`:

```js
__gameDebug.events.available();            // true
__gameDebug.events.getEntries({ limit: 20 });
__gameDebug.events.subscribe((e) => { /* ... */ });
__gameDebug.events.stats();
__gameDebug.events.setCapacity(2000);
__gameDebug.events.clear();
```

All methods are no-ops (or return safe defaults) if the log wasn't attached.

---

## 3. Usage process

### Step 1 — Boot the engine

Nothing to do. `GameEngine.init()` already calls `attachEventLog()` in
`initGameState`, then passes the log to `attachDebugApi()` in `initDebug`. By
the time `requestAnimationFrame` starts, `window.__gameDebug.events` is live
and `state:committed` events are flowing.

### Step 2 — Choose how to view it

Pick one or both:

- **Console (modal)** — for deep inspection:
  ```ts
  import { openDevConsole } from "./debug/devConsole";
  openDevConsole(__gameDebug.eventLog);
  ```
  The Developer Settings menu (`src/views/developerSettingsMenu.ts`)
  exposes a "Dev Console" button that does exactly this against the running
  engine's log.

- **Footer (sticky bar)** — for ambient visibility while playing:
  ```ts
  mountDevConsoleFooter(eventLog, { maxLines: 3 });
  ```

- **Browser DevTools** — fastest for spot checks:
  ```js
  __gameDebug.events.getEntries({ limit: 30 });
  __gameDebug.events.subscribe((e) => console.debug(e));
  ```

### Step 3 — Filter during play

- Type into the prefix filter to follow one event family (e.g. `hero:` to
  watch only movement).
- Use the source dropdown to isolate `bus` events (state-shape changes) from
  `hook` events (server-side persistence calls).

### Step 4 — Diagnose

- **Missed event?** Open the console and inspect `byType` in `stats()`. If
  the type isn't listed, the event isn't being emitted — check the bus
  subscription list (`DEFAULT_BUS_EVENT_TYPES`) or add a hook.
- **Stale state?** Filter by `state:committed` and check the entry rate —
  each entry means a reducer ran but the bus may be missing the per-mutation
  events (see `docs/event-system.md`).
- **Performance check?** `stats().total` over time tells you whether the
  ring buffer is dropping entries (it caps at `capacity`).

### Step 5 — Tearing down

```ts
attached.detach();                // unsubscribes bus
footer.destroy();                 // removes sticky bar
modalHandle.close();              // closes (or hides if pinned)
modalHandle.setPinned(false);     // unpin first if you want a hard close
```

The `EventLog` has no async cleanup — `clear()` wipes the buffer and
`setCapacity` reclaims memory if needed.

---

## 4. Adding new event types

1. Emit from the engine — either via `bus.emit({ type: "...", ... })` or via
   `this.hooks.logEvent({ type: "...", payload: { ... } })` inside
   `TurnController`.
2. If it's a bus event, add the type string to `DEFAULT_BUS_EVENT_TYPES`
   (or pass `busEventTypes` to `attachEventLog()`).
3. No consumer changes needed — the console will start showing it on the
   next refresh.

---

## 5. Test surface

Pure functions, easy to unit-test:

```ts
import { EventLog } from "./debug/eventLog";
const log = new EventLog();
log.setCapacity(3);
log.record("a", "bus");
log.record("b", "hook");
log.record("c", "bus");
log.record("d", "hook");
log.size();                         // 3 (oldest dropped)
log.getEntries({ source: "bus" });  // ["a", "c"] but only "c" remains after wrap-around
```

Add tests under `test/debug/eventLog.test.ts` (mirror the existing
`test/state/`, `test/combat/` layout).
