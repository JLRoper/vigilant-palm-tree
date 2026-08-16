import type { GameState, HeroId, HeroState, PlayerId, StartMoveResult } from "@heroes/contracts";
import { HEX_DIRECTIONS, MOVEMENT_PER_TURN } from "@heroes/contracts";

export function startMove(
  state: GameState,
  heroId: HeroId,
  toTile: { q: number; r: number },
  cost: number,
  // Ordered list of every tile the hero will pass through during this move
  // (including the destination). When omitted, only the destination is
  // appended to the trail — which produces a "as the crow flies" line for
  // multi-hex moves. Callers should pass the full clamped path so the trail
  // reflects the actual route.
  trailExtension?: { q: number; r: number }[],
): StartMoveResult {
  if (state.phase.kind !== "PLAYER_TURN") {
    return { state, ok: false, reason: "not_player_turn" };
  }
  const hero = state.heroes[heroId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  if (hero.isChartering) {
    return { state, ok: false, reason: "is_chartering" };
  }
  if (hero.ownerId !== state.activePlayerId) {
    return { state, ok: false, reason: "not_owner" };
  }
  if (state.selectedHeroId !== heroId) {
    return { state, ok: false, reason: "not_selected" };
  }
  if (!Number.isFinite(cost) || cost < 0) {
    return { state, ok: false, reason: "impassable" };
  }
  for (const [id, other] of Object.entries(state.heroes)) {
    if (id !== heroId && other.q === toTile.q && other.r === toTile.r) {
      return { state, ok: false, reason: "occupied" };
    }
  }
  if (hero.movementRemaining < cost) {
    return { state, ok: false, reason: "insufficient_movement" };
  }
  const trailExtensionFinal = trailExtension && trailExtension.length > 0
    ? trailExtension
    : [toTile];
  const updatedHero: HeroState = {
    ...hero,
    q: toTile.q,
    r: toTile.r,
    movementRemaining: hero.movementRemaining - cost,
    previousQ: hero.q,
    previousR: hero.r,
    previousMovementRemaining: hero.movementRemaining,
    trail: [...(hero.trail ?? []), ...trailExtensionFinal],
  };
  return {
    state: { ...state, heroes: { ...state.heroes, [heroId]: updatedHero }, dirty: true },
    ok: true,
  };
}

export function cancelMove(state: GameState, heroId: HeroId): GameState {
  const hero = state.heroes[heroId];
  if (!hero) return state;
  if (hero.previousQ === null || hero.previousR === null || hero.previousMovementRemaining === null) {
    return state;
  }
  const restored: HeroState = {
    ...hero,
    q: hero.previousQ,
    r: hero.previousR,
    movementRemaining: hero.previousMovementRemaining,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
  };
  return { ...state, heroes: { ...state.heroes, [heroId]: restored }, dirty: true };
}

export function detectAdjacentEnemy(state: GameState, moverId: HeroId): HeroId | null {
  const mover = state.heroes[moverId];
  if (!mover) return null;
  for (const dir of HEX_DIRECTIONS) {
    const nq = mover.q + dir.q;
    const nr = mover.r + dir.r;
    for (const [id, h] of Object.entries(state.heroes)) {
      if (id === moverId) continue;
      if (h.ownerId === mover.ownerId) continue;
      if (h.q === nq && h.r === nr) return id;
    }
  }
  return null;
}

// Resets movementRemaining/trail/previous-move bookkeeping for a new turn.
// When ownerId is omitted, every hero is reset (advanceRound's new-day case);
// when provided, only that owner's heroes are reset (applyEndOfTurnDetailed's
// single-player case).
export function resetHeroMovement(
  heroes: Record<HeroId, HeroState>,
  ownerId?: PlayerId,
): Record<HeroId, HeroState> {
  const newHeroes: Record<HeroId, HeroState> = { ...heroes };
  for (const hero of Object.values(newHeroes)) {
    if (ownerId !== undefined && hero.ownerId !== ownerId) continue;
    newHeroes[hero.id] = {
      ...hero,
      movementRemaining: MOVEMENT_PER_TURN,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
      trail: [{ q: hero.q, r: hero.r }],
    };
  }
  return newHeroes;
}
