// Copilot's first comment on the landed load path (PR #289, github/main
// 44e0f1d, v0.38.9): GameSessionManager.loadGame resolved the local seat with
//   const claimedSeat = Number(Object.keys(claimed).find((k) => claimed[k]) ?? "");
// -- the FIRST claimed seat. With seats 0 and 1 both claimed, a browser holding
// seat 1 set its local player id to seat 0 AND centred the camera on seat 0's
// wagon, because that one value feeds both consumers.
//
// Each claim carries { handle, email?, claimedAt } (src/io/api.ts:38), so the
// browser CAN identify its own seat: the seat it remembers claiming
// (localStorage, written by the lobby at claim time), the handle it claimed
// with, or the signed-in email the server bound the claim to. This suite is
// that resolver.
//
// The last cases are the honest fallback, which matters as much as the fix: a
// game whose claims do not identify this browser resolves to NO seat -- it does
// not fall back to the first (or only) claimed seat, which is the bug merely
// narrowed.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState, HeroState } from "@heroes/contracts";
import { resolveLocalSeat, type ClaimedSeatMap } from "../../src/players/localSeat";
import { resolveLoadCameraCenter } from "../../src/game/loadCamera";

const MAP = { width: 24, height: 18 };

/** Two seats claimed -- the shape of the game in the finding. */
function twoClaims(): ClaimedSeatMap {
  return {
    "0": { handle: "Host", email: "host@example.com", claimedAt: "2026-10-25T20:00:00Z" },
    "1": { handle: "Joiner", email: "joiner@example.com", claimedAt: "2026-10-25T20:05:00Z" },
  };
}

function hero(q: number, r: number, ownerId: number): HeroState {
  return { id: "unused", name: "unused", ownerId, q, r } as unknown as HeroState;
}

/** The board the two claims' seats own: seat 0 at (4,21), seat 1 at (29,3). */
function board(): Pick<GameState, "heroes" | "settlements"> {
  return {
    heroes: { "p0-wagon": hero(4, 21, 0), "p1-wagon": hero(29, 3, 1) },
    settlements: {},
  };
}

test("both seats claimed, this browser remembers seat 1: the resolver takes seat 1, not the first claim", () => {
  const seat = resolveLocalSeat(twoClaims(), { rememberedSeat: 1 });
  assert.equal(seat.seat, 1, "the browser's own seat, not the first key in the claim map");
  assert.equal(seat.source, "remembered");
  // The rule being replaced, spelled out, so the difference is not a matter of
  // reading the diff: the first claimed seat is 0 and this browser holds 1.
  assert.equal(Number(Object.keys(twoClaims()).find((k) => twoClaims()[k]) ?? ""), 0);
});

test("the resolved seat is the one the camera centres on AND the local player id takes", () => {
  // One value feeds both consumers (GameSessionManager.loadGame: the id and the
  // centre), so the assertion is on the composed pair, not the resolver alone.
  const seat = resolveLocalSeat(twoClaims(), { rememberedSeat: 1 });
  const center = resolveLoadCameraCenter(board(), seat.seat, MAP);
  assert.deepEqual(center, { q: 29, r: 3, source: "wagon" }, "seat 1's own wagon");
  assert.notDeepEqual({ q: center.q, r: center.r }, { q: 4, r: 21 }, "never seat 0's wagon");
});

test("a browser that remembers seat 0 still resolves to seat 0", () => {
  assert.deepEqual(resolveLocalSeat(twoClaims(), { rememberedSeat: 0 }), { seat: 0, source: "remembered" });
});

test("no remembered seat: the handle this browser claimed with identifies its seat", () => {
  const seat = resolveLocalSeat(twoClaims(), { rememberedSeat: null, handle: "Joiner" });
  assert.deepEqual(seat, { seat: 1, source: "handle" });
});

test("the handle match ignores case and surrounding whitespace", () => {
  assert.deepEqual(resolveLocalSeat(twoClaims(), { handle: "  joiner  " }), { seat: 1, source: "handle" });
});

test("two seats sharing one handle is ambiguous, and ambiguity is not a match", () => {
  const claimed: ClaimedSeatMap = {
    "0": { handle: "Player", claimedAt: "2026-10-25T20:00:00Z" },
    "1": { handle: "player", claimedAt: "2026-10-25T20:05:00Z" },
  };
  assert.deepEqual(resolveLocalSeat(claimed, { handle: "Player" }), { seat: null, source: "unknown" });
});

test("no remembered seat and no handle: the signed-in email the server bound the claim to", () => {
  const seat = resolveLocalSeat(twoClaims(), { email: "JOINER@example.com" });
  assert.deepEqual(seat, { seat: 1, source: "email" });
});

test("an anonymous claim has no email to match, so it is not matched by one", () => {
  const claimed: ClaimedSeatMap = {
    "0": { handle: "Host", claimedAt: "2026-10-25T20:00:00Z" },
    "1": { handle: "Joiner", claimedAt: "2026-10-25T20:05:00Z" },
  };
  assert.deepEqual(resolveLocalSeat(claimed, { email: "joiner@example.com" }), { seat: null, source: "unknown" });
});

test("the remembered seat outranks a handle that points at another seat", () => {
  assert.deepEqual(resolveLocalSeat(twoClaims(), { rememberedSeat: 1, handle: "Host" }), {
    seat: 1,
    source: "remembered",
  });
});

test("the handle outranks the email when both are known", () => {
  const seat = resolveLocalSeat(twoClaims(), { handle: "Joiner", email: "host@example.com" });
  assert.deepEqual(seat, { seat: 1, source: "handle" });
});

test("a remembered seat the server no longer has claimed is not trusted", () => {
  const claimed: ClaimedSeatMap = { "0": { handle: "Host", claimedAt: "2026-10-25T20:00:00Z" } };
  assert.deepEqual(resolveLocalSeat(claimed, { rememberedSeat: 1 }), { seat: null, source: "unknown" });
  // ...and the identity legs still resolve it.
  assert.deepEqual(resolveLocalSeat(claimed, { rememberedSeat: 1, handle: "Host" }), {
    seat: 0,
    source: "handle",
  });
});

test("a game with no claims at all is seat 0: the only seat it can have (classic/solo, unchanged)", () => {
  assert.deepEqual(resolveLocalSeat({}, {}), { seat: 0, source: "sole-seat" });
  assert.deepEqual(resolveLocalSeat(undefined, { rememberedSeat: 1 }), { seat: 0, source: "sole-seat" });
  // The classic load still centres on that seat's commander.
  const heroes = { "p0-hero": hero(12, 7, 0), "p1-hero": hero(14, 8, 1) };
  const center = resolveLoadCameraCenter({ heroes, settlements: {} }, 0, MAP);
  assert.deepEqual(center, { q: 12, r: 7, source: "seat-hero" });
});

test("HONEST FALLBACK: claims that identify nobody leave the seat UNKNOWN -- no seat is invented", () => {
  // No remembered seat, no handle, no email: this browser holds some seat and a
  // spectator holds none, and the claim map cannot tell them apart. Seat 0 here
  // is what the old rule returned (the first claim), and it is a guess.
  assert.deepEqual(resolveLocalSeat(twoClaims(), {}), { seat: null, source: "unknown" });
  assert.deepEqual(resolveLocalSeat(twoClaims(), { rememberedSeat: null, handle: "", email: null }), {
    seat: null,
    source: "unknown",
  });
  // The camera then falls to the map centre, NOT to another seat's wagon: with
  // no seat there is nothing of "ours" to centre on.
  const center = resolveLoadCameraCenter(board(), null, MAP);
  assert.deepEqual(center, { q: (MAP.width - 1) / 2, r: (MAP.height - 1) / 2, source: "map-centre" });
  assert.notDeepEqual({ q: center.q, r: center.r }, { q: 4, r: 21 }, "not seat 0's wagon");
  assert.notDeepEqual({ q: center.q, r: center.r }, { q: 29, r: 3 }, "not seat 1's wagon either");
});

test("a claim key that is not a seat index is ignored, not matched", () => {
  const claimed: ClaimedSeatMap = {
    "junk": { handle: "Joiner", claimedAt: "2026-10-25T20:00:00Z" },
    "1": { handle: "Host", claimedAt: "2026-10-25T20:05:00Z" },
  };
  assert.deepEqual(resolveLocalSeat(claimed, { rememberedSeat: 1 }), { seat: 1, source: "remembered" });
  assert.deepEqual(resolveLocalSeat(claimed, { handle: "Joiner" }), { seat: null, source: "unknown" });
});

test("a falsy claim entry is not a claimed seat", () => {
  const claimed = {
    "0": undefined,
    "1": { handle: "Joiner", claimedAt: "2026-10-25T20:05:00Z" },
  } as unknown as ClaimedSeatMap;
  assert.deepEqual(resolveLocalSeat(claimed, { handle: "Joiner" }), { seat: 1, source: "handle" });
  assert.deepEqual(resolveLocalSeat(claimed, {}), { seat: null, source: "unknown" });
});
