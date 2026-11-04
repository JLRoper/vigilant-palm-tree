import type { BuildingDef, CaptureResult, DistrictState, FactionId, GameState, HeroId, HeroState, PlayerId, SettlementId, SettlementState } from "@heroes/contracts";
import { buildingAllowedForFaction, getBuildingEffect } from "../buildingRegistry";
import { playerFactionId } from "../factionRegistry";
import { heroGoldCap } from "./capacity";
import { starterTroopBuilding } from "./starterLayout";

export const CAPTURE_GOLD_REWARD = 100;

// A captured settlement keeps the buildings it had, but a faction-tagged one
// is a building its new owner could never have placed there (`placeBuildings`'
// wrong_faction gate) and whose every recruit the seat-faction gate refuses,
// so it would sit dead. It becomes the capturing faction's OWN troop building
// -- the kind every settlement of that faction is founded with
// (STARTER_TROOP_BUILDING_BY_FACTION) -- and its draft record goes with it,
// the way a fresh placement carries none.
function seizedBuilding(building: BuildingDef, factionId: FactionId): BuildingDef {
  const tag = getBuildingEffect(building.kind).faction;
  if (tag === undefined || tag === factionId) return building;
  const kind = starterTroopBuilding(factionId);
  if (!buildingAllowedForFaction(kind, factionId)) return building;
  const next: BuildingDef = { ...building, kind };
  delete next.draft;
  return next;
}

export function seizeBuildings(buildings: BuildingDef[], factionId: FactionId): BuildingDef[] {
  let changed = false;
  const next = buildings.map((building) => {
    const seized = seizedBuilding(building, factionId);
    if (seized !== building) changed = true;
    return seized;
  });
  return changed ? next : buildings;
}

function seizeDistricts(
  districts: Record<string, DistrictState>,
  factionId: FactionId,
): Record<string, DistrictState> {
  let changed = false;
  const next: Record<string, DistrictState> = {};
  for (const [key, district] of Object.entries(districts)) {
    const buildings = seizeBuildings(district.buildings, factionId);
    if (buildings !== district.buildings) changed = true;
    next[key] = buildings === district.buildings ? district : { ...district, buildings };
  }
  return changed ? next : districts;
}

export function captureSettlement(
  state: GameState,
  heroId: HeroId,
  settlementId: SettlementId,
): CaptureResult {
  const hero = state.heroes[heroId];
  const settlement = state.settlements[settlementId];
  if (!hero || !settlement) return { state, captured: false, previousOwnerId: null };
  if (hero.ownerId === settlement.ownerId) {
    return { state, captured: false, previousOwnerId: settlement.ownerId };
  }
  const newOwnerId = hero.ownerId;
  const previousOwnerId = settlement.ownerId;
  const factionId = playerFactionId(state.players.find((p) => p.id === newOwnerId));
  const newSettlements: Record<SettlementId, SettlementState> = {
    ...state.settlements,
    [settlementId]: {
      ...settlement,
      ownerId: newOwnerId,
      buildings: seizeBuildings(settlement.buildings, factionId),
      ...(settlement.districts ? { districts: seizeDistricts(settlement.districts, factionId) } : {}),
    },
  };
  const newPlayers = state.players.map((p) => {
    if (p.id === newOwnerId) {
      if (p.settlementIds.includes(settlementId)) return p;
      return { ...p, settlementIds: [...p.settlementIds, settlementId] };
    }
    if (p.id === previousOwnerId) {
      return { ...p, settlementIds: p.settlementIds.filter((id) => id !== settlementId) };
    }
    return p;
  });
  const newHeroes: Record<HeroId, HeroState> = {
    ...state.heroes,
    // Phase 1 heroGoldCap enforcement: the capture reward is clamped to the
    // capturing hero's treasury-cart purse headroom, excess lost -- the Q4
    // soft-cap doctrine (caps gate additions only; stock is never reduced,
    // but neither is gold invented above the cap). This was one of the two
    // uncapped credit sites (transferCargoLoot already clamped).
    [heroId]: { ...hero, gold: hero.gold + Math.min(CAPTURE_GOLD_REWARD, Math.max(0, heroGoldCap(hero) - hero.gold)) },
  };
  return {
    state: { ...state, settlements: newSettlements, players: newPlayers, heroes: newHeroes, dirty: true },
    captured: true,
    previousOwnerId,
  };
}

// Inverse of captureSettlement(): undoes an optimistic client-side capture
// after the server rejected the serialized CaptureSettlement command. Guarded
// so it only fires while the capture is still in place locally (the
// settlement must still be owned by the capturing hero's seat) -- a
// multiplayer sync merge that already corrected ownership makes this a
// reference-stable no-op. Gold subtraction is clamped at 0 because the hero
// may have spent the reward between the capture and the rejection. The
// buildings it seized are not reconstructible from the captured settlement, so
// the caller hands back the settlement as it stood before the capture.
export function rollbackCaptureSettlement(
  state: GameState,
  heroId: HeroId,
  settlementId: SettlementId,
  previousOwnerId: PlayerId | null,
  previousSettlement?: SettlementState,
): GameState | null {
  const hero = state.heroes[heroId];
  const settlement = state.settlements[settlementId];
  if (!hero || !settlement) return null;
  if (settlement.ownerId !== hero.ownerId) return null;
  const newSettlements: Record<SettlementId, SettlementState> = {
    ...state.settlements,
    [settlementId]: {
      ...settlement,
      ownerId: previousOwnerId,
      ...(previousSettlement
        ? {
            buildings: previousSettlement.buildings,
            ...(previousSettlement.districts ? { districts: previousSettlement.districts } : {}),
          }
        : {}),
    },
  };
  const newPlayers = state.players.map((p) => {
    if (p.id === hero.ownerId) {
      return { ...p, settlementIds: p.settlementIds.filter((id) => id !== settlementId) };
    }
    if (p.id === previousOwnerId && !p.settlementIds.includes(settlementId)) {
      return { ...p, settlementIds: [...p.settlementIds, settlementId] };
    }
    return p;
  });
  const newHeroes: Record<HeroId, HeroState> = {
    ...state.heroes,
    [heroId]: { ...hero, gold: Math.max(0, hero.gold - CAPTURE_GOLD_REWARD) },
  };
  return { ...state, settlements: newSettlements, players: newPlayers, heroes: newHeroes, dirty: true };
}
