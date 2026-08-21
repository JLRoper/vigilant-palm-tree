import type { EngineEvent, GameState, HeroState } from "@heroes/contracts";
import { transferGold } from "../economy/transfer";
import { tradeResources } from "../economy/trade";
import { setAutoTrade } from "../settlement/autoTrade";
import { reorderStack } from "../hero/stacks";
import { captureSettlement } from "../settlement/capture";
import { startTownHallUpgrade } from "../settlement/upgradeTownHall";

// Phase 5.A (#146): the reducer the event-cursor client sync applies each
// polled EngineEvent through. Six variants carry only the *fact* of a change
// and not the derived state it produced (TurnEnded's production/upkeep/
// movement reset, BattleResolved's troop losses, HeroRecruited's starting
// stacks, the rng-derived rates behind SettlementUpgradeStarted) -- those
// return "resync" so the caller refetches rather than guesses.
export type EngineEventOutcome = "applied" | "noop" | "resync";

export interface ApplyEngineEventResult {
  state: GameState;
  outcome: EngineEventOutcome;
}

function resync(state: GameState): ApplyEngineEventResult {
  return { state, outcome: "resync" };
}

// HeroMoved carries no movement cost, so movementRemaining is deliberately
// left untouched rather than invented. The drift is bounded: TurnEnded is a
// resync event, so every turn boundary refetches authoritative movement.
function applyHeroMoved(
  state: GameState,
  heroId: string,
  to: { q: number; r: number },
): ApplyEngineEventResult {
  const hero = state.heroes[heroId];
  if (!hero) return resync(state);
  if (hero.q === to.q && hero.r === to.r) return { state, outcome: "noop" };
  const moved: HeroState = {
    ...hero,
    q: to.q,
    r: to.r,
    previousQ: hero.q,
    previousR: hero.r,
    previousMovementRemaining: hero.movementRemaining,
    trail: [...(hero.trail ?? []), { q: to.q, r: to.r }],
  };
  return {
    state: { ...state, heroes: { ...state.heroes, [heroId]: moved } },
    outcome: "applied",
  };
}

export function applyEngineEvent(state: GameState, event: EngineEvent): ApplyEngineEventResult {
  switch (event.type) {
    case "HeroMoved":
      return applyHeroMoved(state, event.heroId, event.to);

    case "GoldTransferred": {
      const result = transferGold(state, event.heroId, event.settlementId, event.direction);
      // An empty purse is what an already-applied transfer looks like from
      // behind; every other rejection means this client's state has drifted.
      if (!result.ok) {
        return result.reason === "nothing_to_deposit" || result.reason === "nothing_to_withdraw"
          ? { state, outcome: "noop" }
          : resync(state);
      }
      return { state: result.state, outcome: "applied" };
    }

    case "ResourcesTraded": {
      const result = tradeResources(
        state,
        event.fromSettlementId,
        event.toSettlementId,
        event.resource,
        event.amount,
      );
      if (!result.ok) return resync(state);
      return { state: result.state, outcome: "applied" };
    }

    case "AutoTradeToggled": {
      if (!state.settlements[event.settlementId]) return resync(state);
      const next = setAutoTrade(state, event.settlementId, event.autoTrade);
      return next === state ? { state, outcome: "noop" } : { state: next, outcome: "applied" };
    }

    case "StackReordered": {
      const result = reorderStack(state, event.heroId, event.fromIdx, event.toIdx);
      if (!result.ok) return resync(state);
      return { state: result.state, outcome: "applied" };
    }

    case "SettlementCaptured": {
      const settlement = state.settlements[event.settlementId];
      if (!settlement || !state.heroes[event.heroId]) return resync(state);
      if (settlement.ownerId === event.actor) return { state, outcome: "noop" };
      const result = captureSettlement(state, event.heroId, event.settlementId);
      if (!result.captured) return resync(state);
      return { state: result.state, outcome: "applied" };
    }

    case "TownHallUpgradeStarted": {
      const settlement = state.settlements[event.settlementId];
      if (!settlement) return resync(state);
      if (settlement.upgrade) return { state, outcome: "noop" };
      const result = startTownHallUpgrade(state, event.settlementId, event.targetLevel);
      if (!result.ok) return resync(state);
      return { state: result.state, outcome: "applied" };
    }

    // Listed per variant rather than swept into `default:` so a new
    // EngineEvent variant trips the exhaustiveness check below.
    case "TurnEnded":
    case "BattleResolved":
    case "HeroRecruited":
    case "CharterStarted":
    case "BuildingUpgradeStarted":
    case "SettlementUpgradeStarted":
      return resync(state);

    default: {
      const exhaustive: never = event;
      void exhaustive;
      return resync(state);
    }
  }
}
