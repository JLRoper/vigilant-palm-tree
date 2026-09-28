# Minimap field-of-view indicator + drag-to-pan

**Date:** 2026-08-18
**Status:** Planned, not yet implemented — this doc is a handoff for whoever picks up the linked issue.

## Problem

On a large map (48×36), the minimap ([src/render/minimap.ts](../src/render/minimap.ts)) gives no
indication of where the main camera's viewport currently is. There's no "you are here" marker, so
at a glance the player can't tell which part of the minimap corresponds to what's on screen.

Confirmed by loading a fresh Large game locally and reading through the render/interaction code —
`drawMinimap` draws terrain, resources, the pending path, and hero-owner squares, but nothing
representing the main camera's visible region.

## Current architecture (read this before touching anything)

- **Two independent cameras.** The main game view is [`Camera`](../src/render/camera.ts) (`x`, `y`,
  `zoom`, pans in CSS-pixel space). The minimap has its own
  [`MinimapCamera`](../src/render/minimapCamera.ts) (`panQ`, `panR`, `zoom`, `rotation`, in hex/axial
  space) — panning, zooming, or rotating the minimap's own view does **not** touch the main camera.
- **Minimap geometry.** [`getMinimapGeometry(map)`](../src/render/minimap.ts:30) computes the fixed
  180px-wide box anchored bottom-right, recomputed every frame from `window.innerWidth/innerHeight`
  (so it moves if the window resizes, not because it's stored state).
- **Minimap drawing.** [`drawMinimap`](../src/render/minimap.ts:129) clips to the minimap box, then
  opens a `ctx.save()/translate()/rotate()/translate()` block (lines 152–155) so everything drawn
  inside it — terrain cells, resource dots, the path, hero squares — automatically inherits the
  minimap camera's rotation around the box's center. That block is closed at line 213, after which
  the box border and the north indicator are drawn in unrotated screen space.
- **Existing minimap interaction**, all in
  [`src/screens/adventure/adventureView.ts`](../src/screens/adventure/adventureView.ts):
  - Plain click on the minimap → jumps the **main** camera to that point
    (`centerOn(world.q, world.r)`, called from `onClick` at line 434 and `onTouchEnd` at line 284,
    where `world` comes from `minimapCamera.screenToWorld`).
  - Mouse-drag or single-finger drag on the minimap → pans the **minimap's own** camera
    (`minimapCamera.panBy`, `onMouseMove` line 319, `onTouchMove` line 253).
  - Wheel or two-finger pinch on the minimap → zooms/rotates the **minimap's own** camera
    (`onWheel` line 718, `onTouchMove` pinch branch line 273).
  - `isPointInMinimap` / `getMinimapGeometry` are the shared hit-test helpers used everywhere above.
- **Hex↔pixel math** lives in [`src/core/hex.ts`](../src/core/hex.ts): `axialToPixel` and
  `pixelToAxial` (the latter **rounds** to the nearest hex via `axialRound` — see gotcha below).
  `Camera`'s screen↔world conversion (used e.g. by `MapRenderer.hoverFromScreen` in
  [renderer.ts:80](../src/render/renderer.ts:80)) is CSS-pixel space, ignoring `dpr`, because
  `camera.x/y` are set in CSS-pixel terms by `centerOn` (`adventureView.ts:726`).

## What to build

### 1. Compute the main camera's visible region in hex space

Add a helper that inverse-projects the four screen corners of the viewport
(`(0,0)`–`(window.innerWidth, window.innerHeight)`) through the main `Camera` into world-pixel
space (same formula as `MapRenderer.hoverFromScreen`: `wx = (sx - camera.x) / camera.zoom`), then
into **unrounded** axial coordinates.

**Gotcha:** `pixelToAxial` in `hex.ts` rounds to the nearest hex via `axialRound`. Reusing it as-is
will make the frame's corners snap discretely as the camera moves, instead of tracking smoothly.
Add a `pixelToAxialExact` (or similarly named) variant that does the same `q`/`r` formula but skips
the rounding step, and use that here. Don't change `pixelToAxial` itself — it's used elsewhere
(e.g. hover/click hex picking) where rounding to a concrete hex is the correct behavior.

### 2. Draw the frame on the minimap

In `drawMinimap`, **inside** the existing rotated block (lines 152–155, before the `ctx.restore()`
at line 213) — this makes the frame automatically inherit the minimap camera's own pan/zoom/rotation
for free, consistent with how heroes and terrain are drawn. Map the 4 axial corners through
`minimapCamera.worldToScreen(q, r, geo)` and stroke the resulting quadrilateral.

Note this will render as a **parallelogram, not an axis-aligned rectangle** — `axialToPixel` is a
skewed linear transform (`x = size*(√3*q + √3/2*r)`, `y = size*1.5*r`), so a rectangle in main-camera
pixel space maps to a parallelogram in axial/minimap space. This is expected and matches how
HOMM-style hex minimaps typically render the viewport frame; don't try to force it back to a
rectangle.

Suggested styling: bright stroke (the north indicator already uses `#ffcc00` at
[minimap.ts:61](../src/render/minimap.ts:61) — reuse that for visual consistency) plus a low-alpha
fill, distinct enough from the hero-owner-colored squares and the fog/mist overlay not to be
confused with either.

### 3. Make the frame draggable (main camera pans, not the minimap's own camera)

This adds a **third** minimap-drag mode alongside the two that already exist. On
`mousedown`/`touchstart` inside the minimap box, hit-test the point against the frame's polygon
(point-in-quadrilateral test) *before* falling into the existing "drag pans the minimap's own
camera" branch:

- **Inside the frame:** track drag deltas in minimap-screen space; convert each delta through
  `minimapCamera.screenToWorld` to get a hex-space delta, then apply that delta to the **main**
  camera (via `centerOn`, or by nudging `camera.x/y` directly through `axialToPixel`) on every
  `mousemove`/`touchmove`. This must be a relative grab-and-drag — don't snap the main camera to
  the cursor position on `mousedown`, or grabbing an edge of the frame will yank the view sideways.
- **Outside the frame, inside the minimap box:** unchanged — drags the minimap's own camera
  (existing `minimapCamera.panBy` behavior).
- **Plain click, no movement, anywhere in the minimap (including on the frame):** unchanged —
  still jumps the main camera to that point via `centerOn`. No conflict with frame-dragging: a
  zero-movement click on the frame just re-centers on roughly where the frame already is.
- Mirror this in `onTouchStart`/`onTouchMove`/`onTouchEnd` alongside the existing single-finger
  tap/pan and two-finger pinch/rotate modes — currently `minimapTouch.mode` is `"tap"` or
  `"gesture"` (`adventureView.ts` around line 194); this needs a third mode, e.g. `"frameDrag"`.

### 4. Edge cases

- **No new clamping.** Neither `centerOn` nor `camera.x/y` are clamped to map bounds today (you can
  already click-navigate to an edge tile and see empty space past it) — frame-dragging should behave
  the same way for consistency; don't add clamping here as a side quest.
- **Frame exceeds the minimap box.** At low main-camera zoom on a small map, the computed frame
  polygon can extend past the minimap's edges. The existing `ctx.clip()` at the top of `drawMinimap`
  (lines 145–147) already clips everything drawn afterward, so this should be handled for free —
  just confirm it visually rather than assuming.
- **Rotated minimap.** Since the frame is drawn inside the same rotated `ctx` block as everything
  else, it should visually track minimap rotation correctly. Hit-testing for drag, however, happens
  in **unrotated** mouse-event screen space — the frame's polygon points must be computed the same
  way `screenToWorld`/`worldToScreen` already account for rotation (see `MinimapCamera.screenToWorld`,
  which un-rotates before converting) so hit-testing and drawing agree on where the frame actually is
  on screen.

## Testing

Add cases to [test/minimap.test.ts](../test/minimap.test.ts) (currently a single assertion on
`MinimapCamera.panBy` clamping, run headlessly with no DOM/canvas) for:
- The point-in-quadrilateral hit test as a pure function.
- The axial-corner projection math (`pixelToAxialExact` + the viewport-bounds helper), independent
  of canvas drawing.

## Files touched

- `src/core/hex.ts` — new unrounded pixel→axial helper.
- `src/render/camera.ts` and/or `src/render/minimap.ts` — viewport-bounds computation + frame
  drawing.
- `src/screens/adventure/adventureView.ts` — drag hit-testing / new drag-mode state machine for
  both mouse and touch input.
- `test/minimap.test.ts` — new unit tests for the pure geometry/hit-test helpers.

## Out of scope

- Changing how the minimap's own camera (pan/zoom/rotate) works — that system is untouched.
- Clamping main-camera panning to map bounds — not currently done anywhere, not part of this issue.
- Any change to click-to-jump behavior — it stays exactly as it is today.
