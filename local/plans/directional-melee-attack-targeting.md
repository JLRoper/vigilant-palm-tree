# Plan: directional melee attack targeting (part 1 of the attacking overhaul)

> **Superseded — shipped with an inverted interaction model.** Kept for the design
> reasoning; the line numbers below predate the Spy removal (`96a9a13`) and no longer match.
>
> This doc aimed the *actor's* hex edge at whatever enemy sat on that side: you clicked your
> own hex or a move-range hex, and the nearest edge chose the target. What shipped inverts
> it — you aim the *enemy*, and the sixth of its hex under your cursor chooses the hex you
> close in **from**. That reads more directly as "pick the direction I'm attacking from",
> and it subsumes this doc's model as the click fallback: with a target latched by hover,
> clicking one of its highlighted approach hexes attacks from there.
>
> As shipped:
> - `getApproachHexes` and `attackFromHex` in `shared/combat/manualBattle.ts` — the engine
>   half. Approach hexes come from a single `movementCosts` lookup, and `attackFromHex`
>   validates everything before the platoon moves, so a rejection can never half-commit.
> - `HEX_DIRECTIONS` and `nearestHexEdge` in `src/core/hex.ts` — as this doc proposed, the
>   six neighbour offsets are now one shared edge-ordered constant. It replaced both the
>   private `EDGE_NEIGHBORS` in `src/core/control.ts` and `NEIGHBOR_DIRS` in the battle engine.
> - Hover latch, sector preview with a direction arrow, and the click branch in
>   `src/views/manualBattleArena.ts`.
> - A sector pointing at a blocked or unreachable hex **snaps to the nearest legal approach**
>   rather than doing nothing — this doc's "empty side does nothing" rule turned out to be
>   too punishing once the cursor, not a click, was driving the choice.
> - The bump attack narrowed to fire only when exactly one enemy is adjacent; see
>   [move-into-contact-rules.md](move-into-contact-rules.md).
>
> Deferred: flank/rear damage bonuses — see [flanking-and-facing.md](flanking-and-facing.md).

## Context

This is the first part of a broader plan to rework how attacking works. It covers only the
click model: how a player aims a melee attack when their platoon has more than one enemy
platoon adjacent to it (or adjacent to a hex it could move into).

Scope, confirmed with the user:

- Applies to the **manual battle arena** (`src/views/manualBattleArena.ts` +
  `shared/combat/manualBattle.ts`) — the tactical screen where individual platoons are
  selected and act one at a time. Not the overworld map (Heroes/armies there don't have
  per-platoon selection).
- Two cases:
  1. **Already adjacent** — the player clicks their *own* platoon's hex. The hex side
     nearest the click highlights, indicating the attack direction. If a living enemy
     platoon occupies the neighboring hex on that side, that's the target.
  2. **Needs to move first** — the player clicks a hex within their move range that
     borders one or more enemy platoons. The side of *that* hex nearest the click
     highlights; if an enemy is on that side, the platoon moves there and attacks in one
     click.
  3. If the nearest side has no enemy on it, no attack is performed.

Today, `handleClick` (`src/views/manualBattleArena.ts:1362`) only supports two
single-purpose clicks: click an enemy's own hex (present in `attackTargets`) to attack it
outright (`1423-1431`), or click an empty hex in `moveRange` to move there with nothing
else happening (`1433-1452`). There's no way to move-and-attack in one click, and no way
to disambiguate when a hex borders more than one enemy — the player can only ever target
whichever enemy hex they click directly.

## Design notes

- Scoped to **melee only**. Ranged platoons (`isRangedPlatoon`,
  `shared/combat/manualBattle.ts:249`) attack via range + line-of-sight
  (`getValidRangedTargets:258`), not adjacency, so there's no "side" to pick — their
  existing click-the-enemy-hex behavior is untouched.
- The existing direct click-on-enemy-hex attack (`handleClick:1423-1431`) stays as-is. It's
  a strict subset of the new behavior (the unambiguous single-neighbor case), so the two
  paths never disagree.
- A click that resolves to an empty side does **nothing** — no move, no attack — rather
  than silently falling back to a plain move. An ambiguous/miss-click shouldn't reposition
  the platoon.
- The engine already supports move-then-attack in one turn without changes:
  `movePlatoon` (`manualBattle.ts:360`) only spends movement budget and does not clear the
  platoon from `unactedSetFor`; `attackWithPlatoon` (`manualBattle.ts:377`) validates the
  target against the actor's *current* position, so calling `movePlatoon` immediately
  before `attackWithPlatoon` already works correctly today.

## Approach

### 1. Shared hex-edge utilities — `src/core/hex.ts`

- Move `EDGE_NEIGHBORS` (currently private to `src/core/control.ts:18`) here as an exported
  constant, and have `control.ts` import it instead of redefining it — it's the same
  edge-index → axial-neighbor-delta mapping `territoryBoundaryEdges` (`control.ts:47`)
  already uses.
- Add `nearestHexEdge(cx, cy, px, py): number`, returning the 0-5 edge index nearest a
  point relative to a hex center, using the same corner-angle convention as `hexCorners`
  (`angle = 60*i - 30`, `hex.ts:35`) so it lines up with existing corner/edge math.

### 2. Compute attack-approach hexes — `shared/combat/manualBattle.ts`

- New export, e.g. `getMeleeApproachHexes(state, combatant): { hex: Axial; edgeTargets: Map<number, Combatant> }[]`:
  for the combatant's current position plus every hex in `getMovementRange`
  (`manualBattle.ts:215`), check each of the 6 `EDGE_NEIGHBORS` directions for a living
  enemy combatant; keep only hexes with at least one populated edge.
- Only computed for melee platoons (`!isRangedPlatoon`).

### 3. Arena interaction state — `src/views/manualBattleArena.ts`

- New state `attackApproachHexes`, recomputed everywhere `moveRange`/`attackTargets` are
  today: `selectPlatoon` (`1209-1219`), `refreshAfterMove` (`1242-1265`), and cleared in the
  same spots they're cleared (`1214-1215`, `1247-1248`, `1269-1270`, `1295-1296`,
  `1457-1459`).
- New state `hoverHex` / `hoverEdge` for the live preview.
- New `canvas.addEventListener("mousemove", ...)` — none exists today; mirror the click
  handler's coordinate conversion (`1488-1493`). If the hovered hex is in
  `attackApproachHexes`, convert the mouse position to hex-local space and call
  `nearestHexEdge` to find the side to preview.
- `draw()` (`1139-1207`): after the existing attack-target ring loop (`1156-1163`), draw the
  previewed edge as a thick line via `hexCorners(...)[edge]` / `[(edge+1) % 6]` — red
  (`#e05050`, matching the existing attack-ring color) if that side has a live enemy, dim
  gray otherwise.

### 4. Click resolution — `handleClick` (`1362-1485`)

Add a branch before the existing `attackTargets.find` check (`1423`): if `selectedSlot` is
set and the clicked hex is in `attackApproachHexes`, resolve the nearest edge exactly like
the hover preview and look up `edgeTargets.get(edge)`:

- No target on that edge → no-op.
- Target present, hex is the combatant's current position → `attackWithPlatoon(...)`
  directly (same call as `1427`).
- Target present, hex is a different (in-range) hex → `movePlatoon(state, humanSide, selectedSlot, hex)`
  then `attackWithPlatoon(state, humanSide, selectedSlot, target.slotIndex)`, reusing the
  move bookkeeping pattern already at `1437-1446` (recordMove, debugLog) before the
  attack log/refresh pattern at `1428-1429`.

## Out of scope

- `resolveAttack`, damage/casualty math, and `runAiTurn` — the AI targets programmatically
  and doesn't go through hex-click UI.
- Spy targeting/`spyMode`, which keeps its own separate click-interception branch
  (`1372-1399`).
- The overworld/adventure map.

## Verification

1. `npm run build` — tsc + vite must stay clean.
2. Manual check via dev server: start a Test Battle, select a melee platoon, and confirm:
   - Adjacent to exactly one enemy: hovering/clicking your own hex highlights that side and
     attacks it.
   - Adjacent to two enemies on different sides: each side highlights and attacks the
     correct one.
   - A hex within move range that borders an enemy previews the edge on hover; clicking it
     moves the platoon there and attacks in the same click.
   - Clicking a move-range hex whose nearest edge has no enemy does nothing — platoon stays
     put, no log entry.
   - A ranged platoon is unaffected — clicking an enemy hex directly still attacks, no edge
     highlighting appears.
