# Changelog

All notable changes to this project are documented here. The app version is the
root `package.json` `version` field; release tags are `v<semver>`. Bump it with
`npm run version:bump -- patch|minor|major`. The in-game toolbar gear (⚙)
dropdown menu's build-info footer shows the version, commit hash and build time.

**minor** marks a real game addition — new content or capability. **patch** marks
a bug fix, a chore, or housekeeping (docs, tooling, tests). The pre-commit gate
chooses between them for you from the intended commit type, and only bumps when
the version has not already been bumped in that changeset.

## [0.49.1] - 2026-11-04

- test(combat): narrow the re-delivery payload instead of spreading the outcome union (1b70696)
- fix(combat): the client adopts a server-voided fight instead of POSTing into the refusal (c871e4a)
- wip(rescue): client adoption of a server-voided fight, recovered after a panel-restart interruption (9123c3f)
- fix(combat): the defender-offer deadline counts idle time, not the offer's age (3f27932)
- test(migrations): rosterParity clears the rows the unit_types FK holds (e693c51)
- District roads: a per-tile road graph with welded junctions, at a legible width (#351) (d9e741a)
- chore(release): 0.48.1 with the cargo-row refusal sentence and the resource-pickup suite (a6cbd3a)
- fix(logistics): the cargo row names the warehouse cap, not empty wagons (269fe5d)
- test(visual): re-cut district-city-view -- chrome only (b7177d2)
- test(e2e): the fixtures CITY P6's House price starved, and the one it moved (49125be)
- fix(docker): pin the compose project name so docker:deploy works from a worktree (fde5161)
- test(e2e): three fixtures that encoded the product of an earlier day (e97e78b)
- chore(release): 0.48.0 with the CITY P6 House rebalance (d8eaffe)
- chore(release): 0.47.1 with the move-cost display fix and the district-map re-cut (1ab3cad)
- test(visual): re-cut the district-map baseline for the panel's cost line (681c9ec)
- balance(engine): the House's price scales with level and pays in wood (762b325)
- fix(ui): the tile panel and toolbar print a move cost, not an IEEE-754 float (b625423)
- test(engine): pin the CITY P6 House rebalance (red before the registry change) (eee810f)
- chore(release): 0.47.0 with the map-derived AI settlement band and browser-tick army growth (4c1c8db)
- feat(ai): wire hero-army growth into the browser-driven AI tick (b9f7859)
- feat(ai): derive the AI's settlement target band from the map (3d6c7cc)
- chore(release): 0.46.1 with the test-runner and cityview fixes (e621d1c)
- test(visual): re-cut the district-map baseline, moved by 827d187 (f69bac2)
- feat(economy): a faction economy modifier, read at income and yield time by one seam (7a0cf42)
- chore(release): 0.45.1 with the test-runner and cityview fixes (130047a)
- fix(cityview): the staffing assertions must wait for a settled value (4cc0b3d)
- fix(test-runner): test:all must say which suites did not run (32c6b06)
- fix(test-runner): the request file must not outlive its run (ebc5791)
- test(visual): pin adventure-overview's boot account, and assert it (db3ced2)
- chore(release): 0.44.0 with AI hero-army growth (9f8a27e)
- feat(ai): AI seats grow their hero armies, and take neutral capitals again (b933f1b)
- feat(districts): derive a district's specialisation from its own buildings (#335) (d70adae)
- test(visual): re-cut the district-city-view baseline, moved by f15a912 (1c56480)
- test(visual): re-cut the city-view-diorama baseline, moved by f15a912 (493739a)
- test(visual): re-cut the city-view-parallax-off baseline, moved by f15a912 (f5c83ee)
- test(visual): re-cut the city-view-parallax-on baseline, moved by f15a912 (290f8e7)
- chore(release): 0.43.0 with neutral capitals garrisoned (3a15004)
- fix(multiplayer): the lobby's seat chips send the seat count they promise, and its AI seats no longer block the start (#330) (872880b)
- chore(release): 0.43.0 with neutral capitals garrisoned (c304eb6)
- feat(engine): neutral capitals start garrisoned (ebee950)
- docs: an unassigned AI seat's roster faction is drawn from the game seed (1ca93a1)
- test(visual): prove each new scene can fail, and label what district-map only records (8584d8b)
- chore(release): 0.42.1 with the exact type-gate baseline (3b3c4aa)
- chore(release): 0.41.1 with the exact type-gate baseline (eb94771)
- chore(release): 0.42.0 with the workforce rebalance that makes the pool bind (7020bad)
- chore(release): 0.41.0 with the workforce rebalance that makes the pool bind (8785813)
- feat(workforce): the worker pool binds at last — divisor 100 -> 300, and the free auto crew is bounded and shown (f15a912)
- chore(release): 0.40.3 with the exact type-gate baseline (786fd8f)
- chore(release): 0.41.0 (74e0ef1)
- fix(test): cityview and logpanel bring their own game, not a substitute (24fd363)
- chore(release): 0.40.2 with AI seats drawing their faction from the game seed (0608d30)
- fix(seats): an AI seat draws its roster faction from the game seed, not "human" (3132f01)
- test(map): pin the generated map digest over every size, version and seed (1341f35)
- chore(release): 0.41.0 (e80d43e)
- chore(release): 0.40.2 with the exact type-gate baseline (fb0fcae)
- chore(release): 0.40.1 with the exact type-gate baseline (5179b54)
- fix(types): the type-gate baseline is exact, not a ceiling (bf248ed)
- chore(release): 0.40.1 with the native prompt() replaced by the app's own text-input dialog (27ee28d)
- fix(ui): the native prompt() freezes the renderer too — the asset-upload key comes from the app's own text-input dialog (985920a)
- chore(release): 0.41.0 -- per-faction troop upkeep (0.40.0 was taken on main) (af2a386)
- …and 330 more commits

## [0.49.0] - 2026-11-03

district roads: a per-tile road GRAPH with welded junctions, at a legible width (was sub-pixel edges)

## [0.48.1] - 2026-11-03

The Logistics window's cargo buttons told the wrong story about why they were dead — and the resource-pickup suite was not part of `npm run test:all` at all.

`cargoTransferRequest` computes `source` — what the source side holds *before* the destination's room clamped it — precisely so a surface can tell "nothing to move" from "no room for it" (`src/screens/shared/cargoTransfer.ts`). The settlement panel's Warehouse row read it; the Logistics modal did not, using one sentence per verb. Measured in a real browser: a hero carrying 250 wood standing on a level-1 settlement whose wood was at its 500 cap saw the modal's dead deposit button say *"the hero's wagons are empty"* while the panel's own row, mounting the same verb off the same shared model, said *"The warehouse is full"* — and the modal's live button carried no tooltip at all, so it never said what a click would move. The player guide already described both as saying so (docs/player-guide.md).

- `src/screens/shared/cargoTransfer.ts`: new `cargoTransferTitle(verb, request)` — one sentence per cargo button in every state of it: what it will move, otherwise WHICH SIDE IS FULL (`source > 0` means the source has goods and the destination has no room). Both surfaces read it now, so they cannot drift into two stories about one click.
- `src/screens/logistics/logisticsModal.ts` reads it for the enabled and disabled states; `src/screens/settlements/settlementInfoMenu.ts` reads it too, with its four strings byte-identical to before.
- Pinned by `test/screens/logistics/logisticsModal.test.ts` (the new case is red on the previous commit: `actual: "the hero's wagons are empty"` at a capped warehouse) and by three cases in `test/screens/shared/cargoTransfer.test.ts`; the settlement panel's existing `test/screens/settlements/cargoTransferRow.test.ts` fixes the panel's wording unchanged.
- `tools/run-test.mjs` + `package.json`: `resourcePickup` is a runner entry now (`ENTRIES` + `ALL_ORDER`, its own ephemeral port pair), so **`npm run test:all` finally runs `test/resourcePickup.e2e.ts`** — it never did, having run directly off `.env` ports outside the chain. The suite itself no longer hides a step behind the debug controller: the hero is selected and moved with REAL mouse clicks on the map canvas (asserted by the client's own `lastClick.moved`), and one pickup and one delivery are each asserted three ways — the DOM, the `GET /api/games/:name` payload and the games row — taking 100 of a 383-wood tile and leaving 283, then moving warehouse wood 300 → 400, then repeating that delivery through the Logistics modal's own button.

## [0.48.0] - 2026-11-03

The House was the strongest building in the game by 112.5x and the largest wood sink in a city, measured by RUNNING the engine on 0.47.0 (main `9b4f17f`): one level-3 House paid 4,500 gold/turn (1,500 population x the L3 tax of 3) for a 100g + 5w placement and 3 wood/turn of upkeep, against the neutral gold mine's 120 gold/turn from a 300g placement. The report that filed the pick said 37-112x; both ends still hold.

The defect is the price, not the grant. The grant scales x5 with level while the House cost a flat 100g to place at ANY level -- the only building in the registry shaped that way -- and it paid for that gold in the resource that is not scarce.

- `packages/engine/src/buildingRegistry.ts`: the House's placement price is 300g (was 100g), so its full path to L3 costs 1,650g, exactly a gold mine's, and its gold/turn per 100g of placement cost falls from 112.5x the mine's to 37.5x (37.5x -> 12.5x against a mine standing on a gold spot; level 1 goes 22.5x -> 7.5x). Its wood upkeep is 2 per level (2/4/6 per turn, was 1), halving the late House's exchange rate from 1,500 gold per wood to 750, and the apartment's grant rises to 150 per level (was 100) so 2x2 housing is less of a trap beside four single-cell houses.
- The population grant is deliberately NOT flattened. The report's own value curve (a flat 300/500/700) halves a built-out level-3 castle's population cap (80,000 -> 40,000) and takes the workforce binding that landed after the report (P2: a pool of 266 against a 275-slot demand) to 133 -- 48% of demand. The three shapes and their exact numbers are in the card's report.
- Pinned by `test/engine/houseRebalance.test.ts` (five cases red on the base commit), with every moved expectation retargeted by name: the House's placement price in `test/engine/placeBuildings.test.ts` and `test/server/commandsRoute.test.ts`, the apartment's grant in `test/engine/districts.test.ts` and `test/engine/housePopulation.test.ts`, the starter set's 12 wood + 2 stone in `test/engine/init.test.ts`, `test/engine/starterLayout.test.ts`, `test/state/economy.test.ts` and `test/state/workforce.test.ts`, and the palette's own upkeep/shortfall wording in `test/screens/settlements/`. `docs/resource-gathering.md` and `docs/settlements.md` carry the new numbers.

## [0.47.1] - 2026-11-03

The tile panel and the toolbar print a movement PRICE, not an IEEE-754 float

The district-road discount (827d187) reaches `GameMap.cost`, so a roaded forest costs `1.2 × 0.75`, which in IEEE-754 is `0.8999999999999999`. The tile-info panel printed it raw — read out of the live DOM on `github/main` 9b4f17f (0.47.0), the line was `Forest · move cost 0.8999999999999999` — and twenty characters of float noise no longer fitted the panel's 202-px body, so every row under it reflowed: the body measured `[23,141,202,92]` with the noise and `[23,141,202,75]` without.

- ONE formatting rule, `formatMoveCost` (`src/screens/shared/moveCost.ts`): one decimal place, trailing `.0` trimmed. It is used at both player-visible movement-cost sites — the tile panel's terrain line (`terrainLine`, which was printing the raw value) and the toolbar's path readout (`formatPathReadout`, which had its own `.toFixed(1)`). One decimal is the granularity the HUD already showed movement at (`Movement 6/7`, `Path 5.8/7`) and the coarsest grid that still separates every price the terrain table can make; whole numbers stay whole, so `move cost 1` and `move cost 2` read as they always did.
- Display only, engine untouched: `GameMap.cost` still returns the exact product. A roaded forest hex stays `0.8999999999999999`; the same four-hex roaded route a hero walks still costs `3` (`test/engine/roadMovement.test.ts`, 8/8) against `4` unworn. No movement or pathfinding maths, no road discount and no MapGenVersion changed.
- The `district-map` visual baseline was re-cut for the reflow it had just absorbed; the DOM reads `Forest · move cost 0.9` with the body back at `[23,141,202,75]`.

## [0.47.0] - 2026-11-03

Three limits of the AI's capital-taking, measured by DRIVING the real server-side driver over real generated boards — not by reading code.

The settlement target band was a fixed radius (8, sqrt-scaled to 12 on a 36x27 map), so a capital 19-20 hexes away was never a target: on seed 12 / `medium` the seat took five of six neutral capitals and then bounced in place for 45 rounds with the sixth at d=20. The reach is now derived from the board's own hex diameter (`aiSettlementReachForMap` = `width + height - 2`, `packages/engine/src/ai/aiBrain.ts`), so a settlement anywhere is a candidate; the enemy band keeps its area-scaled radius and every priority band is unchanged. Same seed, same harness: 7/7 capitals taken by round 14, the sixth reached (d=14 → 9 → 2) and assaulted and won.

- `packages/engine/src/ai/aiBrain.ts`: the settlement target band is map-derived; `SETTLEMENT_REACH` is gone. Pinned by `test/ai/aiBrain.test.ts` (a behaviour case red by assertion on the old source) and `test/engine/aiSettlementReach.test.ts` (the derivation at every size tier).
- `src/state/turnController.ts` + `src/game/turnHooks.ts`: the browser-driven AI tick (legacy/unflagged games) now runs the same hero-army pass the server's `aiDriver` runs — `pickHeroArmyBuildings` → `pickHeroArmyRecruitment` → collect the city garrison onto the hero, plus `pickHeroRefitStep` ahead of the ordinary move — once per round+seat through new optional hooks; a controller without them skips the pass. Pinned by two cases in `test/state/turnController.test.ts`.
- Deliberately NOT changed: the garrison table/strength, `MapGenVersion`, the settlers bare-wilderness invariant, and the army PLACEMENT kind (the power-per-gold "ghoul swarm") — the last is a named balance decision left open, not a defect: the army reaches the target and wins.

## [0.46.1] - 2026-11-03

Two defects that share one symptom: `test:all` could read as a full pass while most of it never ran, and the suite that went red was comparing a value that was still moving.

Re-measured first on `github/main` `872880b` / 0.42.3 (the tree the card names), with the worktree's own ports and a private database (`PGDATABASE=game_poc_suite_red_54a7`): a real `npm run test:all` stopped at `settlers` — `>> run-test FAILED: [settlers] exited code=1 signal=null`, after `AssertionError: no passable neighbour of the wagon landed inside the map area` (`test/settlers.e2e.ts:263`, reproduced in the chain, on its own, and twice) — so `towncenter`, `visual` and `npm run test:unit` never ran and nothing in the output said so.

- `tools/run-test.mjs`: the request file outlived its run. The runner wrote `local/.test-request.json` for its entry and then `process.exit()`ed INSIDE the `try` that owns `finally { clearRequest() }` — `process.exit` skips a pending `finally` (verified in isolation), so the file stayed behind carrying the dead run's ports. Measured: a wrapper entry that failed after 15s left `{entry:"settlers",apiPort:57305,clientPort:57306}` on disk; a direct run started 13.7s later reported `loadRequest -> HONOURED` and resolved `api=57305 client=57306` while the environment said `56776/56777`; and `npm run test:settlements` (a DIRECT run, `test/settlements.e2e.ts` spawns its api with `API_PORT` from that file and its vite without one) came up on the dead run's `65020` while vite proxied `.env`'s `56776`, so the page's calls died `connect ECONNREFUSED 127.0.0.1:56776` and the suite failed `TEST FAILED: locator.waitFor: Timeout 10000ms exceeded` at `openGame`. The same run with the file removed was `api listening on http://127.0.0.1:56776` and `settlements.e2e: ALL TESTS PASSED`. The file is now cleared on every exit path (the exit code is applied after the `try/finally`, plus a `process.on("exit")` cleanup and signal handlers), and a run clears any predecessor's file before it starts.
- `test/_request.ts`: a request file is honoured only when it carries the token `tools/run-test.mjs` handed THIS process through `HEROES_TEST_REQUEST_TOKEN` (`requestIsOurs`); the 30s mtime window stays as a backstop. A direct run holds no token, so no leftover file can resolve its ports however fresh it is — and a wrapper-driven entry always holds one, so nothing legitimate is lost. `test/_envGuard.ts`'s note now says the by-hand probes must be given explicit ports.
- `test/helpers/commandBarrier.ts` (new) + `test/cityView.test.ts`: the worker-drag step's staffing assertion was reading a value mid-flight. The client commits with fire-and-forget POSTs and the API answers only after that command's transaction has committed, so the suite's reads sampled while a command was still running: measured with in-flight counters, the recruitment-accordion waits entered with 2 `AssignWorkers` POSTs outstanding (max 30 during the panel storm), and with a 6s hold inserted inside the command's transaction the SAME tree failed at `server staffing never matched [{"gx":0,"workers":1},{"gx":3,"workers":1}]; last=[{"gx":0,"workers":2},{"gx":3,"workers":0}]` on one run and `never matched [{"gx":1,"workers":2},{"gx":3,"workers":2}]; last=[{"gx":1,"workers":1},{"gx":3,"workers":1}]` on the next — the failing expectation moved between two runs of an identical tree. `seedWorkforceFixture`, `serverSettlement`, `serverDraft` and `waitForServerStaffing` now wait for the page's command POSTs to have been answered first, and the 5s budget starts after that settlement, not before it. No assertion was weakened and no suite was deleted.
- `test:all` reports the truth: the chain continues past a red entry and prints a per-suite verdict for all 17, a passed/failed/did-not-run count, the `DID NOT RUN:` list, and — when a suite is red — that `npm run test:unit` did not run behind it. `--stop-on-fail` keeps the old abort behaviour and still names everything it skipped.
- Pinned by `test/core/requestOwnership.test.ts` (a foreign-token file is ignored however fresh; the run it was written for still takes its ports from it; the grace window still applies), `test/core/runTestHarness.test.ts` (spawns the real runner: no request file left after a green run or a red one; the not-run line names exactly the suites after the failure, in chain order) and `test/core/commandBarrier.test.ts` (the barrier resolves on the response and not before, reports a timeout instead of hanging, plus the invariant that the suite still gates those four helpers). Each fault was put back to prove the pins bite: the old exit path makes both request-file pins fail (`\`all\` left local/.test-request.json behind with its dead ports on it`), and removing the two gates makes the site pin fail (`serverSettlement no longer waits for the page's command POSTs before touching the server's row`).

## [0.46.0] - 2026-11-03

Faction economy: one optional FactionDef.economy table read by one seam (economy/factionEconomy.ts) at income and yield time -- Ironmark iron/stone/gold, Verdant food/wood, Ashen gold/arcane, each with a penalty, human neutral by default.

## [0.45.0] - 2026-11-03

AI seats grow their hero armies, and with them take neutral capitals — the other half of the garrison change. Measured on a real `POST /games` board (seed 12 / 36x27 medium, the AI spawning four hexes from a capital), driven round after round: the seat's hero army went **132 -> 348 power** and the seat **took five neutral L3 capitals by assault over rounds 5-11**, where an untouched tree leaves the AI's force frozen at 132 and every 168-power capital neutral forever.
- `packages/engine/src/ai/aiBrain.ts`: `HERO_ARMY_TARGET_POWER = 346` (the player's own realistic force at the turn it can first reach a capital — 216 starting power + the 13 swordsmen / 2,600g the garrison table was sized against; measured with `resolveBattle` against that garrison: 216 loses 12/12, 346 wins 12/12), plus three planners that take the player's own route to it — `pickHeroArmyRecruitment` (buy from the seat's city through the same building/draft gate and power-per-gold rule the garrison planner uses), `pickHeroArmyBuildings` (more recruit buildings through the city view's own `PlaceBuildings` cart when the draft pools cannot cover the deficit) and `pickHeroRefitStep` (walk home while the city holds troops). Settlers mode and covered wagons are excluded by both halves.
- `server/app/aiDriver.ts`: a once-per-round+seat army section (recruit -> transfer onto the hero), collect-on-arrival inside the sweep so a hero that walks home mid-turn takes its reinforcements the same turn, and the refit errand ahead of the ordinary plan. Before it, neither driver ever grew a hero's army, so `attackerBeatsGarrison` (1.5x = 252 against the 168-power garrison) declined every neutral capital.
- Tests: `test/ai/aiBrain.test.ts` pins the two planners and the refit errand (sizing to the deficit, the waiting garrison counting against it, free city cells, no errand without waiting troops); `test/server/aiDriver.test.ts` pins the driver end to end — recruits into the city, transferred onto the hero, its army actually grown, the capacity commit, and the settlers no-army invariant. Proven red before the change by disabling the section in place: "the hero's city was recruited from" and "one cart commit, exactly like the city view's" (0 !== 1). Four existing driver pins that count `RecruitUnits` now count both spenders, and the W5 classic byte-identity pin compares the stream with the deliberately-added hero-army block stripped out and asserted beside it.

## [0.44.0] - 2026-11-03

a district's specialisation is derived from its own persisted buildings, and pays a scaling bonus the player can see

A district had no identity: nothing in the game read a building's neighbours, so every district was the same flat pool of producers. Specialisation is now DERIVED from what a district already persists — there is no district-type field to set, no schema change and no migration. `districtSpecialisation` (`packages/engine/src/settlement/districtSpecialisation.ts`) counts a district's completed producers on ONE production chain (the chain is the resource they make, so the food chain is `farmField` + `farmhouse` + `granary`; a `mine` reads the district's own spots). A district qualifies only with at least 4 of them AND at least 60% of its buildings on that chain, and the effect then ramps with the share from 0 at the threshold to 25% at a district that is entirely one chain. The effect is paid on the chain and taken off every other chain the district produces, so the choice is real rather than free.

Measured before and after, against a scratch export of `github/main` (`6cbf138` / 0.43.0), running the same scripts on both:
- 12 seeded map seeds, 72 settlements: every settlement's buildings, districts, rates and gold are **byte-identical** — the diff is silent. A seeded district holds 2-3 distinct kinds, so the four-producer bar is what makes this structural rather than lucky.
- A hand-built MIXED district (hut, mine, farm, house) is **unchanged** (wood 3, stone 3, food 6, gold 0); three farms + a house is **unchanged** (food 15).
- Four farm fields go `food 19 -> 23`; four farms + a house (4 of 5) go `19 -> 21`.
- Four farms + a level-1 `goldMine` trade `+2 food` for `-6 gold` (`gold 45 -> 39`); with a level-3 mine, `+2 food` for `-16 gold`. A district that hosts a valuable off-chain producer is a bad place to specialise — the bonus is sized against the district's own off-chain output.
- The adjustment is computed on a chain's TOTAL rather than per producer: a level-1 producer pays 2-6 units and a fractional per-producer multiplier on those is swallowed by the payment loop's per-addition rounding (measured: per-producer scaling paid `food 22` where the headline said `19 + 25%`).

`districtProductionLines` (`packages/engine/src/settlement/produceResources.ts`) is the single place a district's buildings become output, and both `produceSettlementResources` and `settlementProductionRates` walk it, so the rate a player reads cannot drift from the rate the turn pays. A district that is not specialised emits not one line more than it did before.

- `packages/engine/src/settlement/districtSpecialisation.ts` (new): the derived rule, the constants (`DISTRICT_CHAIN_MIN_PRODUCERS` 4, `DISTRICT_CHAIN_MIN_SHARE` 0.6, `DISTRICT_CHAIN_MAX_EFFECT` 0.25), the scale, and `districtSpecialisationLabel` — the words and the multiplier are one source of truth.
- `packages/engine/src/settlement/produceResources.ts`: `districtProductionLines`, and both district loops rewired onto it.
- `src/screens/settlements/cityView/CityDesignBoxManager.ts` + `cityView.ts`: the specialisation is the City Design panel's status line — the one panel on screen for every district open — `Food district — 4 of 4 buildings on one chain: +25% food, -25% other chains here`, or `No specialisation — 3 of 4 buildings on the food chain; 4 needed`. Verified in the running client on the worktree's allocated ports against a private DB.
- `docs/settlements.md`: the rule, the bars and the measured numbers.
- `test/engine/districtSpecialisationProduction.test.ts` (new) imports only pre-existing exports, so it goes RED on the old engine by assertion (3 of 6 fail: `19 !== 23`, `19 !== 21`, `20 !== 23`) with the neutrality cases green on both sides; `test/engine/districtSpecialisation.test.ts` (new) pins the derivation. Unit suite: base 2758/0, this branch 2776/0.

## [0.43.0] - 2026-11-03

neutral capitals start garrisoned: 12 pikemen + 4 archers (16 troops, power 168) seeded on every neutral L3 capital, so walking in is refused (garrison_not_defeated) and the assault flow is the way through

## [0.42.3] - 2026-11-03

The multiplayer lobby's seat chip row reaches the wire: its choice rides `POST /games` as an explicit seat count, the seats no human fills are AI combatant seats, and a lobby's AI seats no longer block the start.

- `src/screens/multiplayer/multiplayerLobby.ts`: the Create Lobby handler passed only the human count to `api.createGame`, and `POST /games` builds the lobby's seats from it (`const seats = explicitSeats ?? (humanCount !== null ? humanCount : null);`), so the chip row's own choice was discarded -- measured live in a foregrounded tab: 4 seats with 2 human players produced `lobby.seats 2`, which is why the chip had been hedged to "Maximum seats". The chip's count now rides the create request as `lobby.seats`, `enemySlots` is derived from the seats the humans do not fill, and the chip reads "Number of seats (2-4)". The human count input keeps its meaning (1 to the number of seats) and the home Create Game screen's own "Number of human players" chips are untouched.
- `server/routes.ts`: the start gate required a claim on every seat in `[0, lobby.seats)`, so a 4-seat lobby with 2 humans could never start (409 `seats_unclaimed`, `missing [2,3]`). It now skips a seat whose player is an AI combatant -- the same fact `availableSeats` already reads off the row -- so the lobby starts on its human claims alone, while an unclaimed HUMAN seat still blocks it.
- `src/io/api.ts`: `createGame` gained the optional explicit seat count; a caller that passes none sends a byte-identical body, so the home, starter and SessionManager paths are unchanged.
- Measured before and after through the real client, on a private DB (`PGDATABASE=game_poc_mpseats`) over the worktree's own allocated ports: before, the create body was `{"humanSlots":2,"enemySlots":0}` with no seat count and the row read `seats=2, players [player, player]`; after, the 4-and-2 pick sends `{"humanSlots":2,"enemySlots":2,"lobby":{"seats":4}}` and the row reads `seats=4, humanSlots=2, players [player, player, ai, ai]`, while the 2-and-2 pick is unchanged (`seats=2`, no AI seats). The 4-seat lobby starts once its two human seats are claimed, and its grid names the two AI seats instead of offering them.
- Pinned by `test/screens/multiplayer/lobbySeatCount.test.ts` (drives the real screen and reads the create request body the server sees -- red before, green after) and by the explicit-seat-count case added to `test/multiplayer.smoke.ts` (red at the base with exactly that 409, green with the gate fix); `docs/multiplayer.md` and `docs/architecture.md` are updated where they said `seats` stays = humanSlots and that the LAN lobby path sends no `enemySlots`.

## [0.42.2] - 2026-11-03

- **`test:cityview` and `test:logpanel` stop depending on the load-path substitution #307 removed, and bring their own game instead.** Both suites were green on 0.39.8 only because the client started a `starter-*` game for them: a boot on an empty `localStorage` cache silently substituted one (`GameSessionManager.initBackend`), and the suite drove whatever that put on screen. #307 (`dfc6a64`, "never substitute a starter game for a failed or empty load") made that conditional on the SERVER's list being empty — correct for a player, fatal for a suite that never opened a game itself. Neither suite is in #307's file set; the runs are the evidence, all on one database that already held a game (which is every real worktree DB):
  - `test:logpanel` on main `3f76d57` / 0.39.12: `TEST FAILED: page.waitForFunction: Timeout 30000ms exceeded.` before step 1 — step 1 waited for `__gameDebug.activeGameName != null` after `localStorage.clear()` + reload, and nothing was loaded any more. On an EMPTY account, same commit, same suite: green, with the API log showing the boot POSTing `starter-mw0b4psd` itself.
  - `test:cityview` on the same commit: green on the first run against an empty account, then `TEST FAILED: server staffing never matched [{"gx":1,"workers":2},{"gx":3,"workers":2}]; last=[{"gx":1,"workers":2},{"gx":3,"workers":1}]` on the next run, because with no substitute the suite took the first row of Load Game and drove a save an earlier run had left half-played.
  - The flip, on the commit on either side of `dfc6a64` with the same primed DB: `4d7293e` (parent, 0.39.8) `logpanel` PASS and `cityview` PASS twice — the client POSTed its own starter (`starter-mw0bxjsq`/`starter-mw0by5hp`) with the server's games sitting right there; `dfc6a64` (0.39.9) `logpanel` FAIL at the same 30s wait and `cityview` green-then-red.
  - The fix is in the suites, and the substitute stays gone: each suite now creates its own game through `POST /api/games` BEFORE the client boots (so the account is never empty and the client has no reason to start one), opens it by name from home's Load Game — never "the first Open row", which is what handed cityview someone else's save — and matches the opened name in `__gameDebug.activeGameName`. `cityview` deletes its own game when it passes and `logpanel` keeps deleting its own at step 7, so neither leaves saves behind.
  - Verified by the fix's own runs, against a database that held another run's played game (`prime-845e01`): both suites green repeatedly, together with `build`, `lint:deps`, `docs:check`, `tools/typecheck-gate.mjs`, `test:unit` and `test:settlements` as the neighbouring control.

## [0.42.1] - 2026-11-03

the type-gate baseline is exact: the 7 phantom settingsMenu errors are pruned, a stale entry now fails the gate, and --write-baseline refuses to raise a count or add an entry

## [0.42.0] - 2026-11-03

the workforce binds: WORKFORCE_PER_POPULATION 100 -> 300 so a fully built-out L3 castle must choose what stays dark, and the free auto crew is bounded to the bootstrap and shown

## [0.41.0] - 2026-11-03

Per-faction troop upkeep: the three non-human rosters pay their own bill (migration 037)

## [0.40.2] - 2026-11-03

an AI seat draws its roster faction from the game seed, so a default single-player game can meet the Ashen Court, the Ironmark Holds or the Verdant Wild instead of every AI seat being pinned to "human"

The report's claim was re-measured at current `github/main` before anything changed: only the creator's seat ever took a roster faction, because `GameSessionManager.handleNewGame` padded every other seat with an EXPLICIT `"human"` (lines 149-155 there) and an explicit entry wins in `makePlayers`. The architect's cited `140-147` is the function's head; the forcing lines are `149-155`, with seat 0's assignment the first element of the array at `154`. So the Ironmark/Verdant battle-screen differences the report measured were unreachable in a game the player could actually create.

- `packages/engine/src/seatFactions.ts` (new): `SEAT_FACTION_IDS` -- every registry faction with a shipped roster, the same rule the New Game picker uses (`neutral` is catalog-only wild creatures and is never a seat) -- and `aiSeatFactions(seed, count)`, a seeded Fisher-Yates over it keyed by `mulberry32(hashString("seat-factions:<seed>"))`. A per-purpose FNV-1a hash, the repo's standing seeded-draw pattern (`map/resourceTiles.ts`, `settlement/citySpots.ts`), never `Math.random`; it spends no draw of any shared rng, so no existing seed's names, variants, spots or castle positions can move. Drawing WITHOUT replacement is what makes it varied by construction: two AI seats can never share a faction, so a default two-AI game always meets a non-human one rather than only on most seeds (proved over 500 seeds).
- `init.ts`: new `BuildInitialOptions.aiSeatFactionSeed`. When present, `resolveSeatFactions` fills every AI seat the request did not assign from that seed and leaves human seats exactly as they were -- the creator's own pick is an explicit entry and always wins. ONE resolved array feeds both `makePlayers` (the seat's roster faction) and `seedStarterBuildings` (that seat's starter troop building), so an AI seat can never fight its own roster with the Crownlands' starter city. Absent, every seat is byte-identical to before, which is what keeps offline callers and the existing fixtures unchanged -- the engine's own snapshots are untouched by this changeset.
- `server/routes.ts`: `POST /games` passes the game seed ALWAYS, not only when a faction was picked, so the assignment is a property of the game and reproducible from its seed alone. `src/managers/GameSessionManager.ts` now sends the creator's pick alone instead of padding the array with `"human"` fillers -- the filler WAS the bug.
- No combat, unit stat or roster change: the factions, rosters and starter buildings are the ones already shipped (024/025/026). The lobby's own surfaces are untouched -- neither the New Game form nor the multiplayer lobby shows a faction per seat (both offer the single "Your faction" choice), so nothing was added to them; what changed is what the created game records, which is what the AI seats now actually use.
- Measured over the real route twice. (a) Against a live api on a private DB (`PGDATABASE=game_poc_ai_seat`, its own port): `POST /games` seed 20261003, humanSlots 1 + enemySlots 2, `seatFactions ["verdant"]` -> the persisted row reads `0=verdant (the pick kept), 1=ironmark, 2=human`, and a second game on the same seed reads back byte-identical; with no pick at all (seed 4242) -> `0=<no factionId key>, 1=ashen, 2=ironmark`. (b) Through the real client: `npm run dev` on the worktree's allocated ports, the New Game form driven in a browser (name, seed 20261003, "Number of AI enemies" 2, "Your faction" The Verdant Wild, Create Game), twice -- both games persisted `["verdant","ironmark","human"]`. Pinned in-tree by `test/server/createGameRoute.test.ts` (the same route, the same seed twice, the persisted players read back with SQL) and `test/engine/seatFactions.test.ts` / `test/engine/init.test.ts`; the route tests go red when the source change is stashed (27 pass / 2 fail) and green with it.

## [0.40.1] - 2026-11-03

fix(ui): the native prompt() freezes the renderer too — the asset-upload key comes from the app's own text-input dialog

The Asset Manager's **Upload PNG** asked for the asset key with a native `prompt()`. Measured in a real browser at this tip, tab foregrounded (`document.hidden === false`): the file-input change dispatch that raises the box never returned (`Runtime.evaluate timed out` at 5 s — the box opens inside the handler), every `Runtime.evaluate` — `1+1`, `location.href`, a plain counter read — timed out at 5 s while the box was up, `Page.handleJavaScriptDialog` answered `{}` (an empty object: a dialog really was pending) and unwedged the tab instantly, and the animation loop stood still for **15 555 ms** between two consecutive frames where the next-largest gap in the whole recording was 12 ms (393 ticks landed in the 2.0 s before it). The `alert()` and `confirm()` sites were fixed the same way in 0.39.18 and 0.39.7; this is the last one, kept open by the other two cards because it needs a text-input dialog.

- **The fix.** `openTextInputDialog` joins `openConfirmDialog` in `src/screens/shared/confirmDialog.ts` — the same `openDialog`/`FloatingPanel` surface, the same message block and button strip (both now shared private helpers, so the two dialogs cannot drift), Escape and teardown via `panelManager`. No second dialog idiom, and no new file to fork one into.
- **The z-index.** The call site passes 320: the Asset Manager is itself a dialog at 300, and the helper's default 120 is under it (and under the landing overlay's 200) — at the default the key prompt would be one the player can see but not click.
- **Nothing else moved.** The pre-filled key is still the file name minus `.png` (focused with its value selected, so typing replaces it), an empty or cancelled answer still aborts before the status line or the network is touched, the resume path still uploads under the typed key and re-lists, the dialog closes itself on every path, and the key is never logged.
- **After**, same call site, same browser, same foregrounded tab: the change dispatch returned in 0.017 s (was: timed out at 5 s), the dialog is in the page at `z-index: 320` with the question verbatim, the field pre-filled `castle.9` and selected, and buttons `Cancel`/`Upload`; the renderer stayed live while it was up (**480 rAF ticks** in the same 2.0 s window, was 0); zero native `prompt()` calls recorded; `Cancel` closed it with 0 assets and no request (481 ticks after); and a real pointer click on `Upload` after typing `assetman.1` over the pre-filled name uploaded under **that** key (`GET /api/assets` → `{"key":"assetman.1","mime_type":"image/png","byte_size":12}`), cleared the file input and re-listed the manager, still with zero native prompts (466 ticks after).
- **Tests.** `test/screens/home/assetManagerUploadKey.test.ts`: the browser's own `prompt()` is never reached, the dialog is mounted above the manager rather than at the helper's default 120, the question and the pre-filled key still reach the player, no upload happens on the prompt alone, cancelling uploads nothing and leaves the input re-armable, confirming uploads exactly the typed key and re-lists, and an empty key aborts before the status line moves. 4/4 fail against the old call site (`actual: [ 'Asset key (e.g. castle.1):' ], expected: []`), 4/4 pass against the fix.
- **In the app's own idiom, deliberately.** It is buttons plus a focused field, as the app's other text dialogs are (`charterModal`, `settlementInfoMenu`'s bank amount) — Enter is not wired, because no other text dialog in this app wires it.

## [0.40.0] - 2026-11-03

district roads now price movement: entering a roaded hex costs ROAD_MOVEMENT_MULTIPLIER 0.75x its terrain cost, a modifier on the engine's one movement-cost table (GameMap.cost) derived from the live settlements -- no second cost path, no terrain value or MapGenVersion change

## [0.39.18] - 2026-11-03

fix(ui): the native alert() freezes the renderer too — the landing page's backend-offline notice is the app's own dialog

The landing page's Multiplayer button, with the API down, raised a native `alert()`. Measured in a real browser on this tip, tab foregrounded (`document.hidden === false`): the click never returned (`Input.dispatchMouseEvent` timed out at 5s — the box opens inside the click handler), every `Runtime.evaluate` — `1+1`, `location.href`, a plain counter read — timed out at 5s, `Page.handleJavaScriptDialog` answered `{}` (an empty object: a dialog really was pending) and unwedged the tab instantly, and the animation loop stood still for **10 026 ms** between two consecutive frames where the next-largest gap in the whole recording was 9 ms (481 ticks landed in 2.0 s either side). Dialog-free automation got a dead tab and a player got a frozen game. The three `confirm()` sites were fixed the same way in 0.39.7; this is the sibling the same card left open.

- **The fix.** `src/screens/home/homeView.ts`'s offline notice routes through the `openConfirmDialog` helper those `confirm()` sites already use (`src/screens/shared/confirmDialog.ts`, wrapping `openDialog`/`FloatingPanel` — backdrop, Escape, teardown, `panelManager` registration). No new dialog idiom, and it stays a NOTICE rather than a question: nothing is confirmed and nothing is cancelled, both buttons only put the box away, and the handler resumes exactly as before.
- **The z-index, the one option the site needed.** The helper's default (120) keeps a prompt under the landing overlay — right for its original map callers, but this button sits ON that overlay (200), so the notice passes 220. At 120 it would be a dialog the player can see and not click, exactly the trap the two home-screen `confirm()` sites hit.
- **After**, same call site, same browser, same foregrounded tab: the click returned in 0.01 s, the notice is in the page at `z-index: 220` with the message verbatim and buttons `Close`/`OK`, the renderer stayed live while it was up (478 rAF ticks in the same 2.0 s window, was 0), zero native `alert()` calls recorded, and `Close`/`OK` each dismissed it with the page still running (487 ticks in the next 2.0 s) and the button still working.
- **Tests.** `test/screens/home/homeBackendOfflineNotice.test.ts`: the browser's own `alert()` is never reached, the message still reaches the player, the notice is mounted above the landing overlay rather than at the helper's default 120, offline never opens the lobby, and — the resume proof — the same button with the backend up opens the Multiplayer Lobby. 3/3 fail against the old call site, 3/3 pass against the fix. `test/helpers/mockDom.ts` gained `window.location.origin`, which the lobby reads when it prints its join URL.
- **Left alone, on purpose.** `prompt()` at `src/screens/home/assetManager.ts:180` blocks the renderer the same way but needs a text-input dialog that does not exist yet. `rg '\balert\s*\(' src test tools packages server` finds exactly one `alert()` site, and it was this one.


## [0.39.17] - 2026-11-03

test:visual sees districts, the district road network's host and the Load path -- and the two main-side breakages it was standing in front of

- Three new scenes, shaped exactly like the ten (same runner, Chromium from the repo's install, the 0.5% threshold, never client port 5173): `district-map` settles every affordable hex of the L1 settlement's ring through the real City Design flow (double-click the hex -> build palette -> click a cell, the path test/districts.e2e.ts drives), asserts the settlement really HAS districts, then zooms the camera to its maximum so the district sprites and the settlement road network -- which only renders once a district holds a building -- are both on screen; `district-city-view` captures the district's own 5x5 grid with real buildings placed from the real palette, distinct from the settlement city-view captures, which open a fresh, un-districted settlement; `load-path-adventure` is the suite's first scene to RELOAD the page and drive the landing Load list (reload -> Load Game -> Open -> GameSessionManager.loadGame -> the loaded view) and to assert the load camera's own contract before it captures.
- Each new scene is proven NOT blind, one surface per scene, by perturbing that surface, watching it go red against the baseline THIS changeset ships, then restoring: `districtTierForCount` returning 2 for a 1-building district -> district-map FAIL 1.773% (18158/1024000 px), the other twelve green; `cityScene` dropping every placed building -> district-city-view FAIL 1.038% (10633 px), and the three settlement city-view scenes with it (5.187 / 5.178 / 5.143%, the same scene builder paints those grids), the other nine green; `resolveLoadCameraCenter` forced to the map centre -> load-path-adventure throws "Load path did not frame the seat hero (9,7): off by 180.1,72.0 (tolerance 64px)"; forced to the classic spawn constant {q:6,r:5} -- the regression the load camera was written for -- -> throws "off by 80.5,32.0 (tolerance 64px)".
- The Load-path camera assertion keeps its tolerance, earned rather than assumed. `centerOn` clamps the camera to the map's own extent (20ba763), so on the 24x18 small map at zoom 1 in the 1280x800 viewport the seat hero cannot land on the centre: the desired y is 400 - 32*1.5*7 = 64, the clamp band is [800 - 848, -(-32)] = [-48, 32], so y = 32 and the hero lands 32 px above the centre -- the offset the assertion itself reports (0.0,32.0). Measured on BOTH sides of the number: the clamp alone accounts for 0.0,32.0 and the smallest wrong-target offset measured is 80.5, so 64 sits inside that window with room on each side. The x axis is what discriminates on this fixture; the y axis cannot (a wrong target and the clamp both read 32.0 there).
- test:visual could not run AT ALL against the merged tree before this change: #307's boot reads GET /api/games first and starts a game only when the server says the account holds none, so with games on the shared dev DB an empty browser profile leaves activeGameName null and the suite's `newPage` spun to its 20 s timeout before the first scene ("page.waitForFunction: Timeout 20000ms exceeded"). It now waits on the app -- the debug API attached and home's own New Game button visible -- the same fix #307 made to test/smoke.ts, weakening nothing.
- Six baselines were STALE ON MAIN, not on this branch. Measured before touching them, on a tree carrying github/main: adventure-overview / charter-traveling / charter-constructing diffed 14.289 / 14.293 / 14.302% and city-view-parallax-on / -off / -diorama 0.866 / 0.842 / 0.842%. A pixel probe of the old adventure-overview baseline against a fresh capture aligns the map region best at dy = -32 -- the camera clamp, nothing else. Two commits landed without re-baselining: 20ba763 (the clamp; NOT an ancestor of c242ff8, the commit that last re-baselined that image, and an ancestor of main) and 821e906 (the hero panel's transfer buttons now read "Withdraw gold", while github/main's committed adventure-overview.png still shows "Withdraw all" -- two artefacts of the same commit cannot both be right). The nine images in this changeset are regenerated against the merged tree, each with its cause named: those six (the clamp and the button labels), district-map and load-path-adventure (captured before this branch was merged onto main, so they predate both), and district-city-view (the Building Palette overlay is inside that capture -- the scene opens it before grabbing the canvas -- and main's new palette rows, "the palette row states its build time" and the grid-space refusal, change it). test:visual is 13/13 green on two consecutive runs, every scene at 0.000-0.001% mismatch.
- The district ROAD BAND itself remains a measured limitation, not a covered surface: repainting ROAD_SURFACE moves 55 px at gameplay zoom and 861 px at maximum zoom with a settled district ring, against the 5,120 px the 0.5% budget needs. The band is 0.55-1.5 px wide, under one screen pixel at every gameplay zoom (docs/settlements.md "Map visualisation"), so it is recorded as measured rather than claimed as covered.

## [0.39.16] - 2026-11-03

The multiplayer lobby's seat chip row and its human-player count input no longer share one label: the chips read "Maximum seats (2-4)" and the input "Number of human players (1 to the maximum seats)", each with its own accessible name.

## [0.39.15] - 2026-11-03

the settings panel's eight slider rows are built by one labelled-slider-row helper that constructs each row's name line and its slider together, so a row can no longer be built without its name -- the round-4 F1 defect was one row doing exactly that while the others were fixed around it. No behaviour change: the rendered panel is byte-identical before and after, and the settings suite pins the shape (27 checks, was 26).

## [0.39.14] - 2026-11-03

games.turn is gone: a column written once by its own DEFAULT 1 (POST /games' INSERT never named it) and read by nothing, so every save claimed "turn 1" while the round advanced -- 329 games on the shared database held one distinct turn value against rounds up to 1996, and driving End Turn across two real seats took the round 1 -> 4 with turn never leaving 1. Dropped in server/migrations/036_drop_games_turn.sql, removed from schema.sql, from GAME_COLUMNS/GameRow/FullGameRow and from the client's Game payload, with the drop pinned by a new test/migrations/migration.test.ts case. The round (with day and active_player_id) is the only progress field a save carries. No turn or round semantics changed.

## [0.39.13] - 2026-11-03

fix(events): a caravan's whole journey reaches the log, so a client that is not driving it can react

F7 (a caravan's whole journey was silent in the event log): a card bought a wagon, accepted a recommended route and watched the real caravan load at its origin, walk seven tiles a day (`pathIndex` 0 -> 7 -> 14), land 50 food in its hero's larder (0 -> 50) and turn for home (`phase` `toHome`, `anchored` true) — and across four wraps the game appended nothing but `TurnEnded` and the three audit kinds. Re-measured on the real tip by driving the `EndTurn` command day by day (`appended=[TurnEnded,turn_ended,round_ended,round_started]` on every wrap, the load included). The verdict, read off the writers and the consumers: the load, the delivery and the turn for home are all real facts, and none of the three is derivable from a variant that already exists — no event carries a caravan's record, and none carries a settlement or hero store change caused by logistics. What did carry the larder change was the `TurnEnded` full-refetch resync, i.e. a boundary, not a row.

- **The event.** `CaravanAdvanced` (contracts): one row per route per wrap, carrying the route's post-wrap `caravan` record **verbatim** — the applier assigns it, because a leg's path is A* over the rebuilt map plus whatever of the wrap's movement budget the delivery left over, so no replay can re-derive one (the `TradeRouteCreated` routeId rule) — plus `loaded`/`delivered` in the payload's own units. `delivered` is exact: it is the outbound leg's cargo drop while the destination was still deliverable, so a death-return that also reaches home in the same wrap reports 0, not a phantom delivery.
- **The source.** Emitted in `server/app/commandHandler.ts`'s `EndTurn` case, right where `TradeRouteRemoved` is derived, from a new `caravanAdvances(before, after)` beside `removedTradeRouteIds` in `server/app/turnService.ts` (each route's record diffed across the pipeline). `advanceTradeRoutes` gained no event sink and no signature change — the movement pass stays a pure reducer, and no movement, timing, pathing or route rule changed.
- **The client path.** `CaravanAdvanced` is classified `apply` (targeted construction: an already-held record is a noop, an unknown route a resync, never a fabricated route) and admitted by `isBridgedDelta`, so a client that is not driving the turn holds the cart's new leg from the stream alone: `test/io/caravanJourneySync.test.ts` delivers the row as an `event: log` frame through the real `MultiplayerSync` into a real `TurnController` and asserts the leg is held with **no refetch**. The endpoint **stores** are deliberately not carried (a lost origin reroutes a return load to a settlement a route-level diff cannot name) and keep the `TurnEnded` boundary rule — no second source of truth for the larder.
- **Tests.** `test/server/caravanJourneyEvents.test.ts` (the rows the `EndTurn` case appends: the load, the seven-tile day, the delivery with the turn for home in one row, the arrival home, the wrap that moves nothing, and the death-return corner) plus `test/io/caravanJourneySync.test.ts` plus the updated `test/engine/syncClassification.test.ts` counts (31 variants, 16 apply). Both new files fail before the change: emitter reverted -> the appended kinds read `[TurnEnded, turn_ended, round_ended, round_started]`; applier reverted -> the listening client stays on the stale outbound leg.
- **Surfaces.** `game_events` -> SSE/poll -> `MultiplayerSync.lastSeen` + `EntityMirror` -> `garrisonEventBridge` -> the live `TurnController` (verified by the tests above), and the Log Panel, which needs no change (its row rendering is kind-agnostic).

## [0.39.12] - 2026-11-03

- **The settlement, city-view and logistics panels stop stating what is not true (playthrough round 2b, E1-E7, plus round 4's F6).** The per-day rate rows are now the rate the turn PAYS (each producer rounded the way `produceSettlementResources` rounds it: the Gold hold's wood really moved -2/day where the row read -2.89, and food +15 where it read +15.72); a full STORE says it is discarding production, with the same amber row, tooltip sentence and one-time End Turn toast the treasury cap already had (`src/screens/settlements/warehouseCap.ts`); the town-hall upgrade states that it levels the WHOLE city and what that does to the daily upkeep (11 wood + 2 stone -> 22 wood + 4 stone on the card's city); the build palette refuses a row the grid has no room for (a level-1 starter city has no free 2x2 anchor at all) and states each row's build time and the upkeep it pays while it builds; a landed placement leaves no stale refusal line (pinned, not reproduced); the logistics heading no longer reprints the player's wagon pool under every settlement; and a trade recommendation names the SHORTFALL instead of the stock it is short of ("Larder short by 2 food - 3 in the larder, 5 food/wk army").
- Docs: `docs/settlements.md`, `docs/player-guide.md` and `docs/resource-gathering.md` carry the new contracts (the palette's space and build-time rules, the store-cap indicator, the town-hall scope line, the paid-rate rounding and the recommendation copy).

## [0.39.11] - 2026-11-03

- Logistics: the wagon steppers no longer stay pressable when the engine can only refuse. The route row's +1 is off with an empty unassigned-wagon pool, its −1 is off on a one-wagon route, and the hero's cargo/treasury −1 is off for a slot the hero holds nothing in — each carrying the panel's own sentence for that refusal.
- Engine: the one-wagon route floor is one exported constant (`MIN_TRADE_ROUTE_WAGONS`), read by both the clamp and the client's gate.

## [0.39.10] - 2026-11-03

the four skybox-only settings rows now state the backdrop they need

## [0.39.9] - 2026-11-03

load never substitutes a starter game for a failed or empty load

## [0.39.8] - 2026-11-03

A fresh database's first boot tags mage, warhound, giant eagle and eagle prince as human instead of leaving them neutral: migration 006 backfilled rows that 015/020 had not inserted yet, so the recruit gate refused them until a second boot. test:unit against a brand-new PGDATABASE is green on the first run.

## [0.39.7] - 2026-11-03

The native confirm() freezes the renderer: the toolbar's gear -> + New Game, the landing page's delete-game row and the Asset Manager's delete-asset now route through the app's own in-page dialog (`openConfirmDialog`). Measured in a real browser with the tab foregrounded, a native confirm() blocked the renderer thread outright -- `Page.handleJavaScriptDialog` returned {} while every `Runtime.evaluate` timed out after 5s, the rAF counter advanced 0 ticks across a 2s window that otherwise carried 274, and the click that opened it never even acked -- and the tab answered again in 0.0s the moment the box was dismissed. The same click now returns in 0.01s with the dialog on screen, 177 rAF ticks across the same window and zero native confirms. The prompt raised from the landing page or the Asset Manager is mounted above the surface that raised it (z-index 320 over the Load dialog's 300 and the home overlay's 200), so it is clickable rather than merely visible. Three tests, one per site: cancelling deletes nothing, starts nothing and loses no cache entry; confirming acts on exactly the named game/asset.

## [0.39.6] - 2026-11-03

F1 (the client's `players[].revealedTiles` mirror went stale and a renderer trick hid it): after a move the server's persisted reveal grew while the client's own copy of it stayed at its load-time value for the whole session -- measured 98 keys against the server's 134, 36 of them present only on the server, never reconciled -- and nothing showed, because `GameEngine.draw` handed that copy to `src/render/reveal.ts`, which re-unioned the live vision ring every frame: the render compensated for the projection instead of the projection being right. The verdict, read off the writers and the consumers: the server's persisted projection is authoritative, the client's copy is a projection of it that only hydration ever wrote, and it now has two consumers -- the renderer's seed and, since F2 above, the tile panel's `revealedSetForTilePanel` -- so the mirror is RECONCILED rather than deleted, by applying the SAME rule instead of a second one. `revealForPlayer` (`packages/engine/src/reveal.ts`) unions a seat's vision rings -- plus the walked corridor -- into its reveal, gated on the seat maintaining one, and now lives in the engine: `server/app/commandHandler.ts` imports it (its local copy and `isHuman` helper are gone, behaviour unchanged) and the client applies it on the same four commands the server does (`TurnController.revealReconciled` -- moves, chartered travel, captures, foundings), so the copy follows the server instead of waiting for a reload or a resync a solo game never performs. `src/render/reveal.ts` then draws the persisted list **as of each frame**, unioned with the tiles this session's own vision has seen, so no load-time snapshot and no monotone accumulator is left standing between the projection and the pixels. Proof at the level the defect lives: `test/state/revealMirrorReconcile.test.ts` reads the client's own `players[].revealedTiles` after a move (RED on the previous revision -- "measured: 61 keys before, 61 after; destination 12,2 MISSING"), and `test/unchartedMode.e2e.ts` reads the same value in the browser BEFORE the reload that would rehydrate it (RED without the client half -- "the client's own revealedTiles is behind the server: destination 5,17 missing in-session"; green -- in-session client mirror holds 227 keys vs the server's 227).

## [0.39.5] - 2026-11-03

the load path remembers the seat it claimed, so a reload opens where you are

`test:districts` was red on main. Re-measured on the real tip first: `git fetch github` → `f7e02a3` (0.39.2), where `districts.e2e.ts:372` failed verbatim — `AssertionError [ERR_ASSERTION]: district did not re-open after reload` / `false !== true` (`>> threw:` … `at run (test/districts.e2e.ts:372:12)`). Attributed by RUNNING the suite at the commit on either side of each candidate in `a895975..fd18ec0`, not by reading: green at `a895975` (0.38.12), green at `adcbc18` (0.38.13, PR #297), **red from `0bc64b7` (0.38.14, PR #296 — the load-path/seat-resolver landing) on**, red again at `fd18ec0` (0.39.0, PR #295) and at the tip. The flip is PR #296's, and it is a real product regression, not test drift.

- **the mechanism, read out of the running client at the culprit commit:** after the reload `resolveLocalSeat` answered `{"seat":null,"source":"unknown"}` for a game whose claim map held `{"0":{"handle":"Player 1",…}}`, so the load camera centred `{"q":17.5,"r":13,"source":"map-centre"}` instead of the seat's own castle at `(2,9)`. Every claim check falls back to seat 0, so nothing else refused — the district hex had simply fallen off screen and the double-click never reached it.
- **the cause:** the client's own self-claims — the New Game form and the auto-created starter, both seat 0, `src/managers/GameSessionManager.ts` — claimed a seat server-side and never recorded it locally. PR #296 removed the old fallback (the *lowest* claimed seat, which happened to be the creator's 0), so a browser that had claimed its own seat now had nothing to be identified BY on reload. Verified against the DB, not inferred: `SELECT lobby->'claimed' FROM games` on the run's own game returns exactly that single seat-0 claim.
- **the fix is the missing memory, never a softened guess:** both self-claim sites now call the same `rememberSelfClaim()` (`src/players/localPlayer.ts`) the multiplayer lobby's Host/Join tabs already used, which writes the remembered seat, the claim handle and the in-memory seat. `resolveLocalSeat` still refuses to assert a seat the browser cannot prove it holds.
- **surfaces:** the reload path is shared by every game a browser self-claims through `GameSessionManager.loadGame` → `resolveLocalSeat` (the load camera and the in-memory seat). Verified in a browser by `test:districts` (green on this tree) and by `test:settlements` (green, unaffected); pinned by a new unit file `test/state/selfClaimMemory.test.ts` whose last case reads `src/` and fails if ANY `.claimLobbySeat(` call site stops remembering its seat, so a new claim path cannot reintroduce this silently.
- docs: `docs/multiplayer.md`'s Local-seat-identity row now states the rule — claiming a seat and remembering it are one act.

## [0.39.4] - 2026-11-03

F3 (the camera could lose the map): there was no pan clamp, so repeated drags walked it arbitrarily far off the map and the renderer -- which clamps the tiles it asks about to the map's bounds -- painted nothing. Measured on a 40x30 map at zoom 1 in a 1280x800 viewport: forty `pan(-400,-400)` drags took `mapTilesOnScreen` from 369 to 0 with the camera parked at (-16000,-16000), a black viewport whose only exit was a minimap click. `Camera.clampToMap` now keeps the map's world-pixel extent (measured from the four corner hexes) overlapping the viewport, compared against `viewport/zoom` so it holds at every zoom level, and centres a map that fits entirely. Every surface that moves the camera routes through `AdventureView.clampCamera`: the drag pan, the minimap frame drag, the wheel zoom, `centerOn` (minimap click, load centring, resize, focus-hero/settlement) and the zoom-out setting callback.

F2 (the tile panel lied about what you can see): outside every vision ring the panel read "Unexplored" with no terrain and no move cost, even on hexes the map itself paints as explored ground under the fog veil -- at a dirt hex the scene builder emitted `terrainHex` + `fogHex` (veiled dirt composites to `rgb(37,31,25)`, the card's `(36,31,25)` to rounding) while `describeTile` returned `terrain: null`. "Unexplored" now means NEVER SEEN: `TileInfo.explored` is set from the seat's reveal set (`revealedSetForTilePanel` unions the persisted `revealedTiles` with live vision), and an explored hex reads its terrain label and move cost with a dim "Explored — not in sight" note. Deposits, settlements, heroes, charters and territory stay visibility-gated; classic games carry no reveal list, so there `explored` is false everywhere and the locked two-state fog rule is byte-identical.

F4 (cosmetic, same family): the minimap painted every explored-but-unwatched hex as flat slate, so uncovered ground lost its biome the moment the hero walked away. `minimapCellKind` / `minimapCellFill` give the cell its tier -- visible and explored share the terrain colour (explored under a veil), uncharted stays opaque black, classic fog stays the slate.

`patch`: three presentation/view-layer fixes, no schema or wire-contract change. New tests `test/render/camera.test.ts`, the F2 cases in `test/screens/adventure/tileInfoPanel.test.ts`, the F4 cases in `test/render/minimap.test.ts`; docs/map.md updated.

## [0.39.3] - 2026-11-03

- fix(types): the type gate checks the application and ratchets the test tree (eac6850)
- test(uncharted): ask the game for passability instead of a hand-rolled terrain set (9fe5300)
- chore(release): 0.39.1 with the settings-panel truthfulness fixes (da5ae39)
- chore(release): 0.38.15 with the settings-panel truthfulness fixes (70b17fa)
- chore(release): 0.38.14 with the settings-panel truthfulness fixes (5dfb37d)
- chore(release): 0.38.12 with the settings-panel truthfulness fixes (26cfea1)
- docs(player-guide): the New Game form opens on the stored preference, not the last game created (0f5ab42)
- fix(settings): show every slider's name and value, and let a player set the default mode (2a93c68)
- fix(sync): reconcile an unpaired resync snapshot instead of orphaning the cursor (#293) (a895975)
- chore(release): 0.38.12, test:visual tells the truth again (8d9c69a)
- test(visual): re-baseline the three city-view scenes (cf67390)
- test(visual): re-baseline the three adventure/charter scenes (c242ff8)
- chore(release): 0.38.10 with the seat-resolver and load-promise fixes (ec541c3)
- fix(load): return the load promise through the toolbar callback (fe61e52)
- fix(load): resolve the browser's OWN seat, not the first claimed one (6f89ece)
- fix(ui): the hero panel's transfer buttons are gold, and now say so (821e906)
- feat(ui): deliver hero cargo into a settlement's warehouse (547aab0)
- chore(release): 0.38.9 with the settlement UI telling the truth (25536b3)
- chore(release): 0.38.9 with the Load-path fixes (f97d5cb)
- docs(settlements): record the cap-aware upgrade refusal and the panel's one rate (4a6a6bd)
- chore(release): 0.38.8, the ledger learns to hold district buildings (f0ddd20)
- chore(release): 0.38.8 with the Load-path fixes (fefd133)
- chore(release): 0.38.7, the ledger learns to hold district buildings (71dbc7e)
- fix(settlements): the panel's food rate is one entry, not two that could drift (c56671c)
- chore(release): 0.38.7 with the Load-path fixes (3494421)
- fix(city-view): a blocked upgrade says why, and names the cap when the cap is the blocker (a5311d3)
- test(server): retarget the last HTTP EndTurn caller to the declared seat (2b3088b)
- chore(release): 0.38.6, the ledger learns to hold district buildings (faf478a)
- chore(release): 0.38.3, the ledger learns to hold district buildings (a3b8a76)
- test(migrations): find the settlement by id, not by read order (87fc0f8)
- chore(release): 0.38.6 with the Load-path fixes (b427bc7)
- docs(settlements): say where a district's buildings actually persist (0d83238)
- fix(persistence): the granular ledger holds district buildings (E8) (1efaef9)
- chore(release): 0.38.3 with the turn-control and seat-truth fixes (deb4647)
- fix(seats): a browser plays the seat it claimed; the hotseat decision is written down (9592c0e)
- chore(release): 0.38.5 with the Load-path fixes (e988d3c)
- chore(release): 0.38.3 with the district-road feedback and fidelity fixes (b541b9d)
- docs(roads): decide the workforce reading and record the harbour rule (92aaa03)
- fix(roads): a shipyard harbour gets its pier, and the width reading is pinned (94ab561)
- fix(districts): speak each refused district entry on the map's toast (cca252d)
- fix(client): reconcile the settlement mirror on the per-frame state diff (b94b862)
- fix(logistics): Accept all is disabled when no recommendation can be accepted (45887e6)
- fix(api): availableSeats means what it says -- the seats that are actually free (5c87f42)
- fix(turn-control): an End Turn names the seat it acts as, and must be its own (646127a)
- fix(load): centre the camera on what the loaded game actually has, not (6,5) (9ea9d25)
- chore(release): 0.38.4 with the battle-persistence fixes (b9a028c)
- fix(combat): the troops scalar tracks its stacks on BOTH sides of a battle (F3) (9b8724b)
- fix(sync): an unseeded load never replays the event log into a settled battle (F2 client half) (73194b7)
- fix(combat): refuse a defender-seat resolve the lobby no longer marks pending (F2) (f3023f7)
- fix(load-modal): close the dialog the Open actually used, so no overlay is left (f16c21c)
- chore(release): 0.38.3 with the town-hall L2/L3 re-art (5aeab4d)
- fix(sprites): the town hall's L2 and L3 lots are 30 deg and plinth-less too (78de92f)
- docs(design): record the town-hall L2/L3 wave - the candidates and the pick (20c548e)
- fix(home): the landing Load list reads the round, not the frozen games.turn (9f55061)
- chore(release): 0.38.2 with the town-centre sprite audit (5ecbfe2)
- docs(town-center): record the audit — the asset, the defect, and the test's verdict (21d9632)
- test(town-center): measure the whole town-hall art family, and calibrate the drawn lot (38235d3)
- test(town-center): prove the town center's grid misalignment end to end (94058c7)
- chore(release): 0.38.1 (4525641)
- fix(test): route the two turnover specs through the typed GameDebugApi seam (311cf86)
- …and 215 more commits

## [0.39.2] - 2026-11-03

the uncharted suite stops guessing the engine's terrain table

`test:uncharted` part [D] was red on main (a895975 / 0.38.12) and inherited: it fails identically on 44e0f1d (0.38.9), f8686e1 (0.38.10) and 6a80df0 (0.38.11). The fixture picked its destination from a hand-rolled `IMPASSABLE = new Set(["water", "mountain"])` kept inside the test, while the engine's own cost table (`TERRAIN_COST` in `packages/engine/src/map/terrain.ts`) prices `denseForest` at `Infinity` as well. On seed 424242 with mapGenVersion 5 the hero starts at (5,7) and the first direction the fixture's set calls passable two hexes out resolves to (7,7) -- a `denseForest`; `/tiles` reports it as denseForest, `__gameDebug.isPassable(7,7)` is `false`, and `requestMove` correctly returns `false`, so [D] failed on its own fixture line (`requestMove to 7,7 rejected client-side`) before it ever reached the assertion it exists for.

The fix removes the second copy of the terrain table outright: destination selection asks the LIVE game through `__gameDebug.isPassable` (the engine's own `GameMap.isPassable` / `TERRAIN_COST`, rivers included). Part [D] scans the six directions for a two-hex run the engine prices; part [B] walks `MIN_TRAIL_DISTANCE` (10) hexes along the most open direction the engine prices. The assertions are untouched -- [D] still proves a non-uncharted move never persists a `revealedTiles` key, and the destination stays a real, non-trivial two-hex move. No engine, terrain, persistence or wire change; `terrain.ts` is not modified.

`patch`: the failure was in the test, not the game. Measured green on a895975 / 0.38.12 with a private database and kernel-assigned ports (never client port 5173): test:uncharted ([A]-[D]), test:settlements, test:districts, build, lint:deps, docs:check.

## [0.39.1] - 2026-11-03

settings panel: slider labels and the new-game default mode

- **fix(settings): seven sliders showed a player a bare number.** Each of these rows already built its label row and its value (`Hero movement speed`, `220ms · Normal`) and then appended only the slider and its hint, so the Game, Population and Visual sections rendered anonymous sliders with no name and no value anywhere in the document (playthrough round 4, F1). The label row is now appended with its slider, the value follows the drag, and every control carries a `data-setting="<key>"` hook so the panel's contents are enumerable from a test.
- **fix(settings): the stored new-game default mode had no writer in any UI.** `heroesJs.settings.gameMode` was persisted, migrated and read by both New Game surfaces, but only `__gameDebug.settings.update` could set it, so no player could make Settlers the default for a new game (F2). Settings has a **New game** section whose select writes that key, lists the store's own options, and says when it applies (the New Game form starts on it; it never changes an existing game's mode).
- **fix(settings): `Reset to default` reset 16 of the 18 persisted keys**, so `gameMode` and `buildingUpgradeConfirm` stayed at the player's value while the button claimed the defaults had been restored. It now resets the whole store from the one exported `DEFAULT_SETTINGS` object.
- **test(settings): the panel's contents are pinned.** Every persisted key must have a control in the panel that writes it, every slider row must name itself and show its current value, Reset must land every key on its default, and the store's reload round-trip covers all 18 keys.
- docs: the player guide no longer says the New Game form opens on "the mode you last created a game with" — it opens on the stored preference, which is now settable at Settings → New game.

## [0.39.0] - 2026-11-03

Cargo a hero picks up on the map can now be delivered: the settlement panel's Warehouse
section carries a hero-cargo row (**Deposit cargo** / **Take cargo**) whenever a hero of
yours stands on the settlement's tile, wired to the engine's existing `TransferResources`
verb -- which until now only the Logistics modal's declared action named, and no control
ever invoked. The Logistics window's hero block offers the same two buttons, both surfaces
read one shared direction/amount model (`src/screens/shared/cargoTransfer.ts`), and the hero
panel's own buttons are renamed **Deposit gold** / **Withdraw gold** because they were always
gold-only despite the generic label (playthrough finding F-2).
## [0.38.14] - 2026-11-03

Copilot's two comments on the landed load path. The browser's own seat is resolved instead of the first claimed one: a remembered seat, then the handle it claimed with, then the server-bound auth email, and NO seat when none of the three identifies the browser (this supersedes #292's `resolveInitialLocalSeat`, whose lowest-claimed-seat fallback was the same first-claim guess merely narrowed). The load promise is returned through the toolbar callback, so a failed load stays observable by the dialog that awaits it.

## [0.38.13] - 2026-11-03

test:visual tells the truth again
- Six stale scene baselines are re-baselined to what main actually renders, each pinned to the commit that moved it by running the suite on either side of that commit: the three adventure/charter scenes to `2417ae8` (the hero panel's trade affordance reflows the panel and every row under it) and the three city-view scenes to `beb7854` (the town-hall re-art, which drops the thick flat plinth). No render code changed; the screenshots themselves are the record. `test:visual` is 10/10 green on two consecutive runs (it was 6/10 red on main, unchanged for two rounds).
- What the suite cannot see, so the next round can plan for it: no scene drives districts, district roads or the Load path. The city-view captures reach the backdrop only, and nothing in the replay set opens the load flow.

## [0.38.12] - 2026-11-03

Copilot's review comment on PR #288 is real, and it is a defect PR #288 introduced. An unseeded `MultiplayerSync.start()` (the load path's row carries no `last_event_id`, and `onHumanTurnEnd` restarts the sync by name) did its first full resync, seeded `this.cursor` from that same GET and opened the event stream there, while `garrisonEventBridge` REFUSED the snapshot -- unflagged games drop every reason but `event_not_derivable`, and a flagged one adopts only when `aiTurnSuperseded` -- so the client's TurnController never took the state the cursor belonged to, and `applyRows`' per-row filter (`id <= cursor`) then discarded the redelivery of every row the snapshot had jumped over. Before #288 the stream was opened at `after=0` and the whole backlog replayed as deltas, which masked the gap; #288 closed that hole and left the refusal with nothing behind it. A new integration test at the sync+bridge level, over a real `TurnController`, asserts what the client ends up holding: it fails on 0.38.6 for both paths (the local player's turn on load, and a flagged game's unchanged AI turn) with the stale garrison 4 instead of 9, and passes here.

The fix is the cursor/snapshot pairing the design already implied: `mp:resynced` now carries `pairedCursor`, the cursor the client's state was paired with going into the fetch -- `null` for an unseeded start, where that GET is the client's FIRST pairing, so its snapshot's own cursor is the one the client's state will be held against and dropping it can only leave the cursor ahead of the only state the client holds (permanently, not until the next boundary: every later unflagged `initial` resync was refused by the same reason gate). `garrisonEventBridge` therefore reconciles an unpaired snapshot wherever the phase is not one the local client is driving (`safeForDeltas()`, re-checked after `flushPendingCommands`) instead of dropping it. A non-null `pairedCursor` keeps every existing rule byte-identical -- those refusals are phase-scoped, and the next boundary resync repairs them, which is why the guard stays.

`patch`: this diverged; the loss was silent and permanent for the session (a pending `BattleOffered`, a troop total, a hero position). New field on an existing bus event, no schema or wire-contract change, new test `test/io/multiplayerSyncGarrisonBridge.test.ts`.


## [0.38.11] - 2026-11-03

seat truth: a seat's own turn
- End Turn is seat-scoped on both sides (playthrough round 2b, F1): the toolbar offers the control only on the local seat's own turn (`canEndTurnFromSeat`), the command declares the seat that is asking (`EndTurn.clientSeat`, required over HTTP by `parseCommand`), and `endTurnSeatRefusal` refuses a declaration that is not the seat being ended. A browser-driven AI seat's turn, ended by seat 0's client, and the drop policy's own skip keep working.
- `GET /games/:name`'s `availableSeats` now means what it says (F3): the seats a client could still claim, instead of the falsy keys of `lobby.claimed` (structurally always `[]`). `seatTotal` is the game's seat count, AI seats included (F7).
- A browser plays the seat it claimed (F2): `loadGame` no longer resets a client that claimed seat 1 back to seat 0. The single-browser hotseat is out of scope, with the drop-policy change it would need named in docs/multiplayer.md (Decision 4).

## [0.38.10] - 2026-11-03

the settlement UI tells the truth: a blocked upgrade names its cap, and the panel prints one rate

## [0.38.9] - 2026-11-03

The Load Game surfaces: three fixes, from playthrough round 2b.

- **fix(home): the landing Load list reads the round, not the frozen `games.turn`.** The `games.turn` column is written once at creation (its DEFAULT 1 is the only writer) and never advances, so the landing page's Load list called a round-4 save "turn 1" while the in-game Load modal showed the real round. Both surfaces now render one shared progress line, and the column's legacy role is documented at both type sites.
- **fix(load-modal): the in-game Load modal closes after a successful Open.** Its teardown swept a `z-index: 100` layer no dialog sits on (`openDialog` mounts its wrapper at 300), so a successful load left the modal over the game with its row stuck on "Loading…", its fullscreen backdrop eating every later click, and the panel still registered with the panel manager. The row now closes the dialog it was opened with.
- **fix(load): loading an unfounded settlers game centres the camera on the seat's own unit.** The load path keyed off the literal hero id `p0-hero` with the classic castle-less spawn hex (6,5) as its fallback, so a settlers game with nothing founded opened fully fogged with the player's wagon off screen. The camera now resolves the local seat's wagon / commander / settlement, and the genuine nothing-to-centre-on case falls back to the map centre — documented, not a classic-game constant.

## [0.38.8] - 2026-11-03

The granular per-building ledger (settlement_buildings) could not hold a district building at all: its unique key was (game_id, settlement_id, gx, gy) and a district's buildings sit on the district's own 5x5 grid, so a district building at (0,0) collided with the main city's (0,0) and no row could be written. The ledger held 11 rows for a town whose state carried 14 buildings, and a sum of its own rows came up short by exactly the districts' output -- 3.12 stone + 3.75 food/day on the playthrough card's Stone mark, against a panel aggregate of 5.88 stone / 26.95 food (playthrough round 2b, finding E8).

Migration 035 adds nullable district_q / district_r to settlement_buildings (NULL = main city, otherwise the district's own hex -- the same "q,r" key districtKey() uses), re-scopes the unique key to include them, and backfills every existing game's district buildings out of its settlements.districts JSONB column, guardedly: initSchema() re-runs every migration on every boot with no error handling, so a malformed districts shape has to be skipped rather than thrown, and a second run has to be a no-op.

settlementRepo writes every building the settlement owns -- main city and every district -- as one row each, and reassembles SettlementState.districts from those rows plus the JSONB column's per-district metadata (q, r, citySpots), falling back to the JSONB buildings array for a district it has no rows for at all (a game whose rows predate 035, or a district the backfill's shape guards skipped) -- the granular-first / JSONB-fallback rule hydrate.ts applies a level up. The panel's rate is unchanged: the same settlementProductionRates() now reads a complete ledger, and a test fails if a district building is dropped from it.

## [0.38.7] - 2026-11-03

District-road round-2 feedback and fidelity: each refused district entry now states its reason, a shipyard harbour gets its pier, and the workforce width reading is measured and decided (not faked).

- **F3 (friction) -- a refused district SPEAKS.** A double-click on a hex that cannot host a district used to refuse in silence, leaving the unrelated "Select a hero first" as the only words on screen. It now says WHY on the adventure map's refusal toast: out of the settlement's control range, another seat's land, not touching the settlement's cluster, or impassable ground -- through the engine's new `districtEntryDecision()` and its one `districtEntryRefusalToast()` table, so the rule and the sentence cannot drift.
- **F4 (cosmetic) -- a shipyard harbour gets its pier.** A water district holding a `shipyard` is not walkable, so it used to get no road and no explanation. It now joins the road network by a single pier/bridge edge to the adjacent node it was founded against -- and a district whose only way out is that harbour gets the same landing edge -- drawn in the same two-tone hairline as every land road. A district with no walkable route AND no harbour adjacent (or no adjacent node at all) still gets no road.
- **F2 (cosmetic, decided) -- the workforce reading, measured.** The road's width is the reading and it follows the district's actual staffing (15% -> 3 tracks -> 0.70px; 100% -> 20 -> 1.50px), but the 1-vs-20-track delta is 0.90px on a 55.4px hex and every district of a game nobody has staffed is *genuinely* at 100% (`applyPlaceBuildings` places `workers: undefined`, the legacy auto-staffed max), so a busy trunk and a light lane render identically. The mapping is left as the carrier rather than varied by anything the data does not carry; the measurement and the legible-carrier / auto-100% question are recorded in `docs/settlements.md` and filed as a round-3 finding.

The road behaviour the round-2 card proved correct is unchanged: per-terrain drawing, opposite bowing, sprite scaling, one paint per segment, surviving an End Turn and a reload, zero movement cost, and neither blocked nor overwritten by building placement.
## [0.38.6] - 2026-11-03

Playthrough round 2's battle-persistence cluster, both findings re-measured on 0.38.2 and fixed, with both surfaces of F2 closed. A load whose payload carried no `last_event_id` (the Load list's row is the only source, and only `GET /games/:name` returns that field) left the multiplayer sync's cursor unseeded, and the sync opened the event stream at `after=0` -- the poll route's contract makes that "replay the whole game_events log" -- so every historical event was re-delivered as a live delta and a replayed `BattleOffered` re-opened a battle the server had already settled (its closing `BattleResolved` answers "resync", and that snapshot was dropped outright while the phase was blocked, so the modal stayed up and Quick Resolve POSTed a second time). The stream is now deferred until the initial resync seeds the cursor, and a row at or below the cursor is never applied -- the phase cannot be re-opened by a settled battle. The server side is closed too: a defender-seat `ResolveBattle` / `SubmitBattleResult` for a pair the lobby no longer marks pending is refused with `battle_not_pending` on server-driven games (checked before any world mutation, so a refusal leaves nothing half-written), which retires the second persisted resolution that deleted a hero, while an attacker-seat resolve and a browser-driven game's client-local defender path stay ungated. The stale `heroes.troops` scalar is gone as well: one new `withSurvivorStacks` helper now writes the scalar everywhere survivor stacks are written -- both sides of a hero battle, the conceding side, and the settlement battle's attacker -- so the persisted column, the API and `hydrate`'s re-seed all agree with `hero_platoons` instead of the winner keeping its pre-battle headcount. `patch`: both findings are defects on shipped paths, no new command kind, no schema change and no wire-contract change (the new refusal reason is one more value on the existing command error field).

## [0.38.5] - 2026-11-03

- **fix(client): the client's settlement mirror now follows a capture.** `GameStateManager.rebuildSettlementsFromState()` was wired only to wholesale state replacement (boot, load, `state:committed`), and a `TurnController` command deliberately emits no `state:committed` (it would snap every hero) — so after a walk-in capture the `Castle` wrappers every render/UI path reads kept the pre-capture owner, along with every other mirrored field (buildings, auto-trade, level). The wrappers are now reconciled on the per-frame state-identity diff too, in place via `Castle.syncFromState`, because `EntityMirror` and the vision/territory caches alias those instances. Playthrough round 2, F4.

## [0.38.4] - 2026-11-03

fix(logistics): the trade-routes Accept all is disabled when its only route cannot be accepted

## [0.38.3] - 2026-11-03

The town hall's level 2 and 3 art is re-generated onto the iso grid, so `test:towncenter` goes green (25/25, was 15/25). The old L2/L3 sprites still carried a 30° lot, a 107-row / 70-row transparent bottom pad and an 81px / 74px soil plinth, so upgrading a settlement brought the raised platform and the floating base straight back; both levels now measure the level-1 art's own convention — edge slope 0.523 / 0.521, bottom pad 0 rows, ground diamond 100% of the canvas, ≤12px of silhouette below the ground plane, one alpha component each. The regenerated anchor table follows the art (`pixel.townHall.2` 9→0, `pixel.townHall.3` 6→0): a grid-exact lot needs no bottom-pad compensation, exactly as `townHall.1` already measured 0. Eight candidates from four image-generation models, with the measured critique and the pick, are recorded in `design/building-pixel-townhall-l2-l3-wave/`; no game code changed, so patch.

## [0.38.2] - 2026-11-03

The town-centre sprite audit lands as its own changeset: test/townCenterSprite.e2e.ts (25 checks over the town-hall art family and the rendered sprite in a settlers city view) plus docs/town-center-review/, wired into the suite runner as test:towncenter. No game code changes -- a test-and-docs changeset, so patch.

## [0.38.1] - 2026-11-03

Fix `test:unit` on main: the two PR #281 playthrough specs (`cityGridTurnover`, `newGameFormViewport`) now reach `window.__gameDebug` through the typed `GameDebugApi` seam instead of a loose inline cast, so the debug-contract guard goes green again.

## [0.38.0] - 2026-11-03

District roads: a purely decorative ground layer joins each district to its settlement's tile.

- Track count is the district's own staffing share (one track per 5 points of workforce: unstaffed lays no road, 15 lays three, a fully staffed district hits the 20 cap).
- The layout lives in the engine (`packages/engine/src/settlement/roadNetwork.ts`): `settlementRoadNetwork()` grows the network outward from the settlement tile in distance order and links each district to the cheapest node already in the network, so an abandoned district re-routes the chain that hung off it, and the routes are A* over the live map so roads bend around mountains, forest and unbridged rivers.
- The painter draws each edge as a bowed hairline: `ROAD_WIDTH_BASE` 0.55px + 0.05px per track capped at 1.5px, and a deterministic FNV-1a bow per canonical tile-pair so a recompute, a reload and every frame draw identical curves.

## [0.37.2] - 2026-11-03

The city-view build palette's affordability feedback, from the round-2 playthrough: the palette refreshes its rows before it opens and while it stays open (`turn:ended` / `state:committed`), so a treasury that refills during a turn no longer leaves every row dimmed at "Not enough gold (need 100, have 0)" until the city is left and re-entered; a placement the cart cannot cover now says why on the palette notice instead of failing silently behind a buildable-looking ghost; and that cart line retires with the snapshot that wrote it, while a geometry refusal (a rule, not a reading of the treasury) stays.

## [0.37.1] - 2026-10-26

The settlement-placement friction a real playthrough hit: a grid click now places the held building from the click's own coordinates (a bare click used to be a silent no-op), a refused footprint states the rule in words beside the ghost and in the palette instead of only tinting the ghost red, and a repeated cart commit (Confirm after a placement) writes nothing -- it used to send a second identical PlaceBuildings command, append a second buildings_placed event and, on the granular store, be rejected with a duplicate-key 500.

## [0.37.0] - 2026-10-26

Heroes pick up the resources on the adventure map: every resource tile carries a deterministic 5-500 amount derived from the seed and the tile (a hash, no map-RNG draw, no MapGenVersion bump), a hero standing on a tile picks up min(remaining, cargo room) and leaves the rest on the floor, and the tile keeps its resource type and city-view yield

## [0.36.4] - 2026-10-26

Five playthrough findings, all in the charter/persistence lane. Acceptance first:
each one carries the failing case it was written from, and the fix that closes it.

- **A charter survives a reload and can always found** (`C-BLOCKER-1`,
  `C-MAJOR-1`). `GET /api/games/:name` now returns the game's `charters` rows and
  `hydrateClientGame` maps them onto `activeCharters`, so a reload no longer
  hydrates an empty charter list while `heroes.<id>.isChartering` persists — the
  state that left the chartering hero locked (and starving) for good. A hero
  flagged `isChartering` with no charter row behind it is unlocked by hydration
  instead, `GameSessionManager.loadGame` resumes a mid-route charter after a
  load, and the day tick advances a `traveling` charter one hex server-side
  (`advanceCharters(state, map)`) so no client cooperation is needed to arrive.
  The client's own travel walk now POSTs its steps one at a time in route order:
  the server checks each step's `fromTile` against the hero's persisted hex, so
  the old concurrent burst was rejected 409 `hero_not_at_fromTile` and left the
  client believing a charter was constructing while the server still had it
  traveling.
- **A resolved combat reloads as the turn, not as BATTLE** (`M-BLOCKER-1`,
  `M-BLOCKER-2`). The BATTLE phase is re-derived from `lobby.pendingBattle` on
  every load, and it is now derived only while that marker names a live collision
  (both heroes present and adjacent) — a marker from a battle that has ended no
  longer resurrects a phase nothing can leave. The AI driver also offers a given
  (round, seat, attacker, defender) battle once per turn: re-offering an answered
  attack kept the pass returning `waiting_for_defender` before any EndTurn, so an
  AI hero standing next to a living human defender kept the game in BATTLE and
  the turn could never hand back.
- **A combat save no longer rewrites `games.settlements`** (`M-MAJOR-2`). The
  battle persist leaves the settlements JSONB column untouched unless a
  post-battle capture changed one (`saveHeroesAndSettlements`'s new
  `skipSettlements`), instead of re-writing it from the granular read path whose
  shape is normalized on the way in (platoon arrays pad to `ARMY_STACK_SLOTS`).
- **Booting no longer fabricates a world** (`C-POLISH-2`). The client's boot
  state is `emptyGameState()` — no players, heroes or settlements — rather than a
  locally generated three-seat world matching no database row while
  `activeGameName` was still null and `/api/games` had never been asked.

## [0.36.3] - 2026-10-26

Four city-UI findings from the consolidated playthrough report. No engine or economy
code changed: every one is what the client renders.

- **The Build palette's "Cart:" line is a charge, not a running total.** It printed the
  cart's internal net (a placement counts positive) tinted green whenever the settlement
  could afford it, so spending read as income; and it kept accumulating against the
  palette-open baseline after the placement had already been paid for. It now shows what
  the cart still owes -- a cost signed negative in the cost amber, a destroy refund
  positive in green, red only for a charge the treasury cannot cover -- and clears once
  the charge has landed (`buildingPlacer.ts`, `netCost.ts`).
- **The palette list keeps its scroll offset** across a selection and a placement. Both
  re-render the list, which replaced the scrolling element and threw the viewer back to
  the top, so the Production and Civilian rows were a scroll away after every placement.
- **The Load Game row reads the round, not `games.turn`.** That column is written once at
  creation and never advances, so a game on round 37 advertised itself as "turn 1"
  (`loadGameModal.ts`).
- **The HUD's INCOME pill is pinned to the loaded state.** The reported "40g with no
  intervening command" was the client swapping its boot starter world for the game the
  player then created; the readout is now asserted to be the engine's own figure for the
  state on screen (`hud.test.ts`).
## [0.36.2] - 2026-10-26

Three settlement-economy fixes from the classic playthrough findings.

- **Workforce (C-MAJOR-2):** an `AssignWorkers` assignment now writes only the building it addresses. The first assignment used to convert the whole settlement to explicit crews and auto-employ the remaining pool, which on a level-1 city (pool 5, 13 buildings) took the advertised daily rates from −3.84 to −12.8 wood, +6.64 to −1.11 stone and +14.33 to −0.53 food from a single click. Untouched settlements keep their legacy full-effort auto-staffing, so a city converts to explicit crews one building at a time.
- **Building upgrades (C-MAJOR-3):** `startBuildingUpgrade` refuses (`footprint_blocked`) an upgrade whose bigger L2/L3 footprint would claim a cell another building occupies, so a growing hut can no longer swallow a neighbour's cell and hide that neighbour's controls.
- **Population cap (C-MINOR-2):** `settlementPopulationCap` (level base + district housing) is the one reader of the cap; the settlement panel prints `Population <now> / <cap>` with a tooltip naming the level base and the district-housing part, and `docs/settlements.md` states that same rule instead of a flat 500 / 1,500 / 5,000.

## [0.36.1] - 2026-10-26

The adventure map's tile info panel now follows the pointer: pointing at a hex inspects it exactly as clicking one does (the same onTileInspect channel), so an unrevealed hex reads "Unexplored" and the hex a hero has landed on shows its terrain without a click that would also select, move or attack. Fixes the two map display findings of the movement playthrough (M-MINOR-1, M-MINOR-2) — both were one defect: the panel was click-driven, so hovering produced no panel at all.

## [0.36.0] - 2026-10-26

Two engine rules for buildings.

- The **House** grants population by level — 300 / 1000 / 1500 at L1 / L2 / L3
  — through a new per-level `populationByLevel` table that
  `buildingSettlementEffects` prefers over the `populationBonus x level`
  multiplication (`packages/engine/src/buildingRegistry.ts`). It previously
  read 50 / 100 / 150. `POP_BY_LEVEL` (the settlement population cap,
  500 / 1500 / 5000) is deliberately untouched.
- **Construction speed scales with assigned workers.** A building under
  construction now advances `1 + effortFraction(b)` days per round wrap
  instead of a flat 1 (`packages/engine/src/settlement/advance.ts`), so a
  fully staffed site builds at 2x and an idle one at 1x, in the main city and
  in districts alike.

## [0.35.0] - 2026-10-25

Settlers mode is fixed against its four confirmed intentions (`SETTLERS-PLAN.md`
§3; the as-built record is `SETTLERS-ACCEPTANCE.md`). Terrain is untouched — the
mode gates ENTITY seeding only, so `MapGenVersion` and every generation pass stay
as they are.

- **Bare wilderness.** A settlers game seeds no settlement at all: no seat castle
  and no neutral castle, so the neutral towns, their seeded starter buildings and
  their startup districts disappear with the castle list they hang off
  (`neutralCastles: false`). The mode has no pre-existing objective until a rival
  founds one.
- **Never a prebuilt city.** `freeStarterBuildings: false` now gates BOTH grants —
  the founding-time layout and the city view's free starter commit on first open —
  and `placeBuildings` refuses a spoofed `initialLayout` in a mode whose key says
  no. A founded town opens on an empty plot; the free town hall is the player's
  first placement and everything else is paid for.
- **Founding is one click, in place.** The toolbar's Found Settlement action is
  the whole action: no armed gesture, no highlighted hex, no map click that can
  found, and no hex on the wire (the server derives `(q, r)` from the founder's
  own row). The armed-gesture code, its render option, its click intent and
  `foundSettlementTarget` are deleted rather than left dead.
- **The wagon becomes the town's first hero.** `wagonConsumedOnFounding` is
  replaced by `wagonBecomesFirstHero`: the same entity, renamed `p<seat>-wagon` →
  `p<seat>-hero`, still on the seat's roster and still selected (the repro's
  "The selected hero no longer exists" is fixed). The rule is wagon-only
  (`founder_not_a_wagon`), so one wagon still buys exactly one settlement, and
  `cargoStaysWithFounderHero` (default false) makes the cargo explicit: the town
  takes the load, one stockpile, in the town.

## [0.34.0] - 2026-10-24

Settlers mode: a seat now starts with one covered wagon in the wilderness and founds its own settlements instead of chartering them.

**Choose the mode when you create a game.** Both new-game surfaces offer it and pre-select the mode your settings store holds, and `POST /games` takes a `gameMode` field (`classic` or `settlers`) that rides the game's lobby record -- no new column, no migration, and every game created before this feature still reads as classic. A classic game's seeded map, rules and AI decisions are byte-identical to before: the mode changes what entities a seat starts with, never the terrain.

**A settlers seat starts with one covered wagon**, carrying a starter stockpile (200 wood / 100 stone / 50 iron / 50 food) and no castle or commander, with one wagon per seat. Founding is the wagon's job: select it, press the toolbar's **Found Settlement** button, and click the highlighted hex it stands on. The town consumes the wagon it came from, so the wagon pool is your expansion budget, and the new settlement keeps at least 3 hexes from every settlement, neutral castles included.

**No charter, no construction days, no modal.** The engine's own rule decides -- mode, founder position, occupancy, terrain and the spacing answer -- so the client can never offer a founding the server refuses, and every refusal is surfaced with that rule's own sentence ("Too close to another settlement -- keep 3 hexes between them"). The wilds keep their neutral castles as capture objectives.

**The AI plays the mode too**: its seat places its start and founds settlements through the same engine functions a human uses, and never issues a command the mode forbids. The charter path is untouched and keeps its rules in a classic game.

Tests: the mode's own pins (`test/engine/settlersMode.test.ts`, including one flip test per settings key), the creation route against real Express + Postgres, and a new browser suite -- `npm run test:settlers` (`test/settlers.e2e.ts`) -- that drives the founding gesture with real mouse clicks: select the wagon by clicking its hex, arm the gesture from the toolbar, click the hex again, and assert the town on both the client state and the server row.

## [0.32.0] - 2026-10-22

Give every faction twelve units, faction troop buildings and starter recruitment; enforce faction building placement.
## [0.33.3] - 2026-10-23

Two heroes can now start a trade by walking at each other.

**Click the hex the other hero is standing on.** With one of your heroes selected, a click on the square an **adjacent** hero of yours stands on used to just switch selection. It now opens the Trade panel for the pair — the "walk into him" gesture, which is as literal as it gets: heroes can never share a tile (`startMove` refuses an occupied destination), so trying to walk into a friend is exactly the moment to trade with him. The acting hero stays selected, so the panel opens with him on the give side and the partner on the other.

The gesture only fires when the two really are adjacent. The click resolver asks the engine's `canTradeHeroes` — the same rule the `TradeHeroes` command enforces — so the click can never offer a trade the command would refuse: a hero of yours two or more hexes away is out of trade range and clicking him still switches selection, an adjacent **enemy** hero is still an attack, and clicking your own selected hero still puts it down. The hero panel's `Trade with <name>…` button is unchanged and remains the other way in (it is the only way in when you would rather not move the mouse across the map).

Implementation: a new `trade` click intent in `src/screens/adventure/clickIntent.ts` (which is where the "same square" logic lives), dispatched by `adventureView.ts` through a new `onWalkIntoTrade` option wired in `GameEngine` → `UIManager.openHeroTrade` (now public). No command, event, server or database change: this is purely a client gesture for an existing feature.

Tests: `clickIntent.test.ts` gains five cases (the walk-in from all six neighbours, a hero out of range, nothing selected, an adjacent enemy, and the unchanged deselect toggle), and the `heroTrade` Playwright suite now opens the panel by clicking the partner's real hex on the map — asserting the resolver's reason is `trade`, that the acting hero stays selected, and that clicking a far own hero opens nothing and only selects.

## [0.33.2] - 2026-10-23

Two follow-ups to hero field trading, both from the same playtest.

**A hero can no longer be unloaded to zero troops either.** The hero-to-hero trade guard from 0.33.1 had a twin on the settlement side: dragging a hero's last platoon into a city garrison moved it and left an army-less hero. `transferUnits` (direction `toGarrison`) now checks the hero's POST-transfer stacks and refuses with the same `would_be_left_without_troops`, so the whole army can only ever be *moved*, never deleted. The garrison itself can still be emptied (a walk-in capture depends on it), and unloading everything *but* the last troop still lands. In the garrison grid the refused tile simply snaps back, like the grid's other refusals.

**The Trade window's buttons no longer scroll out of reach.** The status line, Clear and **Confirm trade** moved out of the panel's scrolling body into a pinned footer on the panel root, so on a short window the two hero columns scroll and the buttons stay put. The panel also stops going through the panel tiler: it opens beside the docked hero panel (geometry key `heroTrade`), then measures itself and clamps into the viewport, so Confirm is inside the window instead of below the fold.

Tests: `transferUnits.test.ts` gains the refusal case (whole army, and the second step of a two-type unload) and three existing cases that emptied the hero were retargeted; `applyEvent.test.ts` pins the replay of an army-emptying transfer as a resync rather than a partial move. The `heroTrade` Playwright suite now also asserts the footer is NOT inside the panel body and that Confirm measures inside the 800px viewport.

## [0.33.1] - 2026-10-23

Hero field trading no longer lets a hero be traded out of its whole army. A swap whose POST-trade army would be empty on either side is refused (`would_be_left_without_troops` / `partner_would_be_left_without_troops`) instead of producing an army-less hero that cannot fight or defend itself. The rule is checked on the result, so sending your last platoon in exchange for one back stays legal, and it is unconditional: a hero that somehow holds no troops must be given some before it can hand goods over.

The trade panel mirrors the guard rather than waiting for the rejection: staging a platoon that would empty a hero greys out **Confirm trade** and the status line names the hero that would be left with none. The panel also keeps the last commit's message ("Traded." / the engine's refusal) on screen until the table changes, instead of losing it to the next refresh.

Tests: three new engine cases (either side emptied, a both-ways platoon exchange and a last-platoon-for-troops swap both still allowed, an army-less hero refused even for goods-only) and a model case for the panel's mirror; the `heroTrade` Playwright suite now stages a whole army, asserts Confirm is refused with the hero named, unstages it, and checks the server answers `409 would_be_left_without_troops` with the row untouched.

## [0.33.0] - 2026-10-23

Field trading between heroes, out in the field. Two heroes of one seat standing on **adjacent** hexes (heroes can never share a tile) hand each other gold, cargo and whole platoons, committed as ONE all-or-nothing `TradeHeroes` command: both sides' affordability and both receivers' headroom (purse via treasury carts, per-resource cargo via wagons, army slots via `depositIntoGarrison`) are validated before anything moves, so a refused trade writes nothing. Capacity refusals name the hero at fault with a `partner_` prefix, each side's units are removed before the incoming ones land (a same-type swap both ways is not a false `platoon_full`), and the new `HeroesTraded` event replays as an applied delta.

UI: a hero standing next to a friendly hero now shows **Trade with NAMEs...** in its info panel. That opens a two-column **Trade** panel -- both heroes' live purse, the five cargo resources (the bubbly pile sprites the settlement panel uses) and their 4x2 army grids (the shared `SquadGrid`) -- where a chip or platoon tile **dragged** across the middle is staged as that hero's offer (drag it back, or press its x, to take it off the table), a staged row's -/+ trims a tenth of the holding (one unit for troops), and one **Confirm trade** sends both offers. The panel is a normal floating panel (geometry key `heroTrade`), reads live state on every refresh, and closes itself once the pair is no longer adjacent.

Also extracted `removeUnitsByType` into `packages/engine/src/units.ts` so the garrison transfer and the hero trade trim platoons through one implementation.

Tests: `test/engine/tradeHeroes.test.ts` and the DOM-free model's `test/screens/heroes/heroTradeModel.test.ts` cover the swap, every refusal, atomicity, the caps and the staging arithmetic; the new Playwright suite `test/heroTrade.e2e.ts` (`npm run test:heroTrade`, runner entry `heroTrade`) drives the real mouse drags on the live client, then asserts the staged offers, the server row and client state after one Confirm, and a 409 with the row untouched on an unaffordable trade.

## [0.32.0] - 2026-10-23

Two new mounted hero types, both generated with OpenRouter `google/gemini-3-pro-image` (the endpoint pinned to `google-vertex/global`) and wired end to end: the **Griffin Rider** (an eagle-headed, feathered, lion-hindquartered griffin in tawny gold, ivory beak and talons, under a white-and-gold rider with a turquoise cape) repainted from the `drake`, and the **Desert Nomad Rider** (a pale sand-gold horse under an indigo-robed, head-wrapped rider with a curved scimitar and a hide shield) repainted from the `ranger`. Both ship all eight headings at 512px plus a 320x100 roster banner, are recruitable with no UI change (registry entry, contracts union, descriptors, `HERO_BANNERS` and the hero-name pool), and are pinned by `test/render/griffinNomadArt.test.ts` and the `heroVariants` e2e (same-tile A/B diff against their source variant, plus an all-eight-descriptors and banner fetch). The griffin needed no correction pass; the nomad's first `ne` came back mirrored and was regenerated from the rear reference with an explicit composition rule.

## [0.31.0] - 2026-10-22

Battle retreat rework: edge-column escape, round-gated retreat, one-day retreat stun, AI retreats when outmatched; fix arena stuck on a failed battle submission

## [0.30.0] - 2026-10-21

Floating panels tile when they overlap: equal sections with their own scrollbars, draggable seams, per-seam padlocks that lock panels into columns, height locks on the corner grip, a column-length handle and a per-panel move handle.

## [0.29.0] - 2026-10-20

- **Rivers on the adventure map** (map-gen **v5**) — procedural rivers run between two bodies of water (lakes or swamps), drawn as water over the biome underneath, not as a terrain value. Two kinds: **small** (crossable, costs a full day — all 7 movement points) and **wide** (impassable except at baked bridges, cost 1), with ~one bridge every 8 cells. The A*-guided meander walk descends a distance-to-sink field with a momentum term (no U-turns, soft turns cheap) plus a slight biome-boundary bias, and never self-touches, merges, or forms more than a 3-way junction.
- **Everywhere a hero moves respects rivers** — pathfinding, AI, charters, the path preview's reachable split, the tile popup's effective cost, and castle placement reachability; resources and castle candidates skip river cells.
- **Water is baked once, tinted by the biome** — overlay tiles (end/straight/curveC/curveCC/curve120C/curve120CC for small and wide, plus a wide bridge) rasterised deterministically by tools/sprites/gen-river-tiles.mjs (byte-stable, no API) with anti-aliased alpha banks that pick up grass/sand/snow underneath; the painter auto-tiles them from the six-bit neighbour mask, pours each end into its body of water through a mouth wedge, and hides the water under uncharted black while letting it dim through released fog. The minimap draws the river line with a bridge tick.
- **Map-gen v5 keeps v1–v4 maps intact** — rivers append after every terrain pass, so a saved v4 game keeps its exact terrain while fresh games rebuild with rivers; MapGenVersion gained 5 and the stored-version unions now reuse the shared type.

## [0.28.0] - 2026-10-20

Farm plots: two model-refined styles join the per-cell rotation

- **`farmWheatAI` and `farmOrchardAI`** (`building-pixel-farm{Wheat,Orchard}AI-1.png`) are edits of the procedural wheat and orchard plots made with an OpenRouter image model (`google/gemini-2.5-flash-image`). The input carries a magenta guide line over the exact 2:1 footprint, which the model treats as a measuring guide and drops; the output is checkerboard-stripped and then edge-fitted to the grid. They are committed PNGs — no runtime model call.
- **The rotation is now seven styles.** `FARM_PLOT_VARIANTS` gained the two variants, so `farmPlotVariantAt` mixes them per cell with the five procedural plots. Still render-time only: nothing is persisted and no save migration is needed, though a settlement's fields can pick a different style than before because the hash length changed.
- **Why the fit step exists:** without the guide the model redraws the tile at 30-32 deg (a true isometric camera) against the city grid's 26.57 deg, so the ground diamond's lower edges were measured and scaled to exactly 0.5 slope — 0.2% correction for the orchard, 16% for the wheat, which is why the wheat variant reads flatter than its procedural counterpart. Pipeline and angle table: `docs/sprite-pipelines.md` §4.1, provenance in `docs/asset-provenance.md`.

## [0.27.0] - 2026-10-20

### Logistics hero block, iso-pile resource default, new-game defaults

**Logistics hero section, condensed.** The hero's five cargo resources were five full-width label rows plus a totals line (~318px). They are now one wrapping strip of icon chips
(the panel's iso-pile sprites, `icon + stored/cap`) with the purse, wagon and cart totals moved onto the section header, matching the settlement block. The section is ~128px and
the whole window nearly fits without scrolling. The two wagon-slot rows keep their -1/+1 buttons.

**Iso piles by default on the map.** `DEFAULT_RESOURCE_STYLE` is now `isometric-pile` (the iso resource piles) instead of `rune-stone`. Settings persist as one object, so a store
written before this change would have kept the old default forever: `loadFromStorage` now honours a `schemaVersion` (absent = v1), converts a v1 `rune-stone` to the new default
once, and every write stamps v2. The Settings "Reset to default" button uses the exported constant rather than a second hardcoded copy.

**New Game defaults.** Home's form and the toolbar dialog now open with 1 human player, 1 AI enemy, a Medium map, and Uncharted mode checked (previously 1 / 0 / Small / off).
The visual-regression fixture pins its own settings (small, 0 AI, revealed) so a future default change cannot rewrite the baselines.

Verified: test:unit, the browser suites, and visual baselines regenerated for the iso-pile sprites.

## [0.26.0] - 2026-10-20

### Click a hero or settlement again to put it down

A map click is a toggle. Clicking your hero selects it (the hero panel opens); clicking that same hero again clears the selection and closes the panel -- including after moving it, which is the
gesture the playtest asked for: select, move, click it once more. Same for a settlement: click to select, click again to deselect. Clicking a different hero or settlement switches selection, and
with only a settlement selected, a click on empty ground puts it down instead of toasting "Select a hero first".

The deselect goes through `TurnController.clearSelection()` / `clearSettlementSelection()` -- the same reducers the panels' own `onClose` runs -- so a click and a close cannot leave different state behind.
The resolver takes `clickCount` (`MouseEvent.detail`) and only toggles on the first click: the second click of a double-click must not deselect, because double-clicking a settlement is the city-entry gesture.

Tests: six cases in `test/screens/adventure/clickIntent.test.ts` (toggle, switch, double-click guard for both surfaces, empty-ground deselect); `makeState` gained a `selectedSettlementId` override.

## [0.25.0] - 2026-10-20

### Escape closes every panel, from one place

Every floating surface in the game is now a **panel** (`FloatingPanel`, `src/screens/shared/panel.ts`) and every centred
modal a **dialog** (`openDialog`, `src/screens/shared/dialog.ts`); "menu" now means an actual command list only. The old
`src/screens/shared/menu.ts` and `panelStack.ts` are gone, replaced by those two modules plus `src/screens/shared/panelManager.ts`.

`panelManager` holds the single window `keydown` listener (capture phase) and closes the topmost open panel on Escape, so a
surface is Escape-closable by existing. That covers Settings, New Game, Load Game, Logistics, Keyboard & Mouse, Battle
Results, Test Battle Setup, the hero and settlement panels and both rosters, tile info, the game log, and every city-view
panel (City Design, Workforce, Recruitment, build palette, building and selection menus). Previously Settings, Load Game
and Logistics had no Escape at all, and six modules each wired their own listener.

One Escape does one thing, in a fixed order: an in-flight worker drag or pending build placement cancels first, then the
topmost panel closes (a tooltip inside the Logistics window takes the first Escape, the window the next), then the city's
tile selection clears, then the view closes. The City Design box opts out (`escapeClosable: false`) because the city view
owns it and closing it would strand the player without Build/Back. Hidden long-lived panels are never targets, so a closed
panel cannot swallow the key.

Also fixed while consolidating: a long-lived panel's × destroyed DOM the game keeps re-showing (hero/settlement panels,
rosters, tile info now hide and stay reusable), and closing the build palette from its own × left the City Design button
reading *Close* until an unrelated refresh.

Deleted as duplicates: the per-modal Escape listeners in `charterModal` and `assaultConfirmModal` (now `setOnEscape`
hooks) and `hotkeysModal`, the `escape` option on the dialog dismiss options, `UIManager`'s global Escape handler, the city
view's Escape branches naming each panel, and the hand-built modal backdrop in `confirmDialog`/`leaveBehind` (both now use
`openDialog`). Creation boilerplate collapsed into `createPanel({ key, defaultPosition, ... })`.

The toolbar's gear dropdown closes on Escape as well; it is a menu rather than a panel, so it keeps its own listener.

## [0.24.0] - 2026-10-20

The City Design panel is a normal floating menu, and every floating panel/menu can now be resized.

- **City Design is a movable floating panel** — the city view's Build / Workforce / Recruit / Back box was a hand-styled fixed div at a hardcoded z-index; it is now a `PopupMenu` like the workforce and recruitment panels: drag it by its title bar and it stays where you put it (position remembered between sessions under the `cityDesign` key), it joins the panel click-to-front stack, it carries the shared corner resize grip, and its first open still runs the collision solve so it cannot bury another panel. It has no close button on purpose — the city view owns its lifetime and nothing else reopens it, so an × would strand the player without Build or Back.
- **Every floating panel and menu is resizeable** — the recruitment panel's corner grip is now the shared default: hero and settlement panels, the Heroes/Settlements rail rosters (the grip hides while a roster is docked in the rail and the remembered size returns when you pop it out), City Design, Workforce, Recruitment, the build palette, building and selection menus, the adventure map's tile info, the game log, and the Keyboard & Mouse, Logistics, Battle Results and Test Battle Setup windows. Each panel remembers its own size (`heroesJs.panelSize.v1`), separate from its position. Confirm prompts and small forms (New Game, Load Game, Sign In, Settings, Multiplayer Lobby, Assault confirm) keep their fixed layout.
- Resizing now measures and applies the bordered box, so reopening a resized panel no longer creeps it 2px wider each time.
- **Two new mounted hero variants: Black Dragon Rider and Red Dragon Rider.** Both are repaints of the existing Drake Rider's chunky pixel-art dragon and rider — an obsidian-black dragon with indigo-violet sheen and a black/silver rider, and a crimson-scarlet dragon with ember-orange membranes and a black/brass rider. They appear in the recruit picker with no UI change and have their own 320×100 roster banners (stormy twilight and volcanic sunset).
- Both variants ship all eight headings. The `se`/`sw` diagonals were regenerated from the front view after the side-profile versions measured too close to `e`/`w` at map size; they now read as genuine three-quarter views, head-right and head-left respectively. Base frames only (no `-2` gallop files), so both run frames render the base sprite.
- `gemini-hero-sprite.mjs` gained `--subject <noun>` (dragon-facing wording instead of "horse and rider") and a `{{HEAD_SIDE}}` prompt placeholder for the explicit three-quarter composition rule. `test/render/dragonRiderArt.test.ts` pins both 8-way 512px file sets, and `test/heroVariants.e2e.ts` now A/B diffs both riders against the drake (`darkened` / `reddened` signals).
- The starter-variant draw now ranges over 16 variants, so the three adventure visual baselines were regenerated; the churn is the hero sprite and panel banner only.

## [0.23.0] - 2026-10-20

Trade-route carts that meet a hero no longer idle out the rest of the day, and a hovered cart's route preview follows a moving hero.

- **Meeting a hero now costs nothing** — a hero destination delivers the wrap the cart lands on the hero's tile and the flip spends whatever movement is left walking the fresh return leg in that SAME wrap, so a cart that catches its hero mid-wrap turns around and heads back immediately instead of parking until the next daily tick. When the origin is within that leftover walk it arrives and unloads the same wrap (the dead-hero and foreign-owner flips turn around the same way). Settlement destinations keep their existing arrival cadence.
- **The hovered cart's route line updates as the hero moves** — the preview's tiles came from a snapshot taken at the last daily advance, so it froze on the tile the hero stood on then. A leg whose goal is a hero (`CaravanMarkerSpec.goalHeroId`) now re-projects the line onto the hero's CURRENT tile every frame while the pointer rests on the cart, using the same A* the engine's pre-walk re-target runs at turn end. Settlement legs keep the stored path, a foreign goal hero never moves an own-seat line, and a hero standing on the cart's tile draws no line at all (that meeting is instant).
Farm fields: five grid-exact plot styles, mixed per cell
- **New farm-field art family** (`building-pixel-farm{Wheat,Veg,Orchard,Paddock,Vines}-1.png`) drawn by the deterministic `tools/sprites/gen-farm-sprites.mjs`: a 128x64 logical ground diamond (true 2:1, south vertex on the bottom canvas row) upscaled 8x to the 1024 family size. It carries no side plinth — a 1px outline plus a 2-3px verge — and every prop is trimmed to its own diamond (`clipToPlot`), so a plot sits flush in its 2x2 cells and adjacent fields meet edge-to-edge instead of being sliced by a neighbour's ground.
- **Exact-fit descriptor for the new family:** `hexSizeMul 1.0` (the universal building inset is 0.9) and a generated `anchorOffsetY 0`, so the ground diamond lands on the footprint's cell corners. The legacy `farmField` art keeps the 0.9 convention and stays on disk for comparison.
- **Per-cell variety:** `farmPlotVariantAt(settlement, gx, gy)` (FNV-1a over the cell) picks one of `FARM_PLOT_VARIANTS` at render time, so a settlement's fields mix styles and a reload never reshuffles them. Nothing is persisted, so no save migration; each variant is already its own keyed sprite, which is what a later split into player-chosen, goods-producing farm kinds will build on. `?farm=<variant>` (or `farmField` for the legacy art) still forces one style for review.

## [0.22.1] - 2026-10-20

- **Light unicorn rework:** the old 64px `bubbly` slot is now the dark unicorn's radiant counterpart — a 512px pearl-white unicorn with a gold horn, a silver-gold mane and a dawn roster banner — and its recruit label reads **Light Unicorn**. Six adventure-map headings plus gallop frames.
- **Dark unicorn completes its turnaround:** `ne/nw/se/sw` were generated from the east/west profiles instead of re-posed from the rear/front views (which produced a mirrored `nw` and two straight-on duplicates), so both unicorns now face every map heading rather than falling back to a cardinal.
- `gemini-hero-sprite.mjs` gained `--riderless` (mount-only facing wording), `--pose-ref` (the reference's actual heading for a diagonal repaint) and `--suffix` (run-frame output names); `test/render/unicornArt.test.ts` pins the two unicorns' 512px base/run-frame file sets on disk.

## [0.22.0] - 2026-10-19

- **Dense forest biome** (new `denseForest` terrain, map-gen **v4**): a rarer, **impassable** second forest — `TERRAIN_COST` is `Infinity`, so heroes path around it exactly like mountains and water. It is generated last, seeded on a non-forest neighbour of a forest tile and grown with a 0.75 bias toward frontier tiles that still touch normal forest, so it usually borders the forest it grew out of while its outer rim still meets the surrounding biomes. `DENSE_FOREST_FRACTION` is 0.06 against forest's 0.15; it never overwrites forest, water or mountain and never carries a resource deposit.
- **Map-gen v4 keeps v1–v3 maps intact** — `MapGenVersion` gained `4` and `CURRENT_MAP_GEN_VERSION` is the single source for "new game", so a fresh game is built on the grid a reload regenerates while saved v3 games keep their exact terrain. v4 only *adds* dense forest on top of the identical v3 grid.
- **Forest-edge wood bonus in the district city view:** a `forest` hex that touches a `denseForest` hex gains one extra `wood` spot (`DENSE_FOREST_BONUS_SPOT`, `vein: "dense"`) on its 5×5 district grid — 4 spots instead of 3, alongside the spots it already had. Wired through the client `GameEngine`/`UIManager`, the server `PlaceBuildings` handler and startup districts, so optimistic and authoritative grids agree.
- Dense forest gets its own map art (a three-crown thicket over a near-black floor, denser than a forest tile), its own `TERRAIN_COLORS` entry, and a city-backdrop palette so settlements beside one render correctly. Districts cannot be placed on it (`isForbiddenDistrictTerrain`, shared by the city view's open gate and the reducer).

## [0.21.0] - 2026-10-19

Recruitment panel: unit rows accordion their buildings and bulk buy/staff

- The unit row (its image) is now the panel's parent: clicking it accordions down one row per building that trains that unit, collapsed by default. The parent never opens an individual building's menu; only the nested building rows do, exactly as an iso-grid click does.
- The parent row buys across every one of those buildings (shift-click takes the pooled maximum) and its worker stepper staffs them all at once (`−`/`+` = one worker per building, emptiest-first for add / fullest-first for remove, capped by the idle pool; a legacy auto-staffed settlement stays a single explicit step so the engine's auto-crew is not double-spent). Its `−`/`+` sit right-aligned, directly above the nested rows' steppers.
- `RecruitmentSource` now carries its own `workers`/`maxWorkers`, so the same stepper helpers serve a source and a building row; `test/cityView.test.ts`'s `testRecruitmentPanelAccordion` drives the real panel (collapsed default, expand without a menu or recruit, nested row opens the building menu at the building, parent staffs both farmhouses server-verified, shift-click drains both draft pools for 6 peasants).

## [0.20.0] - 2026-10-19

- Three new map tiers above `epic`: **Colossal** (180×135, 24,300 hexes), **Titanic** (240×180, 43,200 hexes) and **Gigantic** (300×225, 67,500 hexes), keeping the 4:3 aspect ratio every renderer, minimap and camera path assumes.
- The ladder is now one ordered array: `MAP_SIZE_ORDER` in `packages/engine/src/map/gameMap.ts`, with `MapSize` derived from it and `MAP_SIZES` keyed by the same type, so a further tier is one array entry plus its size row.
- Every size selector reads the registry (`MAP_SIZE_ORDER` + `mapSizeLabel`): the full-screen New Game form and the shared New Game modal both list all eight tiers in ladder order, so a new tier needs no selector edit. Both surfaces now print the same `×` separator (the modal previously used `x`).
- `isMapSize()` is the single size predicate — `POST /games`'s `storedMapSize` and the AI driver's persisted-size read use it instead of their own literal name lists — and every client/server signature that spelled out the five-name union now uses `MapSize`.
- Existing names (`small` … `epic`) are unchanged so saved games keep their `map_size`; no scaling rule needed per-tier branching because terrain blob counts, castle counts/spacing, AI target reach and the minimap mist LOD all derive from `width × height`.
- `test/engine/mapSizeLadder.test.ts` pins the ladder (ordering, 4:3, generated dimensions and tile counts, `isMapSize` rejecting prototype keys, label formatting), and the map-reconstruction test now iterates `MAP_SIZE_ORDER` instead of a hard-coded list.
- Verified end-to-end on a worktree dev instance with Playwright: each new tier created through the New Game form, `map_size` persisted, the `/tiles` grid matching `width × height` (24,300 / 43,200 / 67,500 rows), and the client rendering the map. Full unit suite: 2,118 passing.

## [0.19.0] - 2026-10-19

- Three new mounted hero variants, each a full repaint of an existing one and all shipping **eight** directions (no diagonal→cardinal fallback), base frames only, plus a 320x100 roster banner:
  - **Frost Warden** (`frostwarden`, commander-12, from `paladin`): ice-white roan horse, silver-white mane, silver plate with a white fur collar, pale-cyan cape, frosted helm.
  - **Grave Warden** (`gravewarden`, commander-13, from `shadow`): near-black horse with a violet sheen, blackened iron-and-bone plate, tattered dark-green cloak, horned helm with a necrotic green visor glow.
  - **Storm Rider** (`stormrider`, commander-14, from `ranger`): dappled blue-grey horse, blue-grey leather over bronze-studded mail, storm-ochre cloak with a lightning hem, navy hood, lightning-etched yew bow.
- Art generated with `google/gemini-3.1-flash-image` via OpenRouter (`google-vertex/global`) through `tools/sprites/gemini-hero-sprite.mjs`; prompts, override prompts, reference hashes and per-file alpha bounds are committed under `design/hero-variants/{frostwarden,gravewarden,stormrider}/` (1024² masters gitignored). Three `ne`/`nw` sprites were regenerated after the first pass came out mirrored, and the manifests record the exact override used.
- `test/heroVariants.e2e.ts` is now table-driven (`VARIANTS`): for each generated variant it seeds the variant into a real game, asserts the client holds it, resolves all eight `horse.<variant>.*` descriptors plus its banner as real PNGs, asserts the recruit-picker entry and the paladin's unchanged 16-key descriptor set, and A/B diffs the same map tile against the variant it was repainted from — requiring the palette shift the art was made for (reddened capes, darkened/greened undead horse, cooled frost/storm palettes).
- The three adventure visual baselines were regenerated for the usual reason: a new registry entry shifts the seeded starter-hero variant draw, so several heroes and one hero-panel banner change. City-view and battle-arena baselines are byte-identical.

## [0.18.0] - 2026-10-19

feat(recruitment): consolidated recruitment panel with a shared drag-and-drop garrison grid

The city view gains a **recruitment panel** (⚔ Recruit in the City Design box, or `r`): every recruit source in a settlement and its districts collapses into one block per building kind, with ready/capacity totals, live `+N/wk` refill recomputed from actual staffing, resource-pile cost icons, per-building worker steppers (peasant sprite, `n/max`/`Auto`, `−`/`+` committing `AssignWorkers` district-true), a per-kind **Buy all** that takes from the most-stocked building first and then round-robins, `+` for one and shift-click for the affordable maximum, and hover tooltips instead of prose. Each commit rides the existing `RecruitUnits` with the source building's own coords + district, so a district barracks works without that district being open. Its building list scrolls inside the panel and the panel is resizeable (corner grip, size remembered) — the resize grip is a shared `panelResize.ts` any panel can adopt with one option.

Armies and garrisons become one drag-and-drop representation: `src/screens/shared/squadGrid.ts` (4×2 square tiles, unit PNG + count badge) backs the hero panel's Army section and both garrison surfaces, so the settlement panel and the recruitment panel mount one `GarrisonView` and a drag on either re-renders both. Within a grid a drag swaps two slots (new `ReorderGarrison` command); between the garrison grid and the hero's army grid it moves troops through `TransferUnits` into the dropped slot.

Clicking a building's row in the recruitment panel — the kind's heading, a per-building line, or a unit's own row (the unit art), anywhere but on a button — opens that building's own menu: the same one an iso-grid click opens, placed at the building and ringing it until the menu closes. A unit row opens the building it recruits from (its fullest source, the one `+` draws on); a row in another district switches the city view there first through the engine's own district door.

## [0.17.0] - 2026-10-19

- Caravans are now eight-directional: supply wagons and treasury carts each have their own sprite for every compass heading and turn to face the way they are walking, like heroes, instead of one side view with a horizontal flip.
- The diagonal and rear headings are genuinely distinct, not repeated side views: `n` shows the cart from behind with the horse's hindquarters beyond it, and the generated `nw`/`sw` rear-quarter sprites are mirrored into `ne`/`se` so both diagonal pairs read correctly at map scale.
- Treasure carts now read as a distinct vehicle: a two-wheeled, red-bannered cart with a pale horse and gold cargo, visibly different from the brown four-wheel supply wagon.
- Own caravans reveal a 2-tile vision ring (a hero sees 4), so a wagon on the road lifts the fog around itself.
- Hovering a caravan rings it and, for your own caravan, draws its remaining route to the destination as a dashed line with a destination ring. Enemy caravans ring only, so their destination is not revealed.
- New art pipeline `tools/sprites/gen-caravan-sprites.mjs` redraws the existing wagon/cart from six camera headings via FLUX-2-klein image editing, then derives the opposite diagonals by mirroring and downscales all eight by one shared scale.

## [0.16.0] - 2026-10-19

- New mounted hero variant **Paladin 2** (`paladin2`, commander-11, label "Paladin 2"): a darker gilded "Paladin of the Ember Oath" repaint of the existing paladin — charcoal dappled warhorse with a silver-white mane, blackened-steel plate with gold filigree, crimson tabard and cape. All **eight** directions ship (no diagonal→cardinal fallback), base frames only, plus its 320×100 roster banner.
- The original `paladin` is untouched: same registry entry, same four cardinal sprites, same 16 descriptor keys (8 directions incl. fallbacks × base/frame-2). A Playwright assertion pins that set.
- Added `tools/sprites/gemini-hero-sprite.mjs`: an OpenRouter Gemini image-in → image-out generator for hero variants that keys the model's flat grey background with a border flood fill, then frames the result to the reference sprite's alpha bounding box (same content height, bottom edge and centre) so generated art lands in `commander-<N>/` at the original's scale.
- Art generated with `google/gemini-3.1-flash-image` pinned to `google-vertex/global`; prompts, reference hashes and per-file alpha bounds are committed under `design/hero-variants/paladin-2/` (1024² masters gitignored).
- New `test/heroVariants.e2e.ts` (`npm run test:heroVariants`, part of `test:all`): recruits the variant into a real game, asserts the persisted `horseVariant` reaches the client, resolves all eight `horse.paladin2.*` descriptors and the banner as real PNGs, and A/B diffs the same map tile against the original paladin to prove the new sprite actually paints (726 changed px, 114 reddened by the cape, 395 darkened by the charcoal horse).

## [0.15.0] - 2026-10-19

- Settlement panel: the settlement's own name is now the panel's first text (the header), with its owner beside it; the line under the banner labels the holding and its tier (`SETTLEMENT L1`) instead of repeating the name.
- The **⌂ Settlements** roster rows take the same double-click as the panel banner: the map centres on that settlement and its city view opens, through the same own-settlement/own-turn gate.

## [0.14.0] - 2026-10-19

- Settlement panel: the settlement's own name and tier now render at the top (the name was written into the level badge and immediately overwritten, so it never appeared).
- Double-clicking the panel banner enters that settlement's city view, through the same own-settlement/own-turn gate the map's double-click uses.
- Warehouse section is a vertical list: 16px icons, stock, and a signed per-day rate per resource (production minus building upkeep / population food), amber while a stock drains, with the produced/spent split in each row's tooltip.
- Food row reads `stock +/-net/day` with a made-vs-eaten tooltip instead of `stock / required`.
- Treasury row shows `gold / cap`; the separate "Treasury capacity" row is gone.
- Settlement banners resolve through `settlementBannerUrl()` with a tier-1 fallback, so an out-of-range level cannot blank the panel or drop the roster row's background.

## [0.13.0] - 2026-10-18

Startup districts: tier-2 settlements are born with 1 district and tier-3 with 2 (a couple of level-1 buildings each), every district must join the settlement's cluster (no floating districts, bridged across water only by a water district holding a shipyard), and the new water-only shipyard building + art.

## [0.12.0] - 2026-10-18

City view: per-settlement biome settlement diorama backdrop (default, with a watercolor-skybox fallback), a see-through outline-only grid with a City grid lines toggle, and a diorama plate sized from the measured grid footprint for 10x10/15x15 cities.

## [0.11.0] - 2026-10-18

Logistics panel: icon stockpiles with floating tooltips, inline wagon/cart purchases with price tooltips, and one-row compact route visualization

## [0.10.0] - 2026-10-18

Workforce staffing system: per-100-pop worker pool, assignable staffing scaling production/draft recharge/upgrade speed. The first assignment auto-crews the remaining pool (jobs first by kind, then houses), workers/draft survive the city-view round-trip, and drag/panel lifecycle fixes land with it (drops over UI cancel, the panel closes with the city, Escape closes it first).

## [0.9.1] - 2026-10-17

Move game version/build info from the settings panel footer into the toolbar gear dropdown
fix(economy): round stored settlement gold and warehouse quantities half-up to whole integers at the write points

## [0.9.0] - 2026-10-17

feat: uncharted fog-of-war mode

## [0.8.0] - 2026-10-17

feat(districts): add city districts on controlled territory hexes (5x5 district grids, adventure map district sprites, economy/storage pooling, and enemy hero occupation blocking) and 20 new Tier 1 settlement sprites (`4 variants × 5 building-count fullness stages`)

## [0.7.0] - 2026-10-17

feat(hud): isometric resource icons and a population capsule in the header bar

## [0.6.0] - 2026-10-16

Tier 4 large-map scaling (v3 mapGenVersion, proportional blobs/settlements, mandatory castle connectivity, AI reach scaling), charter/sprite optimizations, dirty-entity persistence, and nginx web-runtime

## [0.5.2] - 2026-10-12

chore: enable default worktree-first workflow in heroes-js; align AGENTS.md, agents, commands, skills; Phase 05 concurrency+recovery drill merged

## [0.5.1] - 2026-10-12

test: add tsconfig.test.json (ambient Vite types in scope) and a test:types script, gate unwired

## [0.5.0] - 2026-10-11

feat(heroes): add the lionheart mounted hero variant with banner, names and directional sprites

## [0.4.0] - 2026-10-11

feat(ui): restyle the toolbar with a two-row layout and selectable modern/classic-blue themes

## [0.3.8] - 2026-10-11

test(visual): classify the real target-close message in isReloadRace

## [0.3.7] - 2026-10-11

test(visual): harden the visual-regression gate against reload races

## [0.3.6] - 2026-10-11

chore(sprites): computed building-anchor offsets with drift gate

## [0.3.5] - 2026-10-11

nginx cache gateway in front of vite preview: immutable hashed /assets, no-cache index.html, no-store and unbuffered /api so the SSE event stream is never stalled

## [0.3.4] - 2026-10-11

fix(upkeep): suppress unfed-troops warnings while the entity is currently affordable (pure read-side evaluators, panel badge gates, weekly-charge cadence tooltips); the weekly charge itself is unchanged

## [0.3.3] - 2026-10-11

Make building-sprite coverage exhaustive over BuildingKind, so a new kind cannot ship a blank tile.

## [0.3.2] - 2026-10-11

Anchor the version gate's already-bumped check to the newest release tag so it stops going blind once another commit lands on top of a release.

## [0.3.1] - 2026-10-10

### Added

- **`npm run version:bump -- patch|minor|major|X.Y.Z`** — the app's version-bump
  routine. Rewrites the root `package.json` version in place (formatting
  preserved), prepends a `CHANGELOG.md` entry, and optionally commits, tags and
  pushes (`--commit` / `--tag` / `--push`). `--dry-run` previews without
  writing, and `-m "..."` overrides the default git-log summary.
- **`CHANGELOG.md`** — baseline entry for 0.3.0 (the contents of the current
  release) plus the versioning policy.
- **A Versioning section in `AGENTS.md`** — declares the root `package.json`
  version the single source of truth, the tag format `v<semver>`, and the
  semver meanings while the major is `0`.
- **Guard tests** (`test/core/version.test.ts`) — the app version must be valid
  semver, and `vite.config.ts` must keep stamping version, commit hash and build
  time from `package.json`, so the chain
  `package.json → define → core/version.ts → settings footer` cannot silently
  break.

### Fixed

- **Docker builds now stamp a real commit hash.** `.git` is excluded from the
  build context (179 MB of PNG art history; copying it in would grow the 340 MB
  context to ~520 MB), so the container could never resolve a commit and every
  deployed build reported the literal fallback — the settings panel's build info
  read `v0.3.0 (dev)`. `docker/Dockerfile` now takes
  `ARG VITE_COMMIT_HASH`, compose passes it to both `api` and `web`, and
  **`npm run docker:build`** resolves it on the host and forwards it. A bare
  `docker compose build` still defaults to `dev`, which is why `AGENTS.md` now
  routes Docker builds through the wrapper.
- **`.dockerignore` tightened** — `local/` (115 MB, and `AGENTS.md` forbids
  committing anything under it), `design/` (86 MB) and a bare `.env` now excluded.
  All three were shipping into every build context.

## [0.3.0] - 2026-10-10

Baseline entry, added when the changelog and the version-bump routine were
introduced. The version field had never been changed since the initial commit,
so the history before this entry is not itemized here — see `git log` for the
345 commits that precede it.

### What 0.3.0 contains

- **Rendering**: the whole draw path rebuilt around the SceneGraph seam
  (`buildAdventureScene`/`buildCityScene`/`buildBattleScene` → `paintScene`),
  entity rendering through `EntityMirror`, and the per-kind painter set
  consolidated to one implementation.
- **Sprites**: registry-driven arena unit art, horse run-cycle frames, four
  faction rosters (human, ashen, ironmark, verdant) with icons, banners and
  buildings, and a code generator that derives the building-sprite key list
  from the art folder (`npm run gen:sprite-keys`).
- **Gameplay**: AI enemy seats (client- and server-driven), settlement capture
  and garrison battles, per-hero battle verdicts, the trade-route/caravan
  logistics rework with no shared storage, bank pots, and per-settlement farms.
- **Multiplayer**: SSE event push alongside the poll fallback, presence-aware
  seat drop policy, and the log message panel.
- **Tooling**: Playwright visual-baseline gate, dependency-cruiser layer rules,
  Docker deployment stack, and a build-info footer in the settings panel.
