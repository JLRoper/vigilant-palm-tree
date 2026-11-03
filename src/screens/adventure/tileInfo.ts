import type { Axial } from "../../core/hex";
import { hexDistance } from "../../core/hex";
import type { GameMap } from "../../map/gameMap";
import type { Terrain } from "../../map/terrain";
import type { ResourceType } from "../../map/resourceTiles";
import { RESOURCE_YIELD } from "../../map/resourceTiles";
import { previewResourcePickup, resourceRemainingOn, type ResourcePickupRefusal } from "@heroes/engine";
import type { HeroId } from "@heroes/contracts";
import type { Hero } from "../../entities/hero";
import type { Castle } from "../../entities/settlement";
import type { GameState, PlayerId } from "../../state/gameState";
import type { CharterPhase } from "@heroes/contracts";
import { isCoveredWagonId, resolveGameMode } from "@heroes/contracts";
import { canFoundSettlement, districtKey, isDistrictBlockedByHero, resolveControllingSettlement, settlementRateRadius, platoonTroopTotal, type FoundSettlementRefusal } from "@heroes/engine";
import { colorForOwner } from "../../state/playerColors";
import { computeVisionFromState, isTileVisibleTo } from "../../render/fog";
import { districtVariantForBuildings } from "../../render/scene/sceneBuilder/adventureScene";

export interface TileInfo {
  q: number;
  r: number;
  fogged: boolean;
  /**
   * True when the map's own revealed state has this hex (uncharted mode's
   * persisted `revealedTiles`, seeded + merged server-side), even if the hex is
   * not in live vision right now. The canvas paints such a hex as explored
   * ground under the fog veil, so the panel reads its terrain instead of
   * "Unexplored" — "Unexplored" is for hexes the player has NEVER seen.
   * Classic games carry no reveal set, so this stays false there and the
   * locked "Unexplored" fog decision (docs/map.md) is unchanged.
   */
  explored: boolean;
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
    /**
     * What is still on the floor of this tile: the seed-derived pristine
     * amount minus everything heroes have picked up here
     * (`GameState.resourceDeposits`). The resource TYPE and the `yield` above
     * are unaffected by a pickup -- only this number moves -- so the
     * settlement working the tile keeps its per-turn income.
     */
    remaining: number;
    /** The tile's starting amount, for the "N of M left" reading. */
    pristine: number;
  } | null;
  /**
   * The pickup on offer for this tile, present only when the VIEWER owns a
   * hero standing here and the tile still holds something. Every field comes
   * from the engine's own read (previewResourcePickup), so the panel cannot
   * offer an amount the command would refuse; `ok: false` with a `reason` is a
   * refusal the panel shows in words instead of a dead button.
   */
  pickup?: {
    heroId: HeroId;
    heroName: string;
    resource: ResourceType;
    /** What a pickup right now would take (min of remaining and cargo room). */
    amount: number;
    /** Room left in the carrying hero's hold for this resource. */
    room: number;
    remaining: number;
    ok: boolean;
    reason: ResourcePickupRefusal | "";
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
  state: GameState,
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
  // The engine's own remaining read, so the panel and the command agree on the
  // number even for a tile nothing has ever picked from (absent key = the
  // pristine amount).
  const remaining = resourceRemainingOn(state, q, r, rt.amount);
  return {
    resource: rt.resource,
    yield: RESOURCE_YIELD[rt.resource],
    workedBy,
    remaining,
    pristine: rt.amount,
  };
}

/**
 * The pickup this hex offers the VIEWER, or null when it offers none.
 *
 * Null covers every case the panel should stay quiet about: no hero of the
 * viewer's standing here, nothing left on the tile (a tile is only empty once
 * its amount reaches 0), or no deposit at all. A hero standing here with a
 * full hold is NOT null -- it comes back ok:false with the engine's refusal,
 * which is what turns "nothing happens when I click" into a sentence.
 */
function describePickup(
  map: GameMap,
  state: GameState,
  q: number,
  r: number,
  fogged: boolean,
  viewPlayerId: PlayerId,
): TileInfo["pickup"] {
  if (fogged) return null;
  const tile = map.resourceTileAt(q, r);
  if (!tile) return null;
  const heroIds = Object.keys(state.heroes)
    .filter((id) => state.heroes[id].ownerId === viewPlayerId && state.heroes[id].q === q && state.heroes[id].r === r)
    .sort();
  for (const heroId of heroIds) {
    const preview = previewResourcePickup(state, map, { heroId, q, r });
    if (!preview) continue;
    if (preview.remaining <= 0) continue;
    return {
      heroId,
      heroName: state.heroes[heroId].name,
      resource: preview.resource,
      amount: preview.amount,
      room: preview.room,
      remaining: preview.remaining,
      ok: preview.ok,
      reason: preview.reason,
    };
  }
  return null;
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

/**
 * The reveal set the tile panel reads for a seat: what the seat's units see
 * right now, unioned with its persisted `revealedTiles`.
 *
 * Null when the seat carries no reveal list at all — a classic game, whose fog
 * is two-state and whose locked rule is "Unexplored means nothing at all"
 * (docs/map.md). Null keeps `describeTile` byte-identical to before.
 *
 * The union matters because a hero's vision ring and the persisted list are
 * different facts: the ring is live (it moves with the hero every frame), the
 * list is what the map has already been drawn as explored. The panel must
 * answer for the ground the player is looking at, so it needs both.
 */
export function revealedSetForTilePanel(
  state: GameState,
  seat: PlayerId,
): ReadonlySet<string> | null {
  const seed = state.players.find((p) => p.id === seat)?.revealedTiles;
  if (!seed) return null;
  const revealed = new Set<string>(seed);
  for (const key of computeVisionFromState(state, seat)) revealed.add(key);
  return revealed;
}

export function describeTile(input: {
  map: GameMap;
  state: GameState;
  heroes: readonly Hero[];
  castles: readonly Castle[];
  viewPlayerId: PlayerId;
  tile: Axial;
  /**
   * The map's own revealed state for the viewing seat (uncharted mode's
   * persisted `revealedTiles`, unioned with what is visible right now).
   * Omitted/null in classic games, which carry no reveal set — the locked fog
   * decision then keeps "Unexplored" for every unseen hex, exactly as before.
   */
  revealed?: ReadonlySet<string> | null;
}): TileInfo | null {
  const { map, state, heroes, castles, viewPlayerId, tile } = input;
  const kind = map.get(tile.q, tile.r);
  if (!kind) return null;

  const fogged = !isTileVisibleTo(heroes, castles, viewPlayerId, tile.q, tile.r);
  // "Unexplored" means never seen. A hex the map has already painted as
  // explored ground (revealed earlier, now outside every vision ring) reads its
  // terrain and move cost, because that is what the player is looking at.
  const explored = fogged && (input.revealed?.has(`${tile.q},${tile.r}`) ?? false);
  const river = map.riverAt(tile.q, tile.r);
  // Classically absent rather than present-and-undefined: a classic TileInfo
  // keeps exactly its previous keys, which is what every existing panel test
  // and every stored signature depends on.
  const founding = describeFounding(state, map, tile.q, tile.r, fogged, viewPlayerId);
  const pickup = describePickup(map, state, tile.q, tile.r, fogged, viewPlayerId);

  return {
    q: tile.q,
    r: tile.r,
    fogged,
    explored,
    terrain: fogged && !explored
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
      (fogged && !explored) || !river
        ? null
        : {
            kind: river.kind,
            bridge: river.bridge === true,
            label:
              river.kind === "small" ? "Small river" : river.bridge ? "Bridge" : "Wide river",
            cost: map.cost(tile.q, tile.r),
            passable: map.isPassable(tile.q, tile.r),
          },
    deposit: fogged ? null : describeDeposit(map, state, castles, tile.q, tile.r),
    settlement: describeSettlement(state, tile.q, tile.r, fogged, viewPlayerId),
    district: describeDistrict(state, castles, heroes, tile.q, tile.r, fogged, viewPlayerId),
    heroes: describeHeroes(state, heroes, tile.q, tile.r, fogged, viewPlayerId),
    charter: describeCharter(state, tile.q, tile.r, fogged),
    ...(founding !== undefined ? { founding } : {}),
    ...(pickup !== undefined ? { pickup } : {}),
    territory: describeTerritory(state, castles, tile.q, tile.r, fogged, viewPlayerId, map.width, map.height),
  };
}
