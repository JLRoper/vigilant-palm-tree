import type { Axial } from "../../core/hex";
import { hexDistance } from "../../core/hex";
import type { GameMap } from "../../map/gameMap";
import type { Terrain } from "../../map/terrain";
import type { ResourceType } from "../../map/resourceTiles";
import { RESOURCE_YIELD } from "../../map/resourceTiles";
import type { Hero } from "../../entities/hero";
import type { Castle } from "../../entities/settlement";
import type { GameState, PlayerId } from "../../state/gameState";
import type { CharterPhase } from "@heroes/contracts";
import { isCoveredWagonId, resolveGameMode } from "@heroes/contracts";
import { canFoundSettlement, districtKey, isDistrictBlockedByHero, resolveControllingSettlement, settlementRateRadius, platoonTroopTotal, type FoundSettlementRefusal } from "@heroes/engine";
import { colorForOwner } from "../../state/playerColors";
import { isTileVisibleTo } from "../../render/fog";
import { districtVariantForBuildings } from "../../render/scene/sceneBuilder/adventureScene";

export interface TileInfo {
  q: number;
  r: number;
  fogged: boolean;
  terrain: { kind: Terrain; label: string; cost: number; passable: boolean } | null;
  river: {
    kind: "small" | "wide";
    bridge: boolean;
    label: string;
    cost: number;
    passable: boolean;
  } | null;
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
  district?: {
    settlementName: string;
    ownerName: string;
    buildingCount: number;
    variant: "standard" | "farm";
    blocked: boolean;
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
  /**
   * The settlers mode's founding read for this tile (SETTLERS-PLAN.md §4 W4):
   * the viewing seat's own covered wagon standing here, if any, and what the
   * engine's own rule answers about planting on this hex. Absent in a classic
   * game, where founding is the charter flow's business -- so the panel says
   * nothing new to a classic player.
   */
  founding?: {
    wagonName: string;
    canFound: boolean;
    /** The engine's refusal code when `canFound` is false -- the same vocabulary the server relays. */
    refusal: FoundSettlementRefusal | null;
  } | null;
}

function terrainLabel(kind: Terrain): string {
  const spaced = kind.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
      troops: platoonTroopTotal(hero.stacks),
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

function describeDistrict(
  state: GameState,
  castles: readonly Castle[],
  heroes: readonly Hero[],
  q: number,
  r: number,
  fogged: boolean,
  viewPlayerId: PlayerId,
): NonNullable<TileInfo["district"]> | null {
  const key = districtKey(q, r);
  for (const c of castles) {
    const d = c.districts?.[key];
    if (!d || d.buildings.length === 0) continue;
    if (!visibleOrOwned(fogged, c.ownerId, viewPlayerId)) continue;
    return {
      settlementName: c.name,
      ownerName: playerName(state, c.ownerId),
      buildingCount: d.buildings.length,
      variant: districtVariantForBuildings(d.buildings),
      blocked: isDistrictBlockedByHero(
        c.ownerId,
        q,
        r,
        heroes.map((h) => ({ ownerId: h.ownerId, q: h.tile.q, r: h.tile.r })),
      ),
    };
  }
  return null;
}

/**
 * The settlers-mode founding read for a tile (SETTLERS-PLAN.md §4 W4). Only
 * ever answers for the VIEWER's own wagon standing here: an enemy wagon is not
 * the player's to found with, and a classic game has no wagons at all
 * (`resolveGameMode(state.gameMode)` gates the whole thing, so a classic panel
 * is byte-identical to before).
 *
 * The verdict is the ENGINE's (`canFoundSettlement`) with the same map the
 * command handler will build, so the panel cannot promise a hex the command
 * refuses -- and the refusal code it returns is the one the server relays, so
 * the sentence the player reads comes from the same vocabulary.
 */
function describeFounding(
  state: GameState,
  map: GameMap,
  q: number,
  r: number,
  fogged: boolean,
  viewPlayerId: PlayerId,
): TileInfo["founding"] {
  if (resolveGameMode(state.gameMode) !== "settlers") return undefined;
  if (fogged) return null;
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId !== viewPlayerId) continue;
    if (!isCoveredWagonId(hero.id)) continue;
    const tile = (hero as unknown as { tile?: Axial }).tile;
    const hq = tile?.q ?? hero.q;
    const hr = tile?.r ?? hero.r;
    if (hq !== q || hr !== r) continue;
    const check = canFoundSettlement({ state, founderId: hero.id, q, r, map });
    return { wagonName: hero.name, canFound: check.ok, refusal: check.ok ? null : check.reason };
  }
  return null;
}

function describeTerritory(
  state: GameState,
  castles: readonly Castle[],
  q: number,
  r: number,
  fogged: boolean,
  viewPlayerId: PlayerId,
  mapWidth: number,
  mapHeight: number,
): TileInfo["territory"] {
  const winner = resolveControllingSettlement(castles, q, r, mapWidth, mapHeight);
  // The VIEWER's seat, not state.activePlayerId: gating on whoever holds the
  // turn leaks an opponent's territory label through fog to a watching player,
  // and disagrees with describeSettlement/describeHeroes/describeDistrict right
  // beside it in the same panel.
  if (!winner || winner.ownerId === null || !visibleOrOwned(fogged, winner.ownerId, viewPlayerId)) {
    return null;
  }
  return { settlementName: winner.name, ownerName: playerName(state, winner.ownerId) };
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
  const river = map.riverAt(tile.q, tile.r);
  // Classically absent rather than present-and-undefined: a classic TileInfo
  // keeps exactly its previous keys, which is what every existing panel test
  // and every stored signature depends on.
  const founding = describeFounding(state, map, tile.q, tile.r, fogged, viewPlayerId);

  return {
    q: tile.q,
    r: tile.r,
    fogged,
    terrain: fogged
      ? null
      : {
          kind,
          label: terrainLabel(kind),
          // Effective values: the river overlay may change what entering the
          // tile really costs even though the biome underneath stays the same.
          cost: map.cost(tile.q, tile.r),
          passable: map.isPassable(tile.q, tile.r),
        },
    river:
      fogged || !river
        ? null
        : {
            kind: river.kind,
            bridge: river.bridge === true,
            label:
              river.kind === "small" ? "Small river" : river.bridge ? "Bridge" : "Wide river",
            cost: map.cost(tile.q, tile.r),
            passable: map.isPassable(tile.q, tile.r),
          },
    deposit: fogged ? null : describeDeposit(map, castles, tile.q, tile.r),
    settlement: describeSettlement(state, tile.q, tile.r, fogged, viewPlayerId),
    district: describeDistrict(state, castles, heroes, tile.q, tile.r, fogged, viewPlayerId),
    heroes: describeHeroes(state, heroes, tile.q, tile.r, fogged, viewPlayerId),
    charter: describeCharter(state, tile.q, tile.r, fogged),
    ...(founding !== undefined ? { founding } : {}),
    territory: describeTerritory(state, castles, tile.q, tile.r, fogged, viewPlayerId, map.width, map.height),
  };
}
