// F6 (playthrough round 2b): loading an UNFOUNDED settlers game centred the
// camera on the classic fallback hex (6,5), so the map opened fully fogged
// with the player's own wagon off screen.
//
// Re-measured against github/main 5ecbfe2 before any code: GameSessionManager's
// loadGame did `this.state.getHero(playerHeroId())?.tile ?? { q: 6, r: 5 }`,
// `playerHeroId()` is the literal "p0-hero", and an unfounded settlers seat's
// entity is its covered wagon ("p0-wagon") -- so the fallback fired and the
// camera sat on a hex that seat has never seen. Reported numbers: the wagon at
// screenFor(4,21) was below a 1000px viewport while screenFor(6,5) was exactly
// the viewport centre.
//
// The fix resolves the centre from what the loaded game actually has
// (src/game/loadCamera.ts) and documents the map centre -- not a classic-mode
// spawn constant -- as the fallback for a game with nothing of the seat's on
// the board. The last case here is the acceptance property the finding is
// really about: the centred hex must be one the seat can SEE, which (6,5) is
// not.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState, HeroState, SettlementState } from "@heroes/contracts";
import { resolveLoadCameraCenter } from "../../src/game/loadCamera";
import { computeVisionFromState, isVisible } from "../../src/render/fog";

const MAP = { width: 24, height: 18 };
// The classic castle-less spawn constant the load path used to fall back to.
const CLASSIC_FALLBACK = { q: 6, r: 5 };

function hero(q: number, r: number, ownerId: number): HeroState {
  return { id: "unused", name: "unused", ownerId, q, r } as unknown as HeroState;
}

function settlement(q: number, r: number, ownerId: number | null): SettlementState {
  return { id: "unused", name: "unused", ownerId, q, r } as unknown as SettlementState;
}

function state(
  heroes: Record<string, HeroState>,
  settlements: Record<string, SettlementState> = {},
): Pick<GameState, "heroes" | "settlements"> {
  return { heroes, settlements };
}

/** The seat's own vision, as the renderer computes it (fog.ts). */
function vision(heroes: Record<string, HeroState>, settlements: Record<string, SettlementState>, seat: number): Set<string> {
  return computeVisionFromState({ heroes, settlements, tradeRoutes: [] } as unknown as GameState, seat);
}

test("unfounded settlers: the camera centres on the seat's own covered wagon", () => {
  const heroes = { "p0-wagon": hero(4, 21, 0), "p1-wagon": hero(29, 3, 1) };
  const center = resolveLoadCameraCenter(state(heroes), 0, MAP);
  assert.deepEqual(center, { q: 4, r: 21, source: "wagon" });
  assert.notDeepEqual({ q: center.q, r: center.r }, CLASSIC_FALLBACK, "never the classic spawn constant");
});

test("the local seat is the one centred, not seat 0", () => {
  const heroes = { "p0-wagon": hero(4, 21, 0), "p1-wagon": hero(29, 3, 1) };
  assert.deepEqual(resolveLoadCameraCenter(state(heroes), 1, MAP), { q: 29, r: 3, source: "wagon" });
});

test("a classic game still centres on its commander (behaviour unchanged)", () => {
  const heroes = { "p0-hero": hero(12, 7, 0), "p1-hero": hero(14, 8, 1) };
  assert.deepEqual(resolveLoadCameraCenter(state(heroes), 0, MAP), { q: 12, r: 7, source: "seat-hero" });
});

test("a founded settlers seat centres on the id its wagon converted to", () => {
  // wagonBecomesFirstHero: the wagon IS p<seat>-hero after founding.
  const heroes = { "p0-hero": hero(8, 3, 0), "p1-wagon": hero(29, 3, 1) };
  assert.deepEqual(resolveLoadCameraCenter(state(heroes), 0, MAP), { q: 8, r: 3, source: "seat-hero" });
});

test("a seat holding only a recruited hero is still centred on it, deterministically", () => {
  const heroes = { h2: hero(5, 5, 1), h10: hero(1, 1, 1) };
  const center = resolveLoadCameraCenter(state(heroes), 1, MAP);
  assert.deepEqual(center, { q: 1, r: 1, source: "seat-hero" }, "sorted-id order: h10 before h2");
});

test("a seat with no unit centres on its own settlement", () => {
  const heroes = { "p1-wagon": hero(29, 3, 1) };
  const settlements = { s0: settlement(8, 3, 0) };
  assert.deepEqual(resolveLoadCameraCenter(state(heroes, settlements), 0, MAP), { q: 8, r: 3, source: "settlement" });
});

test("a game with nothing of this seat's centres the map, not the classic spawn", () => {
  const center = resolveLoadCameraCenter(state({}), 0, MAP);
  assert.deepEqual(center, { q: (MAP.width - 1) / 2, r: (MAP.height - 1) / 2, source: "map-centre" });
  assert.notDeepEqual({ q: center.q, r: center.r }, CLASSIC_FALLBACK);
});

test("ACCEPTANCE: the centred hex is one the loaded seat can actually see", () => {
  const heroes = { "p0-wagon": hero(4, 21, 0), "p1-wagon": hero(29, 3, 1) };
  const settlements = {};
  const center = resolveLoadCameraCenter(state(heroes, settlements), 0, MAP);
  const visible = vision(heroes, settlements, 0);

  assert.equal(
    isVisible(visible, center.q, center.r),
    true,
    `the load camera must land on a revealed tile (it landed on ${center.q},${center.r})`,
  );
  // And the hex the old fallback centred on is one this seat cannot see --
  // which is what left the map fully fogged with the wagon off screen.
  assert.equal(
    isVisible(visible, CLASSIC_FALLBACK.q, CLASSIC_FALLBACK.r),
    false,
    "the classic spawn constant is not in the unfounded seat's vision",
  );
});
