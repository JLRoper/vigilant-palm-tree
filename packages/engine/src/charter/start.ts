import type {
  CharterState,
  GameState,
  HeroState,
  SettlementState,
  StartCharterPayload,
  StartCharterResult,
} from "@heroes/contracts";

export const CHARTER_GOLD_COST = 2500;
export const CHARTER_WAREHOUSE_COST = { wood: 20, stone: 15 };
export const CHARTER_CONSTRUCTION_DAYS = 10;

export function startCharter(state: GameState, payload: StartCharterPayload): StartCharterResult {
  const hero = state.heroes[payload.heroId];
  if (!hero) return { state, ok: false, reason: "no_hero" };

  // Phase parity with startMove (hero/move.ts:18-23): an AI seat's turn
  // hydrates to AI_TURN, not PLAYER_TURN, so without this admission every
  // server-actor-dispatched StartCharter fails not_player_turn before the
  // human-parity gating below is ever consulted. The AI_TURN branch admits
  // only the acting seat's own hero, exactly as startMove's gate does (a
  // foreign hero during an AI turn is rejected right here, the same way
  // startMove rejects it); the ownership check below still covers a foreign
  // hero on a PLAYER_TURN. Unlike MoveHero this reducer needs no
  // handler-side selection override because it has no selection concept of
  // its own.
  const phaseAdmitsCharter =
    state.phase.kind === "PLAYER_TURN" ||
    (state.phase.kind === "AI_TURN" && hero.ownerId === state.activePlayerId);
  if (!phaseAdmitsCharter) {
    return { state, ok: false, reason: "not_player_turn" };
  }

  if (hero.ownerId !== state.activePlayerId) {
    return { state, ok: false, reason: "not_owner" };
  }
  if (hero.isChartering) {
    return { state, ok: false, reason: "already_chartering" };
  }
  if (hero.gold < CHARTER_GOLD_COST) {
    return { state, ok: false, reason: "insufficient_gold" };
  }

  const provisioningSettlement = Object.values(state.settlements).find(
    (s) => s.q === hero.q && s.r === hero.r && s.ownerId === hero.ownerId,
  );
  if (!provisioningSettlement) {
    return { state, ok: false, reason: "hero_not_at_friendly_settlement" };
  }
  if ((provisioningSettlement.warehouse.wood ?? 0) < CHARTER_WAREHOUSE_COST.wood) {
    return { state, ok: false, reason: "insufficient_wood" };
  }
  if ((provisioningSettlement.warehouse.stone ?? 0) < CHARTER_WAREHOUSE_COST.stone) {
    return { state, ok: false, reason: "insufficient_stone" };
  }

  for (const [id, other] of Object.entries(state.heroes)) {
    if (id !== payload.heroId && other.q === payload.targetQ && other.r === payload.targetR) {
      return { state, ok: false, reason: "occupied" };
    }
  }

  for (const ch of state.activeCharters) {
    if (ch.targetQ === payload.targetQ && ch.targetR === payload.targetR) {
      return { state, ok: false, reason: "hex_already_chartered" };
    }
  }

  for (const s of Object.values(state.settlements)) {
    if (s.q === payload.targetQ && s.r === payload.targetR) {
      return { state, ok: false, reason: "hex_has_settlement" };
    }
  }

  const updatedHero: HeroState = {
    ...hero,
    gold: hero.gold - CHARTER_GOLD_COST,
    isChartering: true,
    charterId: payload.charterId,
  };

  const updatedSettlement: SettlementState = {
    ...provisioningSettlement,
    warehouse: {
      ...provisioningSettlement.warehouse,
      wood: (provisioningSettlement.warehouse.wood ?? 0) - CHARTER_WAREHOUSE_COST.wood,
      stone: (provisioningSettlement.warehouse.stone ?? 0) - CHARTER_WAREHOUSE_COST.stone,
    },
  };

  const charter: CharterState = {
    id: payload.charterId,
    heroId: payload.heroId,
    ownerId: hero.ownerId,
    targetQ: payload.targetQ,
    targetR: payload.targetR,
    settlementName: payload.settlementName,
    phase: "traveling",
    daysRemaining: CHARTER_CONSTRUCTION_DAYS,
    settlementId: payload.settlementId,
    resourceRates: payload.resourceRates,
    foundedOnResource: payload.foundedOnResource,
    citySpots: payload.citySpots,
  };

  return {
    state: {
      ...state,
      heroes: { ...state.heroes, [payload.heroId]: updatedHero },
      settlements: { ...state.settlements, [provisioningSettlement.id]: updatedSettlement },
      activeCharters: [...state.activeCharters, charter],
      nextCharterId: state.nextCharterId + 1,
      nextSettlementId: state.nextSettlementId + 1,
      dirty: true,
    },
    ok: true,
  };
}
