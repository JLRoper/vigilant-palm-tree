import type { Axial } from "../../core/hex";
import type { GameMap } from "../../map/gameMap";
import type { Hero } from "../../entities/hero";
import type { GameState, HeroId, PlayerId } from "../../state/gameState";
import { canTradeHeroes } from "@heroes/engine";
import type { HeroState } from "@heroes/contracts";
import { gameModeSettings, isCoveredWagonId } from "@heroes/contracts";
import { computePathCost, findPath, NEIGHBOR_DIRS } from "../../map/pathfinding";
import { computeReachableSplitDetailed } from "../../render/overlays/pathOverlay";
import type { ToastKind } from "../shared/toast";

export interface ClickRejectionToast {
  message: string;
  kind: ToastKind;
}

// F9 (playtest fixes 2026-09-29): maps a `kind: "none"` rejection reason from
// resolveAdventureClick to user-facing toast text. "movedDuringDrag" and
// "no hover" deliberately map to null -- a drag or an off-map click is not an
// attempted action, and toasting those would fire on every camera pan.
export function clickRejectionToast(reason: string, movementRemaining?: number): ClickRejectionToast | null {
  switch (reason) {
    case "not_player_turn":
      return { message: "It's not your turn", kind: "info" };
    case "no selection":
      return { message: "Select a hero first", kind: "info" };
    case "no hero":
      return { message: "The selected hero no longer exists", kind: "error" };
    case "empty path":
    case "no attack path":
      return { message: "No path there", kind: "info" };
    case "impassable first step":
      if (movementRemaining !== undefined && movementRemaining <= 0) {
        return { message: "Out of movement — the rest continues next turn", kind: "info" };
      }
      return { message: "No path there", kind: "info" };
    case "charter_invalid":
      return { message: "Pick a highlighted hex for the new settlement", kind: "info" };
    default:
      return null;
  }
}

/**
 * The sentences for the settlers mode's founding refusals (SETTLERS-PLAN.md §4
 * W4). ONE table, keyed by the engine's own `FOUND_SETTLEMENT_REFUSALS`
 * vocabulary: the server relays a refusal verbatim (a 409 whose `error` is one
 * of those codes -- server/app/commandHandler.ts's FoundSettlement case), and
 * this is what the player reads, so the panel and the rule can never drift
 * into two different stories.
 *
 * An unknown code is NOT swallowed: it falls through to a message that shows
 * the code, because a refusal the client cannot explain is a bug to see rather
 * than a silence to hide.
 */
export function foundSettlementRefusalToast(reason: string): ClickRejectionToast {
  switch (reason) {
    case "not_settlers_mode":
      return { message: "This is a classic game — settlements are founded by charter", kind: "error" };
    case "founder_not_at_tile":
      return { message: "A settlement is planted where its founder stands", kind: "error" };
    case "founder_not_a_wagon":
      return { message: "Only a covered wagon can plant a settlement", kind: "error" };
    case "tile_impassable":
      return { message: "That ground cannot hold a settlement", kind: "error" };
    case "occupied":
      return { message: "A settlement already stands there", kind: "error" };
    case "too_close_to_settlement": {
      // The radius is the mode's own key, never a second literal: the sentence
      // moves with the rule the server just applied.
      const min = gameModeSettings("settlers").minFoundingDistance;
      return {
        message: `Too close to another settlement — keep ${min} hexes between them`,
        kind: "error",
      };
    }
    default:
      return { message: `Founding refused: ${reason}`, kind: "error" };
  }
}

/**
 * The id of the seat's own covered wagon standing on `(q, r)`, if any -- the
 * founding gesture's subject. Read through contracts' `isCoveredWagonId` (the
 * engine, the server and the renderer share one convention) rather than
 * re-spelling the `p<seat>-wagon` suffix, and scoped to the VIEWER's seat so
 * an enemy wagon's hex is never a founding candidate.
 */
export function coveredWagonAt(
  state: GameState,
  viewSeat: PlayerId,
  q: number,
  r: number,
): HeroId | null {
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId !== viewSeat) continue;
    if (!isCoveredWagonId(hero.id)) continue;
    const tile = (hero as unknown as { tile?: Axial }).tile;
    const hq = tile?.q ?? hero.q;
    const hr = tile?.r ?? hero.r;
    if (hq === q && hr === r) return hero.id;
  }
  return null;
}

export interface MoveIntentBase {
  heroId: HeroId;
  dest: Axial;
  cost: number;
  trailExtension: Axial[];
  reachableIdx: number;
  clamped: boolean;
  remainingPath: Axial[];
}

// NOTE (settlers mode): a map click has NO founding meaning. Founding happens
// in place, from the toolbar's Found Settlement action, on the hex the wagon
// already stands on -- there is no armed gesture, no highlighted founding hex
// and no `found-settlement` intent here. The mode's verdict for a hex is still
// the engine's own (`canFoundSettlement`), read for the tile inspector
// (screens/adventure/tileInfo.ts) and by the button's opener.
export type ClickIntent =
  | { kind: "none"; reason: string; debugPath?: Axial[]; movementRemaining?: number }
  | { kind: "select-hero"; heroId: HeroId }
  | { kind: "select-settlement"; settlementId: string }
  | { kind: "deselect-hero"; heroId: HeroId }
  | { kind: "deselect-settlement"; settlementId: string }
  | { kind: "open-charter"; targetQ: number; targetR: number }
  // The walk-in trade gesture: one hero of yours is selected and the player
  // clicked the square another of your heroes stands on, one hex away. The
  // panel opens for the pair instead of the click just re-selecting.
  | { kind: "trade"; heroId: HeroId; partnerId: HeroId }
  | ({ kind: "attack" } & MoveIntentBase)
  | ({ kind: "move"; debugPath: Axial[] } & MoveIntentBase);

/**
 * A hero in the shape the engine's trade rule reads (id/owner/q/r).
 * `canTradeHeroes` is the single source of truth for "can these two trade",
 * so the click path cannot drift from what the command itself will accept.
 *
 * Two hero shapes meet here: the clicked hero comes from the entity map (a
 * client `Hero`, position on `.tile`) while `state.heroes` holds engine-shaped
 * `HeroState` rows (position on `.q`/`.r`).
 */
function tradeHeroOf(hero: Hero | HeroState): HeroState {
  const tile = (hero as Hero).tile;
  const q = tile ? tile.q : (hero as HeroState).q;
  const r = tile ? tile.r : (hero as HeroState).r;
  return { id: hero.id, ownerId: hero.ownerId, q, r } as unknown as HeroState;
}

export interface ClickIntentInput {
  map: GameMap;
  heroes: Record<string, Hero>;
  state: GameState;
  hover: Axial | null;
  movedDuringDrag: boolean;
  isPlayerTurn: boolean;
  charterMode: boolean;
  validCharterHexes: Set<string> | null;
  localSeat: PlayerId | null;
  visibleHexes?: Set<string> | null;
  /**
   * `MouseEvent.detail`: 1 for a single click, 2 on the second click of a
   * double-click. Only the first click of a gesture may toggle a selection off
   * -- double-clicking a settlement is the city-entry gesture.
   */
  clickCount?: number;
}

export function resolveAdventureClick(input: ClickIntentInput): ClickIntent {
  const { map, heroes, state, hover: t } = input;
  const seat = input.localSeat ?? 0;
  const isHeroVisible = (q: number, r: number, ownerId: number): boolean =>
    ownerId === seat || !input.visibleHexes || input.visibleHexes.has(`${q},${r}`);

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

  // A click on a hero is a toggle: select it, move it, click it again to put it
  // down. Clicking a different one of your heroes switches selection instead.
  const singleClick = (input.clickCount ?? 1) <= 1;
  const clickedHero = Object.values(heroes).find(
    (h) => h.tile.q === t.q && h.tile.r === t.r
  );
  if (clickedHero && clickedHero.ownerId === seat) {
    // Walking into a friend: with one of your heroes selected, clicking the
    // square another of your own heroes stands on IS the trade gesture -- the
    // two are one hex apart (the only distance a field trade allows) and the
    // panel opens for that pair. A hero further away is not a trade, so that
    // click still just switches selection, and clicking the selected hero's
    // own square still puts it down.
    const selectedBefore = state.selectedHeroId;
    if (selectedBefore && selectedBefore !== clickedHero.id) {
      const selected = state.heroes[selectedBefore];
      if (selected && selected.id !== clickedHero.id &&
        canTradeHeroes(tradeHeroOf(selected), tradeHeroOf(clickedHero))) {
        return { kind: "trade", heroId: selectedBefore as HeroId, partnerId: clickedHero.id as HeroId };
      }
    }
    if (singleClick && state.selectedHeroId === clickedHero.id) {
      return { kind: "deselect-hero", heroId: clickedHero.id as HeroId };
    }
    return { kind: "select-hero", heroId: clickedHero.id as HeroId };
  }

  const selectedId = state.selectedHeroId;
  const startTile = selectedId ? state.heroes[selectedId] : undefined;

  const occupiedHexes = new Set<string>();
  for (const [id, hero] of Object.entries(state.heroes)) {
    if (id !== selectedId && isHeroVisible(hero.q, hero.r, hero.ownerId)) {
      occupiedHexes.add(`${hero.q},${hero.r}`);
    }
  }

  const clickedEnemy = Object.values(heroes).find(
    (h) => h.tile.q === t.q && h.tile.r === t.r && h.ownerId !== seat && isHeroVisible(h.tile.q, h.tile.r, h.ownerId)
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
      const split = computeReachableSplitDetailed(bestPath, map, startTile.movementRemaining);
      const reachableIdx = split.index;
      const clamped = reachableIdx < bestPath.length;
      const actualCost = Math.min(split.costToSplit, startTile.movementRemaining);
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
    if (singleClick && state.selectedSettlementId === clickedSettlement.id) {
      return { kind: "deselect-settlement", settlementId: clickedSettlement.id };
    }
    return { kind: "select-settlement", settlementId: clickedSettlement.id };
  }

  if (!selectedId) {
    // Nothing selected but a settlement: clicking empty ground puts it down
    // instead of asking for a hero the player never picked.
    if (state.selectedSettlementId) {
      return { kind: "deselect-settlement", settlementId: state.selectedSettlementId };
    }
    return { kind: "none", reason: "no selection" };
  }
  if (!startTile) return { kind: "none", reason: "no hero" };

  const newPath = findPath(map, { q: startTile.q, r: startTile.r }, t, occupiedHexes);
  if (newPath.length === 0) {
    return { kind: "none", reason: "empty path", debugPath: newPath };
  }
  const split = computeReachableSplitDetailed(newPath, map, startTile.movementRemaining);
  const reachableIdx = split.index;
  const clamped = reachableIdx < newPath.length;
  const actualCost = Math.min(split.costToSplit, startTile.movementRemaining);
  if (reachableIdx === 0) {
    return {
      kind: "none",
      reason: "impassable first step",
      debugPath: newPath,
      movementRemaining: startTile.movementRemaining,
    };
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
