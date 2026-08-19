# Issue #88 — remaining command ports (UpgradeBuilding, UpgradeSettlement)

**Date:** 2026-08-17
**Source:** review of `origin/main` @ `889e1ac`, posted to [#88](https://github.com/JLRoper/vigilant-palm-tree/issues/88#issuecomment-5321877326) (retitled to match this narrowed scope). Related race split out to [#114](https://github.com/JLRoper/vigilant-palm-tree/issues/114).

## Background

`mergeFromEndTurn` (`src/game/turnHooks.ts:297-310`) unconditionally overwrites local `heroes`/`settlements` with the server's copy on every `EndTurn`. Seven mutation types now persist to the DB before that hydration runs, making the overwrite harmless for them. Two don't: building upgrades and settlement upgrades never got a command — both trace to the same deferral comment at `packages/contracts/src/commands/index.ts:32`. The issue originally lumped these in with "build/upgrade a building," but they're distinct commands with distinct reducers.

Also confirmed while reviewing: **no test anywhere in `test/` chains "issue command → run EndTurn → re-hydrate → assert the mutation survived,"** not even for the five items already marked fixed (`RecruitHero`, `UpgradeTownHall`, `SetAutoTrade`, `ReorderStack`, `CaptureSettlement`). Each command has isolated happy-path/rejection tests; `EndTurn` has its own separate tests. Nothing proves the persist-before-hydrate ordering holds under regression. §6 below adds this test class for all seven, not just the two new ports.

## Naming

The deferral comment says `BuildStructure`, which implies new construction. No such reducer exists — buildings come from `citySpots` at settlement creation; `startBuildingUpgrade()` only moves an existing building level 1→3. **Name the new command `UpgradeBuilding`.** Reserve `BuildStructure` for real new-construction, if that ever gets built.

## Resolved decisions

**`upgradePopulationGate` (was blocking Track 2):** trust the client-sent value for now. The slider (`src/state/settings.ts:20`, `src/screens/home/settingsMenu.ts:369-375`) is a testing-phase control; spoofing it isn't a current concern. This is explicitly temporary — once the sliders are hidden behind a wall (planned for later in development), the gate should come from a value preset at game-creation time instead of being client-supplied. **Track 2 is unblocked**, but flag the client-trust in the command contract/handler with a short note pointing at this doc so it isn't mistaken for a permanent design choice later.

**City-spot reconcile UX (Track 2):** accept the visible flip. Server-generated `newCitySpots` will differ from the client's speculative local preview and the layout will visibly jump when the command resolves — same as `StartCharter` already does. No client suppression work needed.

## Track 1 — `UpgradeBuilding` (unblocked, mechanical)

`startBuildingUpgrade(state, settlementId, requests)` is pure — no map, rng, or settings dependency. `BuildingUpgradeRequest` already exists in contracts (`packages/contracts/src/gameState.ts:151`). Mirror the `UpgradeTownHall` case (`server/app/commandHandler.ts:622-648`) exactly.

1. Contract `packages/contracts/src/commands/upgradeBuilding.ts`: `{ kind: "UpgradeBuilding"; gameName; actor: PlayerSeat; settlementId: SettlementId; requests: BuildingUpgradeRequest[] }`
2. Register in `commands/index.ts` (import, `export *`, union member); remove/fix the deferral comment at `:32`
3. Add `BuildingUpgradeStarted` to `packages/contracts/src/events/engineEvent.ts` (12th variant)
4. Server case in `commandHandler.ts`: `no_settlement` → ownership check `forbidden_not_your_settlement` (the reducer itself doesn't check) → reducer → `saveHeroesAndSettlements` + `dualWriteEntities` + `eventRepo.append` → `{ ok: true, events, settlement }`
5. `upgradeBuilding()` in `src/io/commands.ts` (copy `upgradeTownHall`'s shape at `:217`)
6. `onUpgradeBuilding` hook on `TurnControllerHooks` + implementation in `turnHooks.ts` with `reportCommandFailure`
7. Fire from `src/state/turnController.ts:531`, after the existing `logEvent` call — using the drain-tracked shape from §7 below, not a bare `void …catch()`

## Track 2 — `UpgradeSettlement` (unblocked)

Needs two things the server doesn't currently compute inline, both with direct precedent in `StartCharter`:

- **`newResourceRates`** ← `computeSettlementRates(map, s.q, s.r, targetLevel).rates`. `StartCharter` already reconstructs `new GameMap(row.seed, row.map_size)` (`commandHandler.ts:770`), byte-identical and pinned by `test/server/gameMapReconstruction.test.ts`. Reuse verbatim.
- **`newCitySpots`** ← `generateCitySpots(cityViewSizeFor(targetLevel), rng)` filtered against `s.citySpots`. `StartCharter` uses `deps.ctx.rng`. Reuse.

`upgradePopulationGate` comes from the client per the resolved decision above.

Otherwise mirrors Track 1: contract `{ kind; gameName; actor; settlementId }` — **`targetLevel` derived server-side** as `s.level + 1`, never client-supplied (same reasoning `StartCharter` uses for not trusting client-supplied ids); `SettlementUpgradeStarted` event; hook; fire from `turnController.ts:542`.

## Out of scope

- The fire-and-forget dispatch race — tracked separately as [#114](https://github.com/JLRoper/vigilant-palm-tree/issues/114). Neither new port should add another bare `void …catch()`; see §7.
- The dead `POST /games/:name/end-turn` route (`server/routes.ts:520`, ~190 unreachable lines) — safe to delete, but as its own PR, not bundled with a command port.
- The charter JSONB-fallback persistence gate — works as designed, not a bug.
- Real new-building construction — no reducer exists; `BuildStructure` stays reserved and unimplemented.

## Race-avoidance requirement for both ports

Neither `UpgradeBuilding` nor `UpgradeSettlement` should add another bare `void this.hooks.onX(...).catch(...)`. Minimum bar for these two ports: register the in-flight promise in a way `handleEndTurn` (`src/state/GameActions.ts:69`) can await before calling `endHumanTurn()` — e.g. a module-level `Set<Promise<unknown>>` with a `drainPendingCommands()` helper, retrofittable onto the six existing call sites without changing their shape. If [#114](https://github.com/JLRoper/vigilant-palm-tree/issues/114) lands its own fix first, adopt whatever mechanism that issue establishes instead of building a second one.

## Tests

- `test/server/commandHandler.test.ts`, per new command: happy path, `no_settlement`, `forbidden_not_your_settlement`, one reducer rejection (`upgrade_in_progress` for both; `max_level` for building, `population_too_low` for settlement).
- **New regression class, for all seven mutation types (the five already "fixed" plus the two new ports):** apply the mutation → run `EndTurn` → re-hydrate → assert the mutation still holds. This is the test that would have caught #88 originally and would catch a regression if persist-before-hydrate ordering ever breaks again.

## Suggested order

1. Land Track 1 (`UpgradeBuilding`) — fully unblocked, closes half the issue.
2. Land the drain/barrier mechanism (either inline here or via #114, whichever lands first).
3. Land Track 2 (`UpgradeSettlement`).
4. Add the cross-cutting EndTurn-survival regression tests for all seven mutation types.
5. Delete the dead `/end-turn` route as its own PR.
