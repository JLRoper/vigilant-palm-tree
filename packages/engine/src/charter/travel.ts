import type { CharterState, GameState, HeroId, HeroState, StepTravelResult } from "@heroes/contracts";

export function stepTravelCharter(
  state: GameState,
  heroId: HeroId,
  toQ: number,
  toR: number,
  cost: number,
): StepTravelResult {
  const hero = state.heroes[heroId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  if (!hero.isChartering || hero.charterId === null) {
    return { state, ok: false, reason: "not_chartering" };
  }

  const charter = state.activeCharters.find((c) => c.id === hero.charterId);
  if (!charter) return { state, ok: false, reason: "no_charter" };
  if (charter.phase !== "traveling") {
    return { state, ok: false, reason: "not_traveling" };
  }

  for (const [id, other] of Object.entries(state.heroes)) {
    if (id !== heroId && other.q === toQ && other.r === toR) {
      return { state, ok: false, reason: "occupied" };
    }
  }

  if (!Number.isFinite(cost) || cost < 0) {
    return { state, ok: false, reason: "impassable" };
  }

  if (hero.movementRemaining < cost) {
    return { state, ok: false, reason: "insufficient_movement" };
  }

  const updatedHero: HeroState = {
    ...hero,
    q: toQ,
    r: toR,
    movementRemaining: hero.movementRemaining - cost,
    previousQ: hero.q,
    previousR: hero.r,
    previousMovementRemaining: hero.movementRemaining,
    trail: [...(hero.trail ?? []), { q: toQ, r: toR }],
  };

  const arrived = toQ === charter.targetQ && toR === charter.targetR;
  const newCharters = state.activeCharters.map((c) => {
    if (c.id === charter.id) {
      const next: CharterState = { ...c, phase: arrived ? "constructing" : c.phase };
      if (arrived) {
        next.phase = "constructing";
      }
      return next;
    }
    return c;
  });

  const resultHero = arrived
    ? { ...updatedHero, movementRemaining: 0 }
    : updatedHero;

  return {
    state: {
      ...state,
      heroes: { ...state.heroes, [heroId]: resultHero },
      activeCharters: newCharters,
      dirty: true,
    },
    ok: true,
  };
}
