# Plan: Bound modal height to the viewport, then page the Settings menu

**Source issue:** Settings modal content runs off the bottom of the screen with no way to reach it.
**Status:** Stage A implemented and verified in the running app. Stage B not started.

> **Correction to A3 below: the `ResizeObserver` approach does not work and was not shipped.**
> Once the panel reaches its `max-height`, further content growth is absorbed by the
> scrolling body and `root`'s box stops changing size, so an observer on it never fires
> (measured: **0 callbacks** across a full collapse/expand cycle). Positioning is instead
> left to the wrapper's existing flexbox, which re-centres on content growth and window
> resize with no JS at all. See **"Stage A as built"** at the end of this document.

## Current state (verified live at `http://localhost:5190/`)

Reproduced by opening Settings in-game and expanding the **Visual** section:

| Measurement | Value |
|---|---|
| Viewport height | 691px |
| Modal content height | 1006px |
| Wrapper `overflow-y` | `visible` |
| `document.body.scrollHeight` | 691px (equal to viewport — page does not scroll) |
| Unreachable content | ~315px |

The overflow is **not** clipped-but-scrollable. Nothing scrolls at any level: not the body, not the fixed wrapper, not the panel. The content is simply unreachable.

### Root cause

`openCenteredModal` (`src/views/menu.ts:245`) builds a fixed full-viewport wrapper that flex-centers its child, then immediately overrides that centering:

```ts
const initialLeft = (window.innerWidth - width) / 2;
const initialTop = Math.max(24, (window.innerHeight - 240) / 2);
menu.setPosition(initialLeft, initialTop);
```

Three compounding defects:

1. **Hardcoded 240px height assumption** (`menu.ts:271`). Every modal is positioned as if it were 240px tall. Settings is ~1000px. The panel anchors near vertical centre and grows downward from there.
2. **`setPosition` writes `position: absolute` + `left`/`top`** (`menu.ts:192-196`), which defeats the wrapper's `align-items: center`. The flex centering that would have self-corrected never applies.
3. **`PopupMenu.body` (`menu.ts:154`) sets no `max-height` and no `overflow`.** Nothing clips and nothing scrolls, so the panel grows unbounded past the viewport edge.

Compounding factor in Settings specifically: `makeFoldableSection` (`src/views/settingsMenu.ts:65`) gives each of the 5 sections an independent toggle, so all five can be open at once. Height is unbounded by design.

### Blast radius

This is a shared-helper defect, not a Settings defect. **15 call sites** use `openCenteredModal`:

| File | Modal | Width |
|---|---|---|
| `src/views/assetManager.ts:11` | Asset Manager | 720 |
| `src/views/testBattleSetup.ts:40` | Test Battle Setup | 480 |
| `src/views/developerSettingsMenu.ts:9` | Developer Settings | 480 |
| `src/views/battleResultCard.ts:74` | Battle Results | 480 |
| `src/views/multiplayerLobby.ts:56` | Multiplayer Lobby | 460 |
| `src/views/settingsMenu.ts:132` | Settings | 420 |
| `src/views/homeView.ts:284`, `toolbar.ts:670` | Load Game | 420 |
| `src/views/toolbar.ts:562` | New Game | 400 |
| `src/views/homeView.ts:438` | Sign In | 380 |
| `src/views/tradeModal.ts:25` | Trade | 380 |
| `src/views/settlementInfoMenu.ts:458` | Recruit Hero | 340 |
| `src/views/adventureView.ts:621` | Charter Settlement | 320 |
| `src/views/battleModal.ts:12` | Battle! | 320 |
| `src/debug/devConsole.ts:70` | Dev Console | (caller-supplied) |

Settings is simply the first to grow tall enough to expose it.

### Related defect found while reading

`attachDrag` (`menu.ts:228-229`) clamps drag position with `Math.max(0, …)` only — no upper bound. A draggable modal can be dragged off the right or bottom edge and become unreachable, independent of the height bug.

## Goal

Make it structurally impossible for any modal to render content outside the viewport, then reduce the Settings menu's height pressure at the source.

Two stages, deliberately ordered: Stage A is the safety net and stands alone; Stage B is a UX improvement layered on top, not a substitute.

---

## Stage A — bound the shared modal (`src/views/menu.ts`)

Single file. Fixes the visible bug and 14 latent ones.

### A1. Make the panel a bounded flex column

In the `PopupMenu` constructor:

- `root` (line 92): add `display: flex`, `flexDirection: column`, `maxHeight: calc(100vh - 48px)`
- `header` (line 114): add `flexShrink: 0` — keeps the title and close button pinned while content scrolls
- `body` (line 154): add `overflowY: auto`, `minHeight: 0`, `overscrollBehavior: contain`

Two non-obvious details:

- **`minHeight: 0` is required.** Flex children default to `min-height: auto` and refuse to shrink below their content size, which would silently defeat the `max-height` on `root`. Without this the change appears to do nothing.
- **`overscrollBehavior: contain`** stops a wheel scroll that reaches the end of the settings list from chaining through to the document and panning the hex map behind the modal.

### A2. Delete the 240px assumption

Replace `menu.ts:270-272`. The panel is already appended to the DOM by the time `openCenteredModal` reaches this point, so it can be measured directly rather than guessed:

```ts
const rect = menu.root.getBoundingClientRect();
const top = Math.max(24, (window.innerHeight - rect.height) / 2);
menu.setPosition((window.innerWidth - width) / 2, top);
```

### A3. Re-clamp when content grows

This is the part a one-time measurement misses: the accordion expands *after* the modal opens, so a panel measured at 300px becomes 1000px with no repositioning.

Attach a `ResizeObserver` to `menu.root` inside `openCenteredModal` that re-clamps:

```ts
top = Math.max(24, Math.min(top, window.innerHeight - rect.height - 24));
```

Add a `window.resize` listener doing the same. Tear both down in the existing `onClose` handler (`menu.ts:268`) so closing a modal does not leak an observer.

### A4. Bound the drag

Add upper clamps in `attachDrag` (`menu.ts:228-229`) so a panel cannot be dragged past the right or bottom viewport edge.

### Verification

1. Open Settings, expand all 5 sections. Panel stays within the viewport, header stays pinned, body scrolls to the last control.
2. Wheel over the modal at full scroll does not pan the hex map behind it.
3. Drag the Settings panel toward each viewport edge; it stays reachable.
4. Regression spot-check the call sites most likely to have depended on unbounded growth: **Asset Manager** (720px wide), **Battle Results**, **Test Battle Setup**.
5. `npm run build` passes.

### Risk

Low but non-zero — 15 call sites share this helper. The realistic failure mode is a modal that was quietly relying on the panel growing unbounded, or on the old (broken) centering maths. Step 4 covers the likeliest candidates.

---

## Stage B — paged Settings (`src/views/settingsMenu.ts`)

Reduces height pressure at the source. Only worth starting once Stage A is confirmed in the app.

### B1. Replace the accordion with a view stack

Retire `makeFoldableSection` (line 65). Root view lists the 5 sections as buttons; selecting one swaps `modal.body` content to that section, prefixed with a `‹ Back` row.

### B2. Reuse the section builders unchanged

Each of the 5 sections already builds an `HTMLElement[]` and hands it to `makeFoldableSection` (lines 179, 279, 379, 427, 691). Only the container changes — the ~600 lines of control-building logic stay untouched, keeping the diff small relative to the file's 740 lines.

### B3. Preserve the `refreshList` wiring

`refreshList` (line 130) collects refresh callbacks that drive live-apply. These must survive a view swap. **This is the main correctness risk in Stage B** — if callbacks are dropped when the view changes, settings silently stop updating live, with no error to signal it.

Settings applies changes instantly, so there is no save/cancel state to carry across pages.

### Open question

Should `‹ Back` always return to the section list, or should reopening Settings remember the last section viewed? Does not affect Stage A.

---

## Options considered and rejected

| Option | Why not |
|---|---|
| **Single-open accordion** (collapse others on expand) | Insufficient alone — the Visual section *by itself* already overflowed at a 691px viewport. Would mask the bug at common window sizes without fixing it. |
| **Two-pane settings** (section list left, content right, widen 420 → ~640) | Best end state for a settings screen, but materially more work than B for the same immediate benefit. Reconsider after B if Settings keeps growing. |
| **Stage B alone, skipping A** | Fixes only what is currently visible. The other 14 modals keep the latent overflow, and the next one to grow re-opens the same bug. |

---

## Stage A as built

Implemented in `src/views/menu.ts` (+60 / −6). Differs from the plan above in one
important way: **no `ResizeObserver` is used for centring.**

### Why A3 was abandoned

A3 assumed a `ResizeObserver` on `menu.root` would catch post-open content growth.
It does not. Once `root` hits its `max-height`, the extra content is taken up by the
scrolling body and `root`'s own box stops changing — so the observer goes silent
exactly when it is needed. An independent probe observer on the same element
recorded **0 callbacks** across a full collapse/expand cycle.

The wrapper created by `openCenteredModal` was *already* `display:flex` +
`align-items:center`. The only reason it never centred anything is that
`setPosition` writes `position:absolute`, which removes the panel from flex flow.
Leaving the panel in flow lets CSS handle centring, growth, and window resize with
no JavaScript and no observer.

### What changed

| # | Change | Location |
|---|---|---|
| A1 | `root` → flex column with `max-height: calc(100vh - 48px)`; `header` → `flex-shrink: 0`; `body` → `overflow-y: auto`, `min-height: 0`, `overscroll-behavior: contain` | `PopupMenu` constructor |
| A2 | Hardcoded `240` removed; no position computed at all | `openCenteredModal` |
| A3′ | **Replaced:** panel stays `position: relative` in the wrapper's flex flow; wrapper gains `padding: 24px` + `box-sizing: border-box` | `openCenteredModal` |
| A4 | Drag clamped on all four edges via a shared `clamp` helper | `attachDrag` |
| A5 | **New:** first drag promotes the panel from flex flow to `position: absolute`, pinned where it currently sits | `attachDrag` |

### Two traps worth remembering

- **`min-height: 0` on the body is load-bearing.** Flex children default to
  `min-height: auto` and refuse to shrink below their content, which silently
  defeats the `max-height` on `root`. Without it the change appears to do nothing.
- **Do not use `max-height: 100%` here.** A percentage resolves against the
  wrapper's *content* box in flex flow but its *padding* box once a drag promotes
  the panel to absolute — quietly loosening the cap by the padding and letting the
  panel hang ~2px off screen. The viewport-based `calc(100vh - 48px)` is identical
  in both modes.

### Verified in the running app

In-game Settings, all 5 sections expanded, 691px viewport:

| Check | Result |
|---|---|
| Panel fits viewport | ✅ top 23, bottom 668 (was bottom 1044) |
| Previously unreachable content | ✅ 572px now scrollable |
| Reaches last control | ✅ `Close` reachable |
| Header pinned while scrolled | ✅ |
| Page itself does not scroll | ✅ |
| Drag to all 4 corners stays on screen | ✅ 4/4 |
| Auto re-centres on growth | ✅ top 162 → 23, no JS |

Regression spot-checks, all on screen and correctly centred: New Game (400),
Test Battle Setup (480), Developer Settings (480), Asset Manager (720), plus the
non-modal `PopupMenu` popups (Heroes, Settlements) which share the constructor change.

`npx tsc --noEmit` clean; `npm run build` passes.
