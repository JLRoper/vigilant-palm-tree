import type { GameState, HeroId, HeroState } from "@heroes/contracts";
import type { UnitType } from "../units";
import { resetHeroMovement } from "../hero/move";
import { applySuppliedHeroUpkeep } from "../hero/upkeep";
import { applyPopulationGrowth } from "../settlement/populationGrowth";
import { applyGarrisonUpkeep } from "../settlement/garrisonUpkeep";
import { advanceCharters } from "../charter/advance";
import { advanceSettlementUpgrades, advanceBuildingConstructions } from "../settlement/advance";
import { applyDraftRecharge } from "../settlement/draftRecharge";
import { upgradeAccelEffort } from "../settlement/workforce";
import { advanceTradeRoutes } from "../logistics";
import { applyCaravanUpkeep } from "../economy/caravanUpkeep";
import { accrueBankInterest, matureBankWithdrawals } from "../economy/bank";
import type { GameMap } from "../map/gameMap";
import { regenerateHeroMana } from "../combat/spells";

// `unitTypes` is optional so catalog-less callers (legacy tests, any client
// reducer that hasn't loaded the catalog) keep working -- the upkeep helpers
// fall back to the per-unit 1g/1f defaults. The server path always passes
// EngineCtx.catalog.unitTypes, because per-unit upkeep is the rule.
export function applyWeeklyUpkeep(
  state: GameState,
  growthRate: number,
  unitTypes?: Record<string, UnitType>,
): GameState {
  // day/round/castleSeed ride along so the upkeep shortfall bookkeeping and the
  // deterministic desertion draw are both reproducible server-side.
  const upkeepOptions = {
    unitTypes,
    day: state.day,
    round: state.round,
    castleSeed: state.castleSeed,
  };
  // Caravan maintenance is charged FIRST — the designer's ordering guarantee
  // ("they are the first to get paid so they start deserting last"). On a
  // shortage week the caravans are paid out of the route's origin store and
  // the HERO below is the consumer that goes unfed. Routes auto-removed by
  // desertion (wagons at 0) simply vanish from tradeRoutes here; the server's
  // EndTurn case derives the removals by route-id set difference and appends
  // the TradeRouteRemoved events.
  const caravanBilled = applyCaravanUpkeep(state, state.day);
  // Heroes second, and settlement-funded: a hero standing on one of its own
  // settlements draws its food bill out of its owner's warehouses (hero/upkeep.ts)
  // BEFORE the garrison bill below runs, and both read the same post-consumption
  // stock -- turn/endTurn.ts's production/consumption pass already ran this turn,
  // so a settlement is never paying out food it was about to consume itself.
  const supplied = applySuppliedHeroUpkeep(caravanBilled.state.heroes, caravanBilled.state.settlements, upkeepOptions);
  const newHeroes = supplied.heroes;
  const newSettlements = applyGarrisonUpkeep(
    applyPopulationGrowth(supplied.settlements, growthRate),
    upkeepOptions,
  );
  // Bank pots earn on the weekly tick, next to the garrison bill -- same
  // cadence as the rest of the recurring upkeep. The base is
  // caravanBilled.state: its tradeRoutes carry the maintenance streaks and
  // its heroes/settlements the caravan payments -- spreading the ORIGINAL
  // state here would silently drop the charge (the settlements chain below
  // happens to re-derive from caravanBilled, the routes would not).
  const withBankInterest = accrueBankInterest({
    ...caravanBilled.state,
    heroes: newHeroes,
    settlements: newSettlements,
  });
  return { ...withBankInterest, dirty: true };
}

export function advanceRound(
  state: GameState,
  growthRate: number,
  map: GameMap | null = null,
  unitTypes?: Record<string, UnitType>,
): GameState {
  // New day: movement resets and hero mana fully refills (spellcasting v1 —
  // locked decision: the day tick is the mana-regen cadence).
  const nextDay = state.day + 1;
  const newHeroes: Record<HeroId, HeroState> = regenerateHeroMana(resetHeroMovement(state.heroes, undefined, nextDay));
  let withDay: GameState = {
    ...state,
    round: state.round + 1,
    day: nextDay,
    activePlayerId: 0,
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    heroes: newHeroes,
    selectedHeroId: null,
    selectedSettlementId: null,
  };
  // The map rides into the charter pass: a `traveling` charter takes one
  // hex-step per day toward its target server-side, so a charter whose client
  // never sent its AdvanceCharterTravel steps still arrives and founds
  // (C-BLOCKER-1). Null on map-less callers, where the pass stays a no-op.
  withDay = advanceCharters(withDay, map);
  withDay = advanceSettlementUpgrades(withDay, { accel: upgradeAccelEffort });
  withDay = advanceBuildingConstructions(withDay);
  const rechargedSettlements = applyDraftRecharge(withDay.settlements, unitTypes);
  if (rechargedSettlements !== withDay.settlements) {
    withDay = { ...withDay, settlements: rechargedSettlements, dirty: true };
  }
  // Caravans need the (deterministically rebuilt) map for A*; without one
  // they simply wait at their current stop (docs plan §5.2).
  withDay = advanceTradeRoutes(withDay, map);
  // Bank withdrawal maturity is a COUNTDOWN, so it runs every day, not on the
  // weekly branch: a 7-day request must land on its own day. state.day has
  // already been incremented above (nextDay), which is deliberate --
  // matureBankWithdrawals compares maturesOnDay <= state.day, so a withdrawal
  // requested on day D matures exactly on day D + BANK_WITHDRAWAL_DAYS, with
  // no off-by-one.
  withDay = matureBankWithdrawals(withDay);
  if (nextDay % 7 === 0) return applyWeeklyUpkeep(withDay, growthRate, unitTypes);
  return withDay;
}
