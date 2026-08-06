# Plan: reconfigure formation during battle

## Context

The manual battle arena (`src/views/manualBattleArena.ts`) already deploys each side's platoons onto one outer hex column — attacker at `q=0`, defender at `q=cols-1` — one platoon per row, rows spaced by 2 (`shared/combat/grid.ts:60-69`, `deploymentPosition`). That spacing exists specifically so every deployed platoon has a free "personal space" hex next to it. Right now the only way to change a platoon's position once battle starts is `movePlatoon` (`shared/combat/manualBattle.ts:360`), which walks it through open terrain using its normal movement budget — there's no way to just re-order which platoon sits in which row (e.g. move your ranged unit out of the front row) without physically walking it there, hex by hex, potentially across several rounds.

This plan adds a **Reconfigure Formation** action: a compact hex-grid widget showing just the player's own deployment column, where the player can swap two of their platoons' positions directly, without pathing them through the map.

## Engine changes

### `shared/combat/manualBattle.ts`

Add a new exported function alongside `movePlatoon`:

```ts
export function swapPlatoonPositions(state: ManualBattleState, side: BattleSide, slotA: number, slotB: number): boolean
```

- Look up both combatants via `getCombatant`; bail if either is missing, retreated, or has no living entries.
- Bail if either slot isn't in `unactedSetFor(state, side)` — cost accounting details below.
- Swap the two `Combatant.position` values in place.
- Reuse `hexDistance` (`src/core/hex.ts`) between the two positions to compute a movement cost (see "Open question" below), charged against `moveBudgetSetFor(state, side)` for both slots via the existing `remainingMovement`/budget-map plumbing that `movePlatoon` already uses (`manualBattle.ts:100-108, 360-376`).
- No pathfinding/occupancy check needed — both hexes are already occupied by the two combatants being swapped, so there's nothing to validate beyond "both slots can afford the cost."

This is a same-side-only swap (`side` is fixed for both slots) — no cross-side interaction, so it doesn't touch attack/spy logic at all.

### `shared/combat/types.ts` / tests

No type changes needed — `swapPlatoonPositions` only rearranges existing `Combatant.position` fields. Add unit tests in `test/combat/manualBattle.test.ts` mirroring the existing `movePlatoon` tests: swap succeeds within budget, fails when either slot already acted, fails when budget is insufficient, and confirms the two combatants' positions are exchanged exactly (not just moved).

## UI changes

### New file: `src/views/formationReconfigure.ts`

A modal (not embedded inline — see "Display" below) that:
- Renders a small canvas or set of positioned hex `<div>`s for just the player's own deployment column (reuse `axialToPixel`/`hexCorners` from `src/core/hex.ts` at a smaller `HEX_SIZE`, e.g. 24), one hex per row the side occupies, labeled with each platoon's lead unit icon/name (same token-drawing logic already in `manualBattleArena.ts` can be factored out or duplicated at small scale).
- Click one occupied hex, then a second, to select a swap; show the computed movement cost for both slots before confirming (greyed out / disabled if either lacks the budget).
- Confirm calls `swapPlatoonPositions`, then closes and triggers the same re-render path the arena already uses after `movePlatoon` (redraw canvas, refresh platoon cards/status bars).
- Cancel/click-outside closes without mutating state.

This mirrors the existing `createPlatoonInfoPopup` pattern (`src/views/platoonInfoPopup.ts`) — a focused popup anchored over the arena rather than a persistent layout element.

### `src/views/manualBattleArena.ts`

Add a "Reconfigure" button near the top of the player's own column (`attackerColumn`/`defenderColumn`, built by `buildSideColumn` around `manualBattleArena.ts:1029-1059`), enabled only for the human-controlled side. Opens `formationReconfigure.ts`'s modal, passing the current `ManualBattleState`, the human `side`, and a callback to re-render after a swap.

## Open question: what should a swap cost?

You asked whether reconfiguring should burn a full turn or some amount of movement. My take:

**Recommendation: charge movement budget, not a full turn** — specifically, `hexDistance(posA, posB)` deducted from *both* platoons' `moveBudget` for the round (the same budget `movePlatoon` already draws from), and require both to be able to afford it or the swap doesn't happen at all.

Reasoning:
- `movePlatoon` already establishes the precedent that repositioning costs movement, not the whole turn — a platoon can move and still attack the same round. A swap is just two platoons moving simultaneously, so it's consistent to price it the same way rather than inventing a separate resource.
- If a swap cost a full turn instead, it would almost always be *strictly worse* than just calling `movePlatoon` twice (which doesn't end the turn) — the only reason to reach for "full turn" pricing is if the swap is meant to do something movement can't (e.g. leapfrog a blocked or distant hex instantly). It currently isn't more powerful than normal movement, so it shouldn't cost more.
- Distance-based cost scales naturally with how disruptive the reshuffle is: since deployment rows are spaced by 2, swapping adjacent platoons is cheap (cost 2) and swapping your front and back platoon is expensive (cost up to 2×(rows-1)) — no extra tuning knob needed, it falls out of the existing hex math.

**Alternative if you want it simpler:** a flat cost (e.g. 1 movement point per swap regardless of distance), which is easier to explain in the UI but ignores how big the reshuffle actually is. I'd only go this route if playtesting shows the distance-based cost feels unpredictable.

**If you want it to feel more like a deliberate tactical reset** (rather than "movement, but instant"): make it cost the full turn for both platoons involved (`endPlatoonTurn` on both slots after swapping). This is simpler to implement (no cost math at all) and is easy to justify narratively ("reorganizing the line takes the whole round"), at the cost of being a fairly punishing, rarely-used option. I'd reserve this only if you specifically want reconfiguration to be a rare, high-commitment decision rather than a routine tactical tool.

I'd start with the movement-budget version since it reuses the existing budget system end-to-end and needs no new UI copy explaining a separate resource — but flag if you'd rather go with the full-turn version for simplicity or pacing reasons.

## Display: where does the reconfigure UI live?

You suggested the free space between the arena grid and the platoon cards. Worth flagging before building on that assumption: I checked the current layout and **there isn't reliable free space there**. `openManualBattleArena` (`manualBattleArena.ts:719-1073`) lays out `container` as a single flex row — `attackerColumn` (platoon cards) → `canvasWrap` (the hex canvas) → `defenderColumn` (platoon cards) → `sidePanel` (battle log) — each separated only by a uniform `10px` flex gap, with the canvas itself centered and sized to fit its content (tightened up in a recent commit, `0805b73`, specifically to fix overflow/scaling bugs). The cards sit directly beside the canvas, not floating in a dead zone with slack space around it — so there's no existing gutter to drop a persistent widget into without either shrinking the canvas or the cards to manufacture one.

**Recommendation: a modal/popup**, same pattern as `platoonInfoPopup.ts` (`createPlatoonInfoPopup(canvasWrap)`), triggered by the "Reconfigure" button in the player's column. This:
- Needs no layout rework and can't reintroduce the overflow bug `0805b73` just fixed.
- Matches how the codebase already surfaces secondary info/actions in this view (click a platoon → popup with stats, per `bc4eb35`).
- Gives the small hex grid a bigger, less cramped space to work in than a squeezed-in gutter would (dragging/clicking precision matters more here than in a read-only info popup).

**If you'd still rather have it inline** between the grid and cards permanently visible: that's a bigger layout change — reserving a fixed-width middle column in `container` and shrinking `canvasWrap`'s available width to make room, which risks re-triggering the overflow/scaling issues `0805b73` just resolved and would need re-verifying that fix. Doable, but I'd treat it as a deliberate follow-up rather than bundling it into this feature's first pass.

## Out of scope

- Cross-side interactions — this is strictly "rearrange your own platoons," no effect on the opponent.
- Changing platoon *composition* (which units belong to which platoon) — this plan only repositions existing platoons on the grid, it doesn't touch `PlatoonEntry`/`MAX_PLATOON_ENTRIES` regrouping.
- Pre-battle army ordering (before `openManualBattleArena`/`startManualBattle` is even called) — that's a separate, simpler feature (just reordering the `Platoon[]` array passed in) and not what's being built here, which is explicitly an in-battle action.
- AI use of this action (`runAiTurn`, `manualBattle.ts:486`) — v1 is human-only; AI continues to just move/attack/end-turn as it does today.

## Verification

1. `npm run test:all` — new `swapPlatoonPositions` tests plus existing suite must stay green.
2. `npm run build` — tsc + vite build clean.
3. Manual check via the dev sandbox (`testBattleSetup.ts`): open a manual battle, click "Reconfigure," swap two platoons with sufficient budget (succeeds, cards/canvas update), attempt a swap exceeding remaining budget (blocked with a clear reason shown), confirm a swapped platoon still shows correctly in `platoonInfoPopup` afterward, and confirm the swap correctly consumes movement budget so a platoon that reconfigures has less (or no) budget left for a subsequent `movePlatoon` the same round.
