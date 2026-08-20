import type { Axial } from "../../core/hex";
import { hexDistance } from "../../core/hex";
import type { GameMap } from "../../map/gameMap";
import type { Terrain } from "../../map/terrain";
import { TERRAIN_COST, isPassable } from "../../map/terrain";
import type { ResourceType } from "../../map/resourceTiles";
import { RESOURCE_YIELD } from "../../map/resourceTiles";
import type { Hero } from "../../entities/hero";
import type { Castle } from "../../entities/settlement";
import type { GameState, PlayerId } from "../../state/gameState";
import type { CharterPhase } from "@heroes/contracts";
import { settlementRateRadius, controlledPositions } from "@heroes/engine";
import { colorForOwner } from "../../state/playerColors";
import { isTileVisibleTo } from "../../render/fog";

export interface TileInfo {
  q: number;
  r: number;
  fogged: boolean;
  terrain: { kind: Terrain; label: string; cost: number; passable: boolean };
  deposit: {
    resource: ResourceType;
    yield: number;
    workedBy: { name: string; ownerId: PlayerId | null } | null;
  } | null;
  settlement: {
    name: string;
    ownerName: string;
    ownerColor: string;
    level: 1 | 2 | 3;
    population: number;
    owned: boolean;
  } | null;
  heroes: Array<{
    name: string;
    ownerName: string;
    ownerColor: string;
    troops: number;
    movementRemaining: number | null;
    owned: boolean;
  }>;
  charter: { name: string; phase: CharterPhase; daysRemaining: number } | null;
  territory: { settlementName: string; ownerName: string } | null;
}

function terrainLabel(kind: Terrain): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function playerName(state: GameState, ownerId: PlayerId | null): string {
  if (ownerId === null) return "Neutral";
  return state.players.find((p) => p.id === ownerId)?.name ?? `Player ${ownerId}`;
}

function visibleOrOwned(fogged: boolean, ownerId: PlayerId | null, viewPlayerId: PlayerId): boolean {
  return !fogged || ownerId === viewPlayerId;
}

function describeDeposit(
  map: GameMap,
  castles: readonly Castle[],
  q: number,
  r: number,
): TileInfo["deposit"] {
  const rt = map.resourceTileAt(q, r);
  if (!rt) return null;
  let workedBy: { name: string; ownerId: PlayerId | null } | null = null;
  for (const c of castles) {
    const radius = settlementRateRadius(c.level);
    if (hexDistance(c.tile, { q, r }) <= radius) {
      workedBy = { name: c.name, ownerId: c.ownerId };
      break;
    }
  }
  return { resource: rt.resource, yield: RESOURCE_YIELD[rt.resource], workedBy };
}

function describeSettlement(
  state: GameState,
  q: number,
  r: number,
  fogged: boolean,
  viewPlayerId: PlayerId,
): TileInfo["settlement"] {
  const settlement = Object.values(state.settlements).find((s) => s.q === q && s.r === r);
  if (!settlement) return null;
  if (!visibleOrOwned(fogged, settlement.ownerId, viewPlayerId)) return null;
  return {
    name: settlement.name,
    ownerName: playerName(state, settlement.ownerId),
    ownerColor: colorForOwner(settlement.ownerId),
    level: settlement.level,
    population: settlement.population,
    owned: settlement.ownerId === viewPlayerId,
  };
}

function describeHeroes(
  state: GameState,
  heroes: readonly Hero[],
  q: number,
  r: number,
  fogged: boolean,
  viewPlayerId: PlayerId,
): TileInfo["heroes"] {
  const out: TileInfo["heroes"] = [];
  for (const hero of heroes) {
    if (hero.tile.q !== q || hero.tile.r !== r) continue;
    const owned = hero.ownerId === viewPlayerId;
    if (!visibleOrOwned(fogged, hero.ownerId, viewPlayerId)) continue;
    out.push({
      name: hero.name,
      ownerName: playerName(state, hero.ownerId),
      ownerColor: colorForOwner(hero.ownerId),
      troops: hero.troops,
      movementRemaining: owned ? hero.movementRemaining : null,
      owned,
    });
  }
  return out;
}

function describeCharter(
  state: GameState,
  q: number,
  r: number,
  fogged: boolean,
): TileInfo["charter"] {
  if (fogged) return null;
  const charter = state.activeCharters.find((c) => c.targetQ === q && c.targetR === r);
  if (!charter) return null;
  return { name: charter.settlementName, phase: charter.phase, daysRemaining: charter.daysRemaining };
}

function describeTerritory(
  state: GameState,
  castles: readonly Castle[],
  map: GameMap,
  q: number,
  r: number,
  fogged: boolean,
): TileInfo["territory"] {
  if (fogged) return null;
  let best: { castle: Castle; ownerId: PlayerId; dist: number } | null = null;
  for (const c of castles) {
    if (c.ownerId === null) continue;
    const ownerId = c.ownerId;
    const positions = controlledPositions(c.tile, c.level, map.width, map.height);
    if (!positions.has(`${q},${r}`)) continue;
    const dist = hexDistance(c.tile, { q, r });
    if (!best || dist < best.dist || (dist === best.dist && ownerId < best.ownerId)) {
      best = { castle: c, ownerId, dist };
    }
  }
  if (!best) return null;
  return { settlementName: best.castle.name, ownerName: playerName(state, best.ownerId) };
}

export function describeTile(input: {
  map: GameMap;
  state: GameState;
  heroes: readonly Hero[];
  castles: readonly Castle[];
  viewPlayerId: PlayerId;
  tile: Axial;
}): TileInfo | null {
  const { map, state, heroes, castles, viewPlayerId, tile } = input;
  const kind = map.get(tile.q, tile.r);
  if (!kind) return null;

  const fogged = !isTileVisibleTo(heroes, castles, viewPlayerId, tile.q, tile.r);

  return {
    q: tile.q,
    r: tile.r,
    fogged,
    terrain: { kind, label: terrainLabel(kind), cost: TERRAIN_COST[kind], passable: isPassable(kind) },
    deposit: fogged ? null : describeDeposit(map, castles, tile.q, tile.r),
    settlement: describeSettlement(state, tile.q, tile.r, fogged, viewPlayerId),
    heroes: describeHeroes(state, heroes, tile.q, tile.r, fogged, viewPlayerId),
    charter: describeCharter(state, tile.q, tile.r, fogged),
    territory: describeTerritory(state, castles, map, tile.q, tile.r, fogged),
  };
}
