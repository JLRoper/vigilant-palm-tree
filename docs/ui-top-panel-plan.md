# UI panel plan: global top bar + contextual detail panels

## Goal

Move the most important game-wide information into a persistent top-of-screen panel, while keeping detailed information for heroes, villages, and settlements available only when the player selects or clicks them.

## Current fit in the codebase

The existing UI is already split across a few places:
- [src/views/hud.ts](../src/views/hud.ts) builds the current HUD text line.
- [src/managers/UIManager.ts](../src/managers/UIManager.ts) owns the HUD refresh cycle and opens the detail menus.
- [src/views/heroInfoMenu.ts](../src/views/heroInfoMenu.ts) and [src/views/settlementInfoMenu.ts](../src/views/settlementInfoMenu.ts) already provide detailed panels for selected entities.
- [index.html](../index.html) contains the fixed HUD container that can be expanded into a more structured top bar.

## Proposed layout

### 1. Top bar / global info panel
Create a fixed top strip that shows high-level state only:
- Current turn / round / phase
- Player wealth
- Morale
- Income / economy summary
- Active hero count and enemy count
- Save / backend status
- Optional quick actions such as End Turn

This panel should stay visible at all times and act as the primary “dashboard”.

### 2. Contextual detail panels
Keep the detailed views for specific entities, but make them appear only when the player interacts with something:
- Click a hero -> open hero detail panel
- Click a settlement or village -> open settlement detail panel
- Click empty terrain -> close any active detail panel
- Use roster and keyboard selection to open the same detail panel consistently

The detail panel should not be the default view; it should be a focused overlay or side panel that appears on selection.

### 3. Interaction model
Implement a single selection flow:
1. Click / select an entity.
2. Update the top bar if the selection changes the global summary.
3. Open the appropriate detail panel.
4. If the user clicks elsewhere, clear the selection and close the detail panel.

This keeps the screen cleaner and avoids showing too much information at once.

## Implementation phases

### Phase 1: Introduce the top bar shell
- Replace the current single-line HUD text with a richer top panel container.
- Keep the existing info text but organize it into labeled rows or chips.
- Reserve space for future action buttons.

### Phase 2: Move global summary into the top bar
- Move the economy and turn summary out of the old HUD text and into the new top bar.
- Keep the top bar updated every frame through the existing HUD refresh path.

### Phase 3: Refine the detail panel behavior
- Ensure hero and settlement menus open from selection events instead of relying on the old, more scattered state flow.
- Make the detail panel dismiss cleanly when selection is cleared.
- Avoid duplicate information between the top bar and the detail slip.

### Phase 4: Polish and UX pass
- Add consistent spacing, spacing hierarchy, and visual separation between the top bar and detail panels.
- Make sure the layout still works on smaller screens and with the minimap / toolbar.
- Adjust panel anchoring so they do not overlap the toolbar or map controls.

## Acceptance criteria

- The top of the screen always shows the global summary.
- Heroes, villages, and settlements show detailed information only when selected.
- Clicking empty terrain closes the detail panel.
- The layout remains readable and does not cover critical controls.

## Suggested implementation order

1. Create a dedicated top bar component under [src/views](../src/views).
2. Wire it into [src/managers/UIManager.ts](../src/managers/UIManager.ts) and the HUD refresh flow.
3. Reuse the existing hero and settlement menu components for details.
4. Adjust selection handling in the adventure view and UI manager.
5. Verify the experience by testing hero click, settlement click, and empty-tile deselection.
