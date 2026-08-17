# Plan: Dual-Phase Parallel Development Split

*Authored 2026-08-15. Sibling to `2026-08-11-srp-module-reorganization.fable.md` and `2026-08-15-architecture-map_OVERVIEW.md`. Execution plan for running two developers (Dev A, Dev B) in parallel worktrees without merge conflicts.*

## Context

The full reorg is six phases. Running them strictly serially would take ~6 weeks of single-developer throughput. Two devs are available, but naively parallelizing phases doesn't work:

- **Phases 1→2→3 are a pipeline.** Phase 1 creates `packages/engine/`, Phase 2 fills it with domain files, Phase 3 imports them from the server. Phase 2 can't start before Phase 1 lands, and Phase 3 can't start before Phase 2's first domain lands.
- **Splitting Phase 1 in half doesn't work.** Workspaces scaffolding and content extraction land in the same PR cycle — the workspaces config has to know about the new packages when enabled, otherwise the codebase doesn't build between the two halves.

The split below exploits one fact: the **screens folder-move PR** (Decision 3.C in the Fable plan) is pure client refactor with zero engine/server/DB overlap. It can run fully in parallel with Phase 1.

## The split

### Track 1 (Dev A) — Phase 1 fully + start of Phase 2

**Goal:** working `@heroes/engine` package with the two leaf domains (`economy/*`, `charter/*`) extracted. End state: `packages/engine` is real, imports route through it, no behavior changes, the engine is ready for Phase 2's remaining domains to be added in subsequent PRs.

**Owned tree:** `package.json`, `tsconfig.json`, `vite.config.ts`, `dependency-cruiser.cjs`, `shared/`, `state/`, `core/`, `economy/`, new `packages/contracts/`, new `packages/engine/`.

**Exit criteria:**
- `npm run build` passes; `npm run test:all` passes; `npm run lint:deps` passes
- All existing imports of `shared/*` route through `@heroes/engine`
- All existing imports of type-only symbols from `src/state/gameState.ts` route through `@heroes/contracts` (the ones that are pure types — IDs, geometry, resource types, command/event shapes)
- `gameState.ts` re-exports from the new engine locations; runtime behavior unchanged
- `economy/*` and `charter/*` extracted into `packages/engine/src/economy/` and `packages/engine/src/charter/` as standalone command files (`validate` + `apply` per file)
- `dependency-cruiser.cjs` rules updated with the new package boundaries; `no-core-value-import-from-siblings` and `no-render-into-systems-or-views` rules preserved
- No changes to `views/`, `render/`, `managers/`, `server/`, `map/`, `combat/` (except import path updates where required by the new exports)

### Track 2 (Dev B) — Decision 3.C mechanical folder-move

**Goal:** stable `screens/` layout. Every file in `src/views/` moves to a screen-specific folder; no decomposition, no behavior changes. Sets up the codebase so every subsequent feature PR knows exactly where view code goes.

**Owned tree:** `src/views/`, all import statements referencing `views/*` across `src/` (rewrites to `@screens/*` aliases), `managers/UIManager.ts` (path updates only, no logic changes), `tsconfig.json` (path aliases — additive, lands after Dev A's workspaces PR), `dependency-cruiser.cjs` (rule updates — additive).

**Screen folders** (per Fable §2.4):
- `src/screens/shared/` — `toolbar.ts`, `hud.ts`
- `src/screens/adventure/` — `adventureView.ts`, `charterPlacement.ts` (new — see Phase-2-prep note below)
- `src/screens/heroes/` — `heroInfoMenu.ts`, `heroRosterMenu.ts`
- `src/screens/settlements/` — `settlementInfoMenu.ts`, `settlementRosterMenu.ts`, `cityView/`
- `src/screens/combat/` — `battleModal.ts`, `battleResultCard.ts`
- `src/screens/multiplayer/` — `multiplayerLobby.ts`
- `src/screens/home/` — `settingsMenu.ts` and any lobby-adjacent home-screen files

**Exit criteria:**
- All files moved; old `src/views/` directory removed
- `npm run build` passes; `npm run test:all` passes; `npm run lint:deps` passes
- `dependency-cruiser.cjs` allows `src/screens/` imports from anywhere in `src/` (existing rules continue to apply)
- No decomposition happened. `manualBattleArena.ts` (1701 lines) is split into the combat/ folder structure but its contents stay whole until the next feature edit touches it (per Decision 3.A's "as-touched" rule)

## Sequencing (week-by-week)

```
Week 1, Day 1-2:
  Dev A: lands workspaces scaffolding PR (root package.json workspaces field,
         empty packages/contracts and packages/engine dirs, dep-cruiser rules
         updated to know about the new packages but no contents moved yet).
         Codebase still builds with everything in src/.

  Dev B: begins screens folder-move in a separate worktree. Branch: refactor/screens-folder-move.

Week 1, Day 3 - Week 2, Day 2:
  Dev A: extracts packages/contracts (moves type-only exports from state/gameState.ts,
         ids.ts, geometry.ts, etc. into packages/contracts/src/). Updates imports
         across the codebase. Verifies build. PR lands.

  Dev B: completes the screens folder-move. Lands the refactor/screens-folder-move PR
         AFTER Dev A's workspaces scaffolding PR merges.

> **Postscript (2026-08-16):** the screens folder-move actually landed as two
> commits — `add78d5` (gameplay screens: adventure, settlements, combat) and
> `ba9f359` (chrome screens: heroes, multiplayer, home; `src/views/` deleted) —
> both on the same day, sequenced as the plan described. This split stayed
> useful: Phase 5 work has since layered `src/render/scene/` (the `entityMirror.ts`
> + `types.ts` + `sceneBuilder/{adventureScene,cityScene,battleScene}.ts` tree)
> on top without conflicts.

Week 2, Day 3 onwards:
  Dev A: moves shared/ → packages/engine/src/. Updates imports. Verifies build. PR lands.
         Then begins Phase 2 with economy/* extraction (the first leaf domain).

  Dev B: optional — decompose one large view file per feature PR as those files next
         receive edits. Examples: split manualBattleArena.ts (1701 lines) into the
         screens/combat/ folder structure when a feature edit next touches it.
         Not required for the dual-phase plan to succeed.

Week 3+:
  Dev A: continues Phase 2 (charter → settlement → hero → turn/endTurn.ts last).
  Dev B: available for Phase 3 prep (server command loop scaffolding — see below) OR
         feature work.

Week 4+:
  Once economy + charter are in @heroes/engine, Dev B (or Dev A) can begin Phase 3
  (server command loop + repos). Phase 3 needs at least one extracted domain to import
  from @heroes/engine, so it can't start before Week 3.
```

## File ownership table (toe-stepping prevention)

| Path / Tree | Owner | Notes |
|---|---|---|
| `package.json` (root) | Dev A | Workspaces field |
| `tsconfig.json` | Dev A first, then Dev B additive | Dev A adds `@heroes/engine/*`, `@heroes/contracts/*` aliases; Dev B adds `@screens/*` aliases. **Order matters — Dev A lands first.** |
| `vite.config.ts` | Dev A | Alias updates to match tsconfig |
| `dependency-cruiser.cjs` | Both, additive | Dev A adds package boundary rules; Dev B updates path patterns. Each PR adds its own forbidden edge; no overlap. |
| `shared/` | Dev A (moves to `packages/engine/src/`) | Deletion happens at end of Week 2 |
| `state/` | Dev A | `gameState.ts` shrinks to re-exports; types migrate to contracts |
| `core/` | Dev A | Untouched in Phase 1; remains src/core/ — becomes packages/engine/src/core/ in a later phase |
| `economy/` | Dev A | Extracts to `packages/engine/src/economy/` |
| `views/` | Dev B | Moves to `src/screens/` |
| `render/` | Dev B (path updates only) | Dev A doesn't touch this |
| `managers/` | Dev B (UIManager path updates only) | Dev A doesn't touch this in Phase 1 |
| `server/` | Neither in Week 1-2 | Phase 3 begins Week 3+ |
| `combat/`, `map/`, `entities/`, `systems/`, `io/` | Neither in Week 1-2 | Untouched; Phase 2 will touch combat/, map/ in Week 3+ |

**Conflict surface: zero.** Track 1 owns `shared/`, `state/`, `core/`, `economy/`. Track 2 owns `views/`, `render/`, `managers/UIManager.ts`. The two config files both touch (`tsconfig.json`, `dependency-cruiser.cjs`) are additive with documented ordering.

## Shared config touchpoints

Both tracks modify `tsconfig.json` and `dependency-cruiser.cjs`. **Order:**

1. **Dev A's workspaces scaffolding PR lands first** (Day 1-2). Adds:
   ```json
   // tsconfig.json
   "paths": {
     "@heroes/contracts/*": ["packages/contracts/src/*"],
     "@heroes/engine/*": ["packages/engine/src/*"]
   }
   ```
2. **Dev B's screens folder-move PR lands second** (Day 3+). Adds:
   ```json
   // tsconfig.json
   "paths": {
     // ... existing
     "@screens/*": ["src/screens/*"]
   }
   ```
3. **Dev A's engine extraction PR lands third** (Week 2). May add further aliases.

If the PR ordering slips, the second dev rebases onto the first's branch and resolves trivially — the path arrays are additive, so the merge is "keep both."

## Verification per track

**Track 1 (Dev A) — at each PR:**
- `npm run build` exits 0
- `npm run test:all` exits 0
- `npm run lint:deps` exits 0 (the dep-cruiser gate per the existing precommit setup)
- Manual: `grep -r "from ['\"]\.\./shared" src/ server/` returns 0 matches after the engine extraction PR
- Manual: `grep -r "from ['\"]\.\./state/gameState['\"]" src/ server/` returns only the new re-export shim

**Track 2 (Dev B) — at the screens folder-move PR:**
- `npm run build` exits 0
- `npm run test:all` exits 0
- `npm run lint:deps` exits 0
- Manual: `ls src/views/` returns ENOENT
- Manual: `git diff --stat` shows only renames + import rewrites (no content changes); use `git diff -M` to confirm rename detection
- The PR should ideally be **two PRs**, not one, for review surface:
  - **PR 1:** move `adventure/`, `city/` (`cityView`), `combat/` (battleModal, battleResultCard) — gameplay screens
  - **PR 2:** move `heroes/`, `settlements/`, `multiplayer/`, `home/`, `shared/` — chrome screens

## Risks and rollback

**Risk 1: Dep-cruiser rule conflicts.** Both tracks add forbidden edges. If they conflict (e.g., both try to redefine the `core/` rule), the merge fails loudly. **Mitigation:** each PR adds its own edge with a distinct `name`; reviewer confirms no duplicate `name`s in the merged config.

**Risk 2: View decomposition creep in Track 2.** Tempting to "while I'm here" split `manualBattleArena.ts` (1701 lines) into the `screens/combat/` folder structure during the folder move. **Mitigation:** the move PR must stay mechanical. The decomposition follows Decision 3.A — happens the next time a feature edit touches that file, paid for by that feature.

**Risk 3: Track 1's `gameState.ts` re-export shim conflicts with future Phase 2 domains.** As `economy/*` and `charter/*` move to engine, `gameState.ts` shrinks to re-export them. A future PR adding `settlement/*` will also edit `gameState.ts`. **Mitigation:** Track 2 doesn't touch `gameState.ts` at all. Future Phase 2 follow-ons (Dev A's work after Week 2) don't conflict with any concurrent work because Phase 2 follow-ons land one domain at a time and the file shrinks monotonically.

**Risk 4: Dev B blocked on Dev A's workspaces PR.** If Dev A's Day 1-2 workspaces scaffolding PR is delayed, Dev B can't add their `@screens/*` path alias without conflict. **Mitigation:** Dev B can begin the folder move in their worktree using relative imports (`../screens/adventure/adventureView`) and convert to aliases in a follow-up commit. Slows Dev B by ~1 day but unblocks them.

**Rollback:** Each track's work is in separate branches and merges independently. Either PR can be reverted without affecting the other.

## What this plan does NOT cover

- Phase 3+ details (server command loop, DB migration, event cursor polling) — those plans come after Phase 1+2 land.
- Catalog tables (Phase 6 in the Fable plan) — pulled forward into Phase 2 baseline per the OVERVIEW corrections.
- The remaining Phase 2 domains (`settlement/*`, `hero/*`, `turn/endTurn.ts`) — each is its own PR after Track 1's initial economy+charter extraction lands.
- View decomposition — happens as-touched, not as part of this plan.

## Decision needed

Confirm the split and the sequencing. Once confirmed:
- Dev A begins Track 1 (workspaces scaffolding PR) in their worktree
- Dev B begins Track 2 (screens folder-move, starting with the relative-import approach to avoid the Day 1-2 dependency on Dev A's PR)
