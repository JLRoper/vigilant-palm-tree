# Plan: Fix unusable last hero movement point, and drop the decimal in movement displays

**Source:** Manual repro in the running app (create game → select the starting hero → move repeatedly until movement remaining drops below a full hex's terrain cost).
**Status:** Root cause identified and verified by reading the code path; no code changes made yet. This document is the handoff.

## Problem 1 — a hero with movement left can be unable to move at all

### Root cause

`computeReachableSplit` in [`src/render/overlays/pathOverlay.ts:12-26`](../src/render/overlays/pathOverlay.ts#L12-L26) decides how far along a clicked path a hero can move this click:

```ts
export function computeReachableSplit(
  path: readonly Axial[],
  map: GameMap,
  movementRemaining: number,
): number {
  let cumulative = 0;
  for (let i = 0; i < path.length; i++) {
    const t = map.get(path[i].q, path[i].r);
    const stepCost = t ? TERRAIN_COST[t] : Infinity;
    if (!Number.isFinite(stepCost) || stepCost <= 0) return i;
    if (cumulative + stepCost > movementRemaining) return i;   // <-- bug
    cumulative += stepCost;
  }
  return path.length;
}
```

The `cumulative + stepCost > movementRemaining` check requires the *entire* cost of the next hex to fit inside whatever movement is left. Terrain costs are fractional (`forest = 1.2`, `desert = 1.4`, see [`packages/engine/src/map/terrain.ts:12-19`](../packages/engine/src/map/terrain.ts#L12-L19)), so a hero can easily end up with e.g. `0.5` movement remaining — enough to justify one more hex, but not enough to satisfy this check — and be stuck, even though `docs/heroes.md` describes movement as a simple point pool "consumed by terrain costs," not a per-hex reservation.

This is the actual "last movement point is not usable" bug.

### The existing workaround (symptom, not fix)

Someone already noticed the fallout and papered over the *display* instead of the *movement* logic:

- [`src/screens/heroes/heroInfoMenu.ts:9-13`](../src/screens/heroes/heroInfoMenu.ts#L9-L13):
  ```ts
  const MOVEMENT_PER_TURN = 7;
  const MIN_USABLE_MOVEMENT = 1.0;

  function displayableRemaining(remaining: number): number {
    return remaining < MIN_USABLE_MOVEMENT ? 0 : remaining;
  }
  ```
- [`src/screens/shared/hud.ts:32`](../src/screens/shared/hud.ts#L32): `(selected.movementRemaining < 1 ? 0 : selected.movementRemaining).toFixed(1)`
- [`src/screens/heroes/heroRosterMenu.ts:173`](../src/screens/heroes/heroRosterMenu.ts#L173): `const remaining = hero.movementRemaining < 1 ? 0 : hero.movementRemaining;`

All three independently hardcode "below 1 point, just show 0" — because below 1 point was already unusable, so showing the true fractional value was more confusing than helpful. Once the real bug is fixed this hack becomes actively wrong (a hero with 0.4 remaining *will* be able to move one more hex) and should come out.

### Duplicate logic that needs the same fix

[`src/io/debugCommands.ts:52-77`](../src/io/debugCommands.ts#L52-L77) (`window.__gameDebug.requestMove`, used for manual/console testing) reimplements the same clamp independently, with the same bug:

```ts
if (cumulative + stepCost > hero.movementRemaining) break;
```

### Fix

1. In `computeReachableSplit`, stop only once movement is **already** exhausted, not preemptively:
   ```ts
   if (cumulative >= movementRemaining) return i;
   ```
   Trace check against the existing characterization test (`test/render/adventureScene.test.ts:228`, `movementRemaining = 1`, three grass hexes cost 1 each): `cumulative(0) >= 1`? no → `cumulative = 1`. Next iteration: `cumulative(1) >= 1`? yes → `return 1`. Same result as before (`splitIdx === 1`), so that test is unaffected — the bug only bites when remaining movement is a genuine fraction less than the next step's cost, not on exact multiples.

2. `computeReachableSplit` only decides *how many hexes* are reachable; the cost charged for that last, possibly-not-fully-covered hex still needs capping so the hero's `movementRemaining` lands at exactly `0`, never negative. Every call site currently computes `actualCost` via `computePathCost(...)` (a plain sum of nominal terrain costs) and passes it straight to `requestMove`/`startMove`. `packages/engine/src/hero/move.ts:38` (`if (hero.movementRemaining < cost) return { ok: false, reason: "insufficient_movement" }`) will reject the move outright if that nominal sum overshoots what's left. Cap it at each call site:
   ```ts
   const actualCost = Math.min(
     computePathCost(this.opts.map, [{ q: startTile.q, r: startTile.r }, ...path.slice(0, reachableIdx)]),
     startTile.movementRemaining,
   );
   ```
   Apply this in **both** places in [`src/screens/adventure/adventureView.ts`](../src/screens/adventure/adventureView.ts) that compute `actualCost` (the attack-adjacent-tile path around line 535, and the normal move-to-tile path around line 592), and in the equivalent spot in `debugCommands.ts`'s `requestMove` (replace its manual loop with the same `cumulative >= movementRemaining` condition, then cap `actualCost` the same way).

3. Remove the now-incorrect `MIN_USABLE_MOVEMENT` / `displayableRemaining` hack in `heroInfoMenu.ts`, and the inline `< 1 ? 0 :` clamps in `hud.ts` and `heroRosterMenu.ts` — they exist solely to hide the bug fixed in step 1–2.

## Problem 2 — movement displays show a decimal that doesn't need to be there

Per the requester: a hex change is a discrete, all-or-nothing move — there's no such thing as a partial hex — so showing movement remaining to one decimal place (`5.8/7`, `3.4/7`) implies a precision that isn't meaningful to the player.

Three call sites currently format with `.toFixed(1)`:

- [`src/screens/shared/hud.ts:32`](../src/screens/shared/hud.ts#L32)
- [`src/screens/heroes/heroRosterMenu.ts:174`](../src/screens/heroes/heroRosterMenu.ts#L174)
- [`src/screens/heroes/heroInfoMenu.ts:201`](../src/screens/heroes/heroInfoMenu.ts#L201) and [`:493`](../src/screens/heroes/heroInfoMenu.ts#L493)

### Fix

Switch all four to a rounded whole number (`Math.round(...)`, clamped into `[0, MOVEMENT_PER_TURN]`) instead of `.toFixed(1)`. Do this **after** Problem 1's fix lands, since removing the `< 1 ? 0` clamps changes what these call sites are rounding in the first place — folding both changes into the same edit avoids a half-migrated intermediate state where movement is still fractional but the "below 1 shows 0" hack is gone and unrounded.

## Verification checklist for whoever picks this up

1. `npm test -- test/render/adventureScene.test.ts` — confirm the two `computeReachableSplit` characterization tests still pass unmodified (see trace in Problem 1, fix step 1).
2. Add a new unit test for the previously-broken case: `movementRemaining = 0.5`, a single grass hex (`cost = 1`) ahead — `computeReachableSplit` should now return `1` (reachable), not `0`.
3. Manually, in the running app (`npm run dev`): select the starting hero, move it repeatedly (clicking progressively along a path of plain terrain) until `movementRemaining` is a small fraction less than 1 full hex's cost. Confirm the next click still moves the hero (into the adjacent hex, movement then reading `0`), rather than silently rejecting the click.
4. Confirm the HUD, hero roster popup, and hero info panel all show whole-number movement (no decimal point) in both states: full movement and partially spent.
5. Grep for any other `.toFixed(1)` or `< 1 ? 0` movement-clamp copies this plan may have missed before calling it done — `movementRemaining`, `MOVEMENT_PER_TURN`, and `toFixed` are the search terms that turned up the three display sites and two logic sites listed above.

## Files touched (expected)

- `src/render/overlays/pathOverlay.ts` — `computeReachableSplit` condition
- `src/screens/adventure/adventureView.ts` — `actualCost` capped at both call sites
- `src/io/debugCommands.ts` — `requestMove`'s duplicate clamp loop
- `src/screens/heroes/heroInfoMenu.ts` — remove `MIN_USABLE_MOVEMENT`/`displayableRemaining`, round instead of `toFixed(1)`
- `src/screens/shared/hud.ts` — remove `< 1 ? 0`, round instead of `toFixed(1)`
- `src/screens/heroes/heroRosterMenu.ts` — remove `< 1 ? 0`, round instead of `toFixed(1)`
- `test/render/adventureScene.test.ts` — add the `0.5`-remaining regression case
