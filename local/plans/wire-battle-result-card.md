# Plan: surface real battle results to the player

## Context

The build review (`local/builds/080126_build.md`, §4) flagged this as the single highest-leverage fix in the codebase: a real (non-sandbox) battle currently resolves with real casualties applied to both heroes' armies, but the player sees **nothing** — the result is `console.log`'d and discarded. The dev-only "Test Battle" sandbox already has a fully-built, reusable result screen (`battleResultCard.ts`) that does exactly the right thing (winner banner + per-side casualties); it's just never called from the real flow. The pre-battle confirmation modal (`battleModal.ts`) also still describes pre-engine behavior ("award +50 gold to the attacker and remove the defender") that hasn't been true since the tactical resolver shipped.

This is a wiring fix, not new design — no changes to `shared/combat/*` resolver logic, the dev sandbox, or the server route.

## Root cause

The resolved `BattleResult` exists at `server/routes.ts:900` and flows untouched through `io/api.ts`'s `resolveBattle()` wrapper (`ResolveBattleResult.battle`, api.ts:69-73) — but it gets dropped at two points on the way back to the UI:

1. `src/game/turnHooks.ts:56-79` (`onBattleResolved` hook) receives the full result, logs 4 fields from it, and returns only a `GameState` — the `battle` object itself is discarded.
2. `src/state/turnController.ts:356-376` (`resolveCurrentBattle()`) calls that hook and returns `Promise<void>` — even if the hook returned the battle, there's no return-path for it to reach the caller.

The caller, `src/managers/GameActions.ts:34-56` (`startBattleFlow`), is where the result needs to end up so it can hand off to `showBattleResultCard`.

## Approach

Thread the `BattleResult` back through the existing call chain via return values (mirrors the pattern the resolver already uses elsewhere — no event bus, no new abstraction). Confirmed via grep that `TurnControllerHooks`/`resolveCurrentBattle` have exactly one implementation (`turnHooks.ts`) and one caller (`GameActions.ts`) — `GameStateManager.ts` only passes the hooks through, and no test file touches either function, so this is a contained, low-risk signature change.

### 1. `src/state/turnController.ts`

- Import `BattleResult` type from `../../shared/combat/types`.
- Widen the `TurnControllerHooks` interface (line 42):
  ```ts
  onBattleResolved(state: GameState): Promise<{ state: GameState; battle: BattleResult | null }>;
  ```
- Update `resolveCurrentBattle()` (lines 356-376) to destructure the hook's result and return the battle:
  ```ts
  async resolveCurrentBattle(): Promise<BattleResult | null> {
    if (this.state.phase.kind !== "BATTLE") return null;
    const { attackerId, defenderId } = this.state.phase;
    const { state: resolved, battle } = await this.hooks.onBattleResolved(this.state);
    this.state = endBattlePhaseReducer(resolved);
    // ...unchanged (attackerSurvived, bus.emit, cleanupDefeatedHeroCharters, logEvent)...
    return battle;
  }
  ```

### 2. `src/game/turnHooks.ts`

Update the `onBattleResolved` hook body (lines 56-79) to return `{ state, battle }` instead of bare `state`, and drop the now-redundant `console.log` (the result will be visible on screen instead):
```ts
onBattleResolved: async (state) => {
  const cached = lastBattle;
  lastBattle = null;
  const name = opts.gameName();
  if (!name || !cached) return { state, battle: null };
  try {
    const result = await resolveBattle(name, {
      attackerId: cached.attackerId,
      defenderId: cached.defenderId,
      state,
    });
    return {
      state: { ...state, players: result.players, heroes: result.heroes },
      battle: result.battle,
    };
  } catch (e) {
    console.warn("[turnHooks] resolveBattle failed:", e);
    return { state, battle: null };
  }
},
```

### 3. `src/managers/GameActions.ts`

- Import `showBattleResultCard` from `../views/battleResultCard` and the `BattleResult` type from `../../shared/combat/types`.
- Update `startBattleFlow()` (lines 34-56) to capture the battle result and show the card after state is replaced (same ordering `manualBattleArena.ts` uses: close/settle the interim UI, then show the card):
  ```ts
  let battle: BattleResult | null = null;
  if (result === "resolve") {
    battle = await tc.resolveCurrentBattle();
  } else {
    tc.cancelMove(attackerId);
  }
  this.state.replaceState(tc.getState());
  if (battle) {
    showBattleResultCard({
      result: battle,
      attackerLabel: `Hero ${attackerName}`,
      defenderLabel: `Hero ${defenderName}`,
      onCarryOn: () => {},
    });
  }
  ```
  `onCarryOn` can stay a no-op: unlike the sandbox, the state mutation has already been applied and pushed via `replaceState` *before* the card is shown, so there's nothing further to advance on dismiss.

### 4. `src/views/battleModal.ts`

Replace the stale note (line 23) with copy that matches actual resolver behavior instead of the old delete-and-loot behavior:
```ts
note.textContent = "Resolve to fight the battle immediately. Casualties apply to both sides based on unit strength and type matchups.";
```

## Out of scope (explicitly not touching)

- `shared/combat/*` resolver logic, `manualBattleArena.ts`, the dev sandbox flow.
- The `attackerName`/`defenderName` labels' underlying quirk (`this.state.getHero(attackerId)?.id ?? attackerId` just re-yields the id) — cosmetic, unrelated to this fix.
- `obstacleSeed` non-determinism in `server/routes.ts` — a separate item from the review, not part of "the one thing worth fixing first."

## Verification

1. `npm run build` — tsc + vite build must stay clean (this is a pure type/signature change, no `any`).
2. `npm run test:all` — confirmed `test/smoke.ts` never exercises battle, so no test should need updating; run it anyway to catch anything unexpected.
3. Manual check via dev server: trigger a real adventure-map battle (walk a hero adjacent to an enemy hero), click "Resolve" on the battle modal — confirm the modal now shows the corrected note text, and after resolving, the "Battle Results" card appears with the correct winner banner and per-side casualties, then dismisses cleanly via "Carry On" with the map/HUD reflecting the post-battle army state.
4. Confirm the "Flee" path (clicking Flee, or the losing/draw outcome) still behaves as before — no card shown when the player flees, since `battle` stays `null` in that branch.
