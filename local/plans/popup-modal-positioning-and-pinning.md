# Plan: fix popup positioning, add move/collapse/pin

## Context

Clicking a hero, village, or castle opens an info popup built on the shared `PopupMenu` class (`src/views/menu.ts:75-243`). There are really only two popup *types* involved, not three: `HeroInfoMenu` (`src/views/heroInfoMenu.ts`) handles heroes, and `SettlementInfoMenu` (`src/views/settlementInfoMenu.ts`) handles both villages and castles — a castle is just a `SettlementState` at a higher `CastleLevel` (`settlementInfoMenu.ts:288`), rendered by the same popup with a different banner image.

### Root cause of "opens randomly / off screen"

Both popups are constructed **once at app startup** (`UIManager.initHeroMenu`/`initSettlementInfo`) with a position computed at construction time and never recomputed:

- `heroInfoMenu.ts:85` — `initialPosition: { x: 16, y: Math.max(24, window.innerHeight - 280) }` (bottom-left, not top-right)
- `settlementInfoMenu.ts:69` — `initialPosition: { x: 16, y: Math.max(24, window.innerHeight - 420) }` (bottom-left)

`show()` (`heroInfoMenu.ts:455`) only toggles `display`; it never touches position. So the position is whatever `window.innerHeight` happened to be the moment the app booted, or wherever the user last dragged it. Two things break it further:

1. **No resize handling.** `GameEngine.ts:417` `handleResize()` only resizes the canvas — no code re-clamps any `PopupMenu` to the current viewport. Resize the window after the popup's position was set for a taller/wider one, and it can end up partially or fully off-screen.
2. **Drag only clamps the minimum, not the maximum.** `PopupMenu.attachDrag()` (`menu.ts:228-229`) does `Math.max(0, ...)` on both axes but never clamps against `window.innerWidth/innerHeight`, so a user can drag the popup off the right/bottom edge, and that off-screen position is exactly what gets reused next time `show()` is called.

This isn't literally "random" — it's a stale, unclamped coordinate — but it reads as random because it depends on window size history and past drags. Contrast with City View's `BuildingMenu.show()` (`buildingMenu.ts:92-96`), which already does the right thing: clamps both min and max against current window size, computed fresh on every `show()` call. That's the pattern this plan generalizes into `PopupMenu` itself.

## Goals

1. Popups always open fully on-screen, regardless of past window size or drag history.
2. Default open position: top-right corner of the screen.
3. Still movable (drag already exists) — but properly clamped to viewport bounds while dragging.
4. Collapsible — generalize the ad-hoc collapse pattern already in `HeroInfoMenu` (`armyExpanded`/`armyChevron`, `heroInfoMenu.ts:516-527`) into the shared header, collapsing the whole popup body rather than just the army section.
5. Pinnable — when pinned, reopening that popup type restores the exact position + collapsed/expanded state from last time. When unpinned, it always reopens at its default position, uncollapsed.
6. Background is ~20% see-through (80% opaque) so it doesn't fully obscure the map/city view behind it, without dimming the text/icons inside it.
7. Open question: should hero vs. settlement popups get different default corners? See below.

## Design

### 1. Generalize `PopupMenu` (`src/views/menu.ts`)

Add to `PopupMenuOptions`:
```ts
popupKey?: string;        // stable id for layout persistence, e.g. "hero-info", "settlement-info"
collapsible?: boolean;    // adds a collapse chevron to the header
pinnable?: boolean;       // adds a pin toggle to the header
translucent?: boolean;    // apply the "20% see-through" background treatment
```

Changes to `PopupMenu`:
- **Viewport-aware positioning.** Add `clampToViewport()`, called from a new `show()`-adjacent flow (see §3) and wired into a single shared `window.addEventListener("resize", ...)` that re-clamps every live `PopupMenu` instance (track instances in a module-level `Set<PopupMenu>`, added on construct, removed on `close()`). This fixes the "shrink the window and the popup is stranded off-screen" case, not just the "opens off-screen" case.
- **Fix drag clamping** (`menu.ts:228-229`) to clamp against the *max* as well as the min:
  ```ts
  const x = Math.max(0, Math.min(ev.clientX - this.dragOffset.dx, window.innerWidth - rect.width));
  const y = Math.max(0, Math.min(ev.clientY - this.dragOffset.dy, window.innerHeight - rect.height));
  ```
- **Collapse.** When `collapsible`, add a chevron button next to the close button. Toggling sets `body.style.display = "none"` / `""` and shrinks `root` to header-only height. Expose `setCollapsed(v: boolean)` / `isCollapsed()`. This replaces the need for `HeroInfoMenu`'s bespoke `armyExpanded` state managing the *whole popup* — `armyExpanded` itself stays as-is, since that's a different, narrower collapse (just the army sub-list), not the one this plan adds.
- **Pin.** When `pinnable`, add a 📌 toggle button in the header. Expose `setPinned(v: boolean)` / `isPinned()`. Pin state and current position/collapsed state are written to the layout store (§2) on every change (drag end, collapse toggle, pin toggle) and on `close()`, but **only persisted if `pinned === true`**.
- **Translucent background.** When `translucent`, apply the panel/header backgrounds as `rgba(...)` instead of the solid hex in `menuTheme`, at alpha `0.8` (see §4), instead of setting `root.style.opacity` — a plain `opacity` would also fade the text/icons/buttons inside, hurting readability. Only the background layer becomes see-through; foreground content stays fully opaque.

This keeps `PopupMenu` fully backward-compatible — every new behavior is opt-in per option, so `confirmDialog.ts`, `tradeModal.ts`, `battleModal.ts`, `buildingMenu.ts`, etc. are unaffected unless they explicitly opt in.

### 2. New layout persistence module: `src/state/popupLayout.ts`

Modeled directly on the existing `src/state/settings.ts` localStorage pattern:

```ts
export interface PopupLayoutEntry {
  x: number;
  y: number;
  collapsed: boolean;
  pinned: boolean;
}

const STORAGE_KEY = "heroesJs.popupLayout";

export function getPopupLayout(key: string): PopupLayoutEntry | undefined;
export function savePopupLayout(key: string, entry: PopupLayoutEntry): void;
```

- Backed by a `Record<string, PopupLayoutEntry>` in `localStorage`, load-once/save-on-change, wrapped in try/catch exactly like `settings.ts:169-174` and `:201-227`.
- This is a UI preference, not game state — it does not go through `GameState`/save-game serialization, matching how `settings.ts` is already kept separate from saves.
- Keyed by `popupKey` (a string), not by hero/settlement id — pinning "the hero popup" pins the popup's chrome (position/collapsed), not a specific hero's popup.

### 3. Positioning flow on `show()`

Each popup (`HeroInfoMenu`, `SettlementInfoMenu`) changes its `show()` method to, in order:
1. Look up `getPopupLayout(popupKey)`.
2. If an entry exists **and** `entry.pinned`, call `this.menu.setPosition(entry.x, entry.y)` and `this.menu.setCollapsed(entry.collapsed)`.
3. Otherwise, compute the type's default corner position fresh (using current `window.innerWidth/innerHeight`, not a value cached at construction) and expand.
4. Either way, call `clampToViewport()` as a final safety net before making it visible.

This removes the constructor-time `initialPosition` entirely (`heroInfoMenu.ts:85`, `settlementInfoMenu.ts:69`) — position is now always computed at show-time, which alone fixes the stale-coordinate bug even before pinning is considered.

### 4. Translucency: how see-through, and how it's implemented

You floated 20% see-through — recommend keeping that (`alpha = 0.8` on the background layers), it's a reasonable middle ground: enough to see map/city context behind the popup, not so much that text loses contrast against a busy background. `menuTheme.panel.background` (`#1a1a1a`) and `.headerBackground` (`#0e0e0e`) become `rgba(26,26,26,0.8)` / `rgba(14,14,14,0.85)` (header slightly more opaque so the title/buttons stay easiest to read) when `translucent` is set. Add these as named constants near `menuTheme` rather than hardcoding the rgba conversion inline.

Scope: apply `translucent: true` only to `HeroInfoMenu` and `SettlementInfoMenu` — not to `confirmDialog`, `tradeModal`, `battleModal`, or `openCenteredModal`-based dialogs, since those are blocking decisions where full legibility/contrast matters more than seeing behind them. If you'd like it applied more broadly later, that's a one-line change per popup once `translucent` exists on `PopupMenu`.

### 5. Wiring changes

- `heroInfoMenu.ts`: drop the hardcoded `initialPosition` (line 85); pass `popupKey: "hero-info"`, `collapsible: true`, `pinnable: true`, `translucent: true`. Update `show()` per §3.
- `settlementInfoMenu.ts`: same, `popupKey: "settlement-info"` (pending the open question below).
- `UIManager.ts` (`initHeroMenu`/`initSettlementInfo`, lines ~100-131): no structural change — popups are still constructed once at startup — but no longer pass a position at construction time.

## Open questions

### A. Should hero and settlement popups have different default corners?

**Recommendation: no — give both the same top-right default**, at least for v1. Reasoning: `selectSettlement` clears `selectedHeroId` (`gameState.ts:319`), so in the normal flow only one of the two popups is ever open at a time — they don't need to avoid overlapping each other. One consistent "popups open top-right" rule is also simpler to explain/predict than remembering "hero goes top-left, castle goes top-right." If you later add more simultaneous popups (e.g. a platoon info popup alongside a settlement popup) and they start colliding, that's the point to differentiate corners — not preemptively now.

Worth flagging a small pre-existing inconsistency I found while checking this: `selectHero` (`gameState.ts:299-309`) does *not* clear `selectedSettlementId` the way `selectSettlement` clears `selectedHeroId`. In practice this likely doesn't surface a bug today (probably nothing else reads settlement-selected while a hero is being selected), but if you want both popups strictly mutually exclusive, that's a one-line fix outside the scope of this plan — flagging it here so it's not forgotten.

### B. Should "castle" get its own `popupKey` distinct from "village"?

**Recommendation: no — keep one `popupKey: "settlement-info"`** for both, since it's the same `SettlementInfoMenu` instance either way (constructed once, reused for every settlement regardless of level). Splitting the key would only matter if you wanted castles and villages to remember *different* pinned positions/collapse states from each other — which doesn't match "pin this popup type" as you described it. If that granularity turns out to matter later, it's a small change (key by `` `settlement-info:${level >= castleThreshold ? "castle" : "village"}` ``).

### C. Is 20% the right transparency level?

Went with your number (80% opaque). If it turns out to fight with the hero/settlement banner images or long stat lists (busy popup content over a busy map background can get hard to read), an easy fallback is to only make the **header** translucent and keep the **body** solid — most of the "see the map behind it" value comes from the corners/edges anyway. Flagging as a fast tweak, not a redesign, if the first pass looks too noisy.

## Out of scope

- Z-index cleanup. There's no centralized z-index scale today (values are informally ordered per-file, `menu.ts` comment at line 259 references one such ordering) — this plan doesn't touch it since it isn't the source of the reported bug.
- Applying collapse/pin/translucency to other `PopupMenu` consumers (`buildingMenu.ts`, `platoonInfoPopup.ts`, roster menus, etc.) — only the hero and settlement info popups are in scope, since those are the ones named in the bug report. The `PopupMenu` changes are additive/opt-in so extending this to other popups later is cheap.
- Fixing the `selectHero`/`selectSettlement` mutual-exclusivity inconsistency noted in Open Question A — flagged, not fixed, here.
- Persisting popup layout inside game saves — this is a local UI preference (localStorage), not game state.

## Verification

1. `npm run build` — tsc + vite build clean.
2. Manual check in dev: click a hero — popup opens top-right, fully on-screen. Click a village, then a castle — same. Resize the browser window smaller while a popup is open — it stays fully on-screen (re-clamped). Drag a popup to the far bottom-right corner — it stops at the edge instead of sliding off.
3. Collapse a popup, close it, reopen the same type unpinned — reopens expanded at the default position (collapse/position not remembered). Pin it, collapse it, drag it elsewhere, close it, reopen — reopens exactly where left, still collapsed. Unpin it, close, reopen — back to default top-right, expanded.
4. Visually confirm the translucent background lets map/city content show through at the corners while text/buttons inside the popup stay fully legible.
