import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heroResourceCap,
  settlementResourceCap,
  transferResources,
  type GameState,
} from "@heroes/engine";
import { makeHero, makeSettlement, makeState } from "../../charter/_helpers";
import {
  CARGO_TRANSFER_COMMAND_DIRECTION,
  CARGO_TRANSFER_REFUSALS,
  cargoTransferRefusalMessage,
  cargoTransferRequest,
  cargoTransferTitle,
  ownedSettlementAt,
} from "../../../src/screens/shared/cargoTransfer";

// The hero-cargo transfer as data: the seam the settlement panel's Warehouse
// row and the Logistics modal's hero block both mount (playthrough finding F-2
// -- map-picked cargo had no UI path into a settlement). The engine's
// directions are the OTHER way round from their names, so the mapping is
// pinned here and every amount is fed back through the REAL engine verb: a
// green test is cargo that actually arrives.

const WOOD_CARGO = 250;

function cargoState(opts: { carried?: number; stored?: number; ownerId?: number | null; heroAt?: boolean } = {}): GameState {
  const hero = {
    ...makeHero("h0", 0, 2, 2),
    gold: 0,
    wagons: 5,
    resources: { wood: opts.carried ?? 0 },
  };
  const settlement = makeSettlement("s0", opts.ownerId === undefined ? 0 : opts.ownerId, 2, 2, {
    gold: 0,
    warehouse: { wood: opts.stored ?? 0 },
  });
  const state = makeState({ heroes: [hero], settlements: [settlement], activePlayerId: 0 });
  const placed = opts.heroAt === false ? { ...state.heroes.h0, q: 7, r: 7 } : state.heroes.h0;
  return { ...state, heroes: { h0: placed } };
}

test("the engine's load/unload names the other way round from the player's verbs", () => {
  assert.deepEqual(CARGO_TRANSFER_COMMAND_DIRECTION, { deposit: "load", withdraw: "unload" });
});

test("a deposit asks for the hero's cargo and moves it INTO the warehouse", () => {
  const state = cargoState({ carried: WOOD_CARGO });
  const request = cargoTransferRequest(state.heroes.h0, state.settlements.s0, "deposit");
  assert.equal(request.direction, "load");
  assert.deepEqual(request.amounts, { wood: WOOD_CARGO });
  assert.equal(request.total, WOOD_CARGO);

  const result = transferResources(state, 0, "h0", "s0", request.direction, request.amounts);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.settlements.s0.warehouse.wood, WOOD_CARGO, "the cargo must arrive in the warehouse");
  assert.equal(result.state.heroes.h0.resources?.wood ?? 0, 0, "and leave the wagons");
});

test("a withdrawal asks for the warehouse's stock and moves it into the wagons", () => {
  const state = cargoState({ stored: 120 });
  const request = cargoTransferRequest(state.heroes.h0, state.settlements.s0, "withdraw");
  assert.equal(request.direction, "unload");
  assert.deepEqual(request.amounts, { wood: 120 });

  const result = transferResources(state, 0, "h0", "s0", request.direction, request.amounts);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.heroes.h0.resources?.wood ?? 0, 120);
  assert.equal(result.state.settlements.s0.warehouse.wood, 0);
});

test("a request is clamped by the destination and is always a whole number", () => {
  const cap = settlementResourceCap(makeSettlement("s0", 0, 2, 2)).wood;
  const overflowing = cargoState({ carried: WOOD_CARGO, stored: cap - 25.4 });
  const deposit = cargoTransferRequest(overflowing.heroes.h0, overflowing.settlements.s0, "deposit");
  assert.equal(deposit.total, 25, "the request is the warehouse's headroom, floored");
  assert.equal(deposit.source, WOOD_CARGO, "the source total is what the hero really carries");
  assert.equal(Number.isInteger(deposit.amounts.wood), true, "the engine refuses a fractional amount");

  const full = cargoState({ carried: WOOD_CARGO, stored: cap });
  assert.equal(cargoTransferRequest(full.heroes.h0, full.settlements.s0, "deposit").total, 0);
  assert.equal(cargoTransferRequest(full.heroes.h0, full.settlements.s0, "deposit").source, WOOD_CARGO, "0 to move is the warehouse full, not empty wagons");
  assert.deepEqual(cargoTransferRequest(full.heroes.h0, full.settlements.s0, "deposit").amounts, {});
});

test("a withdrawal needs room in the wagons, and an empty warehouse has nothing to give", () => {
  const heroCap = heroResourceCap({ ...makeHero("h0", 0, 2, 2), wagons: 5, resources: { wood: 250 } } as never).wood;
  const fullWagons = cargoState({ carried: heroCap, stored: 400 });
  assert.equal(cargoTransferRequest(fullWagons.heroes.h0, fullWagons.settlements.s0, "withdraw").total, 0);

  const empty = cargoState({ stored: 0 });
  assert.equal(cargoTransferRequest(empty.heroes.h0, empty.settlements.s0, "withdraw").total, 0);
});

test("the settlement underfoot is the same-seat one on the hero's tile, and nothing else", () => {
  const state = cargoState({ carried: WOOD_CARGO });
  assert.equal(ownedSettlementAt(state, state.heroes.h0)?.id, "s0");

  const elsewhere = cargoState({ carried: WOOD_CARGO, heroAt: false });
  assert.equal(ownedSettlementAt(elsewhere, elsewhere.heroes.h0), null, "a hero off the tile has no settlement");

  const foreign = cargoState({ carried: WOOD_CARGO, ownerId: 1 });
  assert.equal(ownedSettlementAt(foreign, foreign.heroes.h0), null, "another seat's settlement is not a target");
});

test("every refusal the verb can produce reads as a sentence", () => {
  for (const reason of Object.keys(CARGO_TRANSFER_REFUSALS)) {
    assert.equal(cargoTransferRefusalMessage(reason), CARGO_TRANSFER_REFUSALS[reason]);
  }
  assert.equal(cargoTransferRefusalMessage("nothing_transferred"), "nothing moved — the wagons are empty, or there is no room");
  assert.equal(cargoTransferRefusalMessage("some_new_code"), "some new code", "an unknown code shows itself");
});

// ── The button's own sentence, in every state of it ──
//
// `source > 0` with `total === 0` is the distinction this model exists to make
// (line 82 above), and BOTH surfaces now read the ONE function that makes it.
// Before this they drifted: the settlement panel's row said "The warehouse is
// full" while the Logistics modal told a hero carrying cargo into a capped
// warehouse that its wagons were empty.
test("cargoTransferTitle: a live button names what it will move", () => {
  const deposit = cargoState({ carried: WOOD_CARGO, stored: 120 });
  assert.equal(
    cargoTransferTitle("deposit", cargoTransferRequest(deposit.heroes.h0, deposit.settlements.s0, "deposit")),
    "Move 250 of the hero's cargo into the warehouse",
  );

  const withdraw = cargoState({ carried: 0, stored: 120 });
  assert.equal(
    cargoTransferTitle("withdraw", cargoTransferRequest(withdraw.heroes.h0, withdraw.settlements.s0, "withdraw")),
    "Take 120 out of the warehouse into the hero's cargo",
  );
});

test("cargoTransferTitle: a dead button names the side that is FULL, never the one that is not", () => {
  const cap = settlementResourceCap(makeSettlement("s0", 0, 2, 2)).wood;

  // The hero carries cargo; the WAREHOUSE is at its cap.
  const capped = cargoState({ carried: WOOD_CARGO, stored: cap });
  const cappedDeposit = cargoTransferRequest(capped.heroes.h0, capped.settlements.s0, "deposit");
  assert.equal(cappedDeposit.total, 0);
  assert.equal(cappedDeposit.source, WOOD_CARGO, "the hero IS carrying cargo");
  assert.equal(cargoTransferTitle("deposit", cappedDeposit), "The warehouse is full");

  // The warehouse has stock; the HOLD is full.
  const heroCap = heroResourceCap({ ...makeHero("h0", 0, 2, 2), wagons: 5, resources: { wood: 250 } } as never).wood;
  const holdFull = cargoState({ carried: heroCap, stored: 400 });
  const holdFullWithdraw = cargoTransferRequest(holdFull.heroes.h0, holdFull.settlements.s0, "withdraw");
  assert.equal(holdFullWithdraw.total, 0);
  assert.equal(holdFullWithdraw.source, 400, "the warehouse HAS stock");
  assert.equal(cargoTransferTitle("withdraw", holdFullWithdraw), "The hero's wagons are full");
});

test("cargoTransferTitle: a genuinely empty source keeps its own sentence", () => {
  const nothing = cargoState({ carried: 0, stored: 0 });
  assert.equal(
    cargoTransferTitle("deposit", cargoTransferRequest(nothing.heroes.h0, nothing.settlements.s0, "deposit")),
    "The hero's wagons are empty",
  );
  assert.equal(
    cargoTransferTitle("withdraw", cargoTransferRequest(nothing.heroes.h0, nothing.settlements.s0, "withdraw")),
    "The warehouse is empty",
  );
});
