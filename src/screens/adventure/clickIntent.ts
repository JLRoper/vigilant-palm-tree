import type { Axial } from "../../core/hex";
import type { GameMap } from "../../map/gameMap";
import type { Hero } from "../../entities/hero";
import type { GameState, HeroId } from "../../state/gameState";
import { computePathCost, findPath, NEIGHBOR_DIRS } from "../../map/pathfinding";
import { computeReachableSplit } from "../../render/overlays/pathOverlay";

export interface MoveIntentBase {
  heroId: HeroId;
  dest: Axial;
  cost: number;
  trailExtension: Axial[];
  reachableIdx: number;
  clamped: boolean;
  remainingPath: Axial[];
}

export type ClickIntent =
  | { kind: "none"; reason: string; debugPath?: Axial[] }
  | { kind: "select-hero"; heroId: HeroId }
  | { kind: "select-settlement"; settlementId: string }
  | { kind: "open-charter"; targetQ: number; targetR: number }
  | ({ kind: "attack" } & MoveIntentBase)
  | ({ kind: "move"; debugPath: Axial[] } & MoveIntentBase);

export interface ClickIntentInput {
  map: GameMap;
  heroes: Record<string, Hero>;
  state: GameState;
  hover: Axial | null;
  movedDuringDrag: boolean;
  isPlayerTurn: boolean;
  charterMode: boolean;
  validCharterHexes: Set<string> | null;
}

export function resolveAdventureClick(input: ClickIntentInput): ClickIntent {
  const { map, heroes, state, hover: t } = input;

  if (input.charterMode && input.validCharterHexes) {
    if (t) {
      const key = `${t.q},${t.r}`;
      if (input.validCharterHexes.has(key)) {
        const selectedId = state.selectedHeroId;
        if (selectedId && state.heroes[selectedId]) {
          return { kind: "open-charter", targetQ: t.q, targetR: t.r };
        }
      }
    }
    return { kind: "none", reason: "charter_invalid" };
  }

  if (input.movedDuringDrag) return { kind: "none", reason: "movedDuringDrag" };
  if (!input.isPlayerTurn) return { kind: "none", reason: "not_player_turn" };
  if (!t) return { kind: "none", reason: "no hover" };

  const clickedHero = Object.values(heroes).find(
    (h) => h.tile.q === t.q && h.tile.r === t.r
  );
  if (clickedHero && clickedHero.ownerId === 0) {
    return { kind: "select-hero", heroId: clickedHero.id as HeroId };
  }

  const selectedId = state.selectedHeroId;
  const startTile = selectedId ? state.heroes[selectedId] : undefined;

  const occupiedHexes = new Set<string>();
  for (const [id, hero] of Object.entries(state.heroes)) {
    if (id !== selectedId) {
      occupiedHexes.add(`${hero.q},${hero.r}`);
    }
  }

  const clickedEnemy = Object.values(heroes).find(
    (h) => h.tile.q === t.q && h.tile.r === t.r && h.ownerId !== 0
  );
  if (clickedEnemy && selectedId && startTile) {
    const adjacentTiles: Axial[] = [];
    for (const dir of NEIGHBOR_DIRS) {
      const nq = clickedEnemy.tile.q + dir.q;
      const nr = clickedEnemy.tile.r + dir.r;
      if (!map.isPassable(nq, nr)) continue;
      if (occupiedHexes.has(`${nq},${nr}`)) continue;
      adjacentTiles.push({ q: nq, r: nr });
    }

    let bestPath: Axial[] | null = null;
    let bestCost = Infinity;
    for (const adj of adjacentTiles) {
      const path = findPath(map, { q: startTile.q, r: startTile.r }, adj, occupiedHexes);
      if (path.length === 0) continue;
      const cost = computePathCost(map, [{ q: startTile.q, r: startTile.r }, ...path]);
      if (cost < bestCost) {
        bestCost = cost;
        bestPath = path;
      }
    }

    if (bestPath && bestPath.length > 0) {
      const reachableIdx = computeReachableSplit(bestPath, map, startTile.movementRemaining);
      const clamped = reachableIdx < bestPath.length;
      const actualCost = Math.min(
        computePathCost(map, [{ q: startTile.q, r: startTile.r }, ...bestPath.slice(0, reachableIdx)]),
        startTile.movementRemaining,
      );
      if (reachableIdx > 0) {
        const dest = bestPath[reachableIdx - 1];
        return {
          kind: "attack",
          heroId: selectedId,
          dest,
          cost: actualCost,
          trailExtension: bestPath.slice(0, reachableIdx),
          reachableIdx,
          clamped,
          remainingPath: bestPath.slice(reachableIdx),
        };
      }
    }
    return { kind: "none", reason: "no attack path" };
  }

  const clickedSettlement = Object.values(state.settlements).find(
    (s) => s.q === t.q && s.r === t.r
  );
  if (clickedSettlement && !selectedId) {
    return { kind: "select-settlement", settlementId: clickedSettlement.id };
  }

  if (!selectedId) return { kind: "none", reason: "no selection" };
  if (!startTile) return { kind: "none", reason: "no hero" };

  const newPath = findPath(map, { q: startTile.q, r: startTile.r }, t, occupiedHexes);
  if (newPath.length === 0) {
    return { kind: "none", reason: "empty path", debugPath: newPath };
  }
  const reachableIdx = computeReachableSplit(newPath, map, startTile.movementRemaining);
  const clamped = reachableIdx < newPath.length;
  const actualCost = Math.min(
    computePathCost(map, [{ q: startTile.q, r: startTile.r }, ...newPath.slice(0, reachableIdx)]),
    startTile.movementRemaining,
  );
  if (reachableIdx === 0) {
    return { kind: "none", reason: "impassable first step", debugPath: newPath };
  }
  const dest = newPath[reachableIdx - 1];
  return {
    kind: "move",
    heroId: selectedId,
    dest,
    cost: actualCost,
    trailExtension: newPath.slice(0, reachableIdx),
    reachableIdx,
    clamped,
    remainingPath: newPath.slice(reachableIdx),
    debugPath: newPath,
  };
}
