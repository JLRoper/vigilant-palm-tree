import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, FactionId, Player } from "@heroes/contracts";
import {
  GameMap,
  type UnitType,
  applyDraftRecharge,
  buildInitialGameState,
  captureSettlement,
  eligibleRecruitSources,
  mulberry32,
  recruitUnits,
  rollbackCaptureSettlement,
} from "@heroes/engine";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

const CATALOG: UnitType[] = (
  [
    ["peasant", "human"],
    ["swordsman", "human"],
    ["ghoul", "ashen"],
    ["skeleton_warrior", "ashen"],
    ["grave_hound", "ashen"],
    ["bone_archer", "ashen"],
    ["tunnel_levy", "ironmark"],
    ["sproutling", "verdant"],
  ] as const
).map(([id, factionId]) => ({
  id,
  name: id,
  attack: 1,
  defence: 1,
  health: 4,
  speed: 4,
  description: "",
  advantageType: "infantry" as const,
  specialty: "",
  specialtyPriority: 0,
  tier: 1,
  factionId,
})) as UnitType[];

const unitTypes: Record<string, UnitType> = Object.fromEntries(CATALOG.map((u) => [u.id, u]));

const CRYPT = { gx: 8, gy: 6 };
const OSSUARY = { gx: 9, gy: 6 };

function building(
  kind: BuildingDef["kind"],
  gx: number,
  gy: number,
  level = 1,
  extra: Partial<BuildingDef> = {},
): BuildingDef {
  return { gx, gy, kind, level, style: "classic", ...extra };
}

/** Two seats: seat 0 is the Crownlands, seat 1 the Ashen Court with a real ashen castle. */
function board(seatFactionId: FactionId = "human") {
  const ashenCastle = {
    ...makeSettlement("s1", 1, 6, 6, {
      level: 3,
      buildings: [
        building("townHall", 6, 6),
        building("crypt", CRYPT.gx, CRYPT.gy, 1, {
          draft: { ghoul: 1, skeleton_warrior: 3, grave_hound: 3 },
          workers: 2,
        }),
        building("ossuary", OSSUARY.gx, OSSUARY.gy, 2, { draft: { bone_archer: 2, bone_pikeman: 3 } }),
        building("woodcutterHut", 10, 6),
        building("house", 10, 7),
      ],
    }),
    districts: {
      "3,6": { q: 3, r: 6, citySpots: [], buildings: [building("spireOfAsh", 11, 6)] },
    },
  };
  const state = makeState({
    settlements: [ashenCastle, makeSettlement("s0", 0, 1, 1, { buildings: [building("farmhouse", 1, 1)] })],
    heroes: [makeHero("h0", 0, 6, 6), makeHero("h1", 1, 6, 6)],
  });
  state.players = state.players.map((p) =>
    p.id === 0 ? { ...p, factionId: seatFactionId } : { ...p, factionId: "ashen" },
  ) as Player[];
  return state;
}

function capture(state = board()) {
  const result = captureSettlement(state, "h0", "s1");
  assert.equal(result.captured, true, "the capture must land");
  return result;
}

// ── What a captured foreign troop building becomes ──

test("capture re-founds a foreign troop building as the capturing faction's own troop building", () => {
  const captured = capture();
  const seized = captured.state.settlements.s1;
  assert.equal(captured.previousOwnerId, 1);
  assert.equal(seized.ownerId, 0);
  assert.deepEqual(
    seized.buildings.map((b) => b.kind),
    ["townHall", "farmhouse", "farmhouse", "woodcutterHut", "house"],
  );
  assert.deepEqual(
    seized.districts?.["3,6"].buildings.map((b) => b.kind),
    ["farmhouse"],
    "a district's troop building is seized with the rest",
  );
});

test("every seat faction gets its own kind, and a same-faction capture is a no-op", () => {
  const expected: [FactionId, BuildingDef["kind"]][] = [
    ["human", "farmhouse"],
    ["ashen", "crypt"],
    ["ironmark", "delversHall"],
    ["verdant", "seedlingGrove"],
  ];
  for (const [seatFactionId, kind] of expected) {
    const seized = capture(board(seatFactionId)).state.settlements.s1;
    assert.equal(
      seized.buildings.find((b) => b.gx === CRYPT.gx && b.gy === CRYPT.gy)?.kind,
      kind,
      `seat faction ${seatFactionId}`,
    );
  }
  const state = board("ashen");
  const same = captureSettlement(state, "h0", "s1");
  assert.equal(same.state.settlements.s1.buildings, state.settlements.s1.buildings, "reference-stable array");
  assert.equal(same.state.settlements.s1.districts, state.settlements.s1.districts);
});

test("a seized building keeps its cell, its level, its style and its crew", () => {
  const seized = capture().state.settlements.s1;
  assert.deepEqual(seized.buildings.find((b) => b.gx === CRYPT.gx && b.gy === CRYPT.gy), {
    gx: CRYPT.gx,
    gy: CRYPT.gy,
    kind: "farmhouse",
    level: 1,
    style: "classic",
    workers: 2,
  });
});

test("the old faction's draft record goes with it: no dead pool accrues and none is inherited", () => {
  const seized = capture().state.settlements.s1;
  assert.equal(seized.buildings.find((b) => b.gx === OSSUARY.gx)?.draft, undefined);
  const recharged = applyDraftRecharge({ s1: seized }, unitTypes);
  assert.equal(recharged.s1, seized, "nothing in the captured city accrues draft for a unit nobody can buy");
});

test("the new owner can recruit from the building it captured", () => {
  const captured = capture();
  const seized = { ...captured.state.settlements.s1, gold: 1000 };
  const sources = eligibleRecruitSources(seized, { unitTypes, seatFactionId: "human" });
  assert.deepEqual(
    [...new Set(sources.map((s) => s.entry.unitTypeId))],
    ["peasant"],
    "every recruit source in the captured city offers the owner's own unit",
  );
  assert.equal(sources.length, 3, "the crypt, the ossuary and the district's spire were all seized");
  const state = { ...captured.state, settlements: { ...captured.state.settlements, s1: seized } };
  const recruited = recruitUnits(state, {
    settlementId: "s1",
    buildingKind: "farmhouse",
    gx: CRYPT.gx,
    gy: CRYPT.gy,
    unitTypeId: "peasant",
    count: 1,
  });
  assert.equal(recruited.ok, true, recruited.reason);
  assert.deepEqual(recruited.state.settlements.s1.stacks?.[0].entries, [{ unitTypeId: "peasant", count: 1 }]);
});

test("an unowned settlement's foreign buildings are seized by whoever takes it", () => {
  const state = board();
  state.settlements.s1 = { ...state.settlements.s1, ownerId: null };
  const result = captureSettlement(state, "h0", "s1");
  assert.equal(result.captured, true);
  assert.equal(result.previousOwnerId, null);
  assert.deepEqual(
    result.state.settlements.s1.buildings.map((b) => b.kind),
    ["townHall", "farmhouse", "farmhouse", "woodcutterHut", "house"],
  );
});

test("a rejected capture rolls the seized buildings back to what the settlement held", () => {
  const state = board();
  const before = state.settlements.s1;
  const captured = captureSettlement(state, "h0", "s1");
  const rolled = rollbackCaptureSettlement(captured.state, "h0", "s1", captured.previousOwnerId, before);
  assert.ok(rolled);
  assert.equal(rolled.settlements.s1.ownerId, 1);
  assert.equal(rolled.settlements.s1.buildings, before.buildings);
  assert.equal(rolled.settlements.s1.districts, before.districts);
  assert.deepEqual(rolled.settlements.s1.buildings[1].draft, {
    ghoul: 1,
    skeleton_warrior: 3,
    grave_hound: 3,
  });
});

test("the owners' settlement rosters still follow the capture", () => {
  const captured = capture();
  assert.deepEqual(captured.state.players.find((p) => p.id === 0)?.settlementIds, ["s0", "s1"]);
  assert.deepEqual(captured.state.players.find((p) => p.id === 1)?.settlementIds, []);
});

// ── The same thing in a real seeded game ──

test("a real two-seat game: the captured capital offers the player nothing before, and its own levy after", () => {
  const state = buildInitialGameState(new GameMap(7, "small"), mulberry32(42), {
    enemyCount: 1,
    humanSeatCount: 1,
    seatFactions: ["human", "ashen"],
  });
  const castle = Object.values(state.settlements).find((s) => s.ownerId === 1);
  assert.ok(castle, "seat 1 owns a castle");
  assert.ok(castle.buildings.some((b) => b.kind === "crypt"), "the Ashen seat was founded with a crypt");
  const hero = Object.values(state.heroes).find((h) => h.ownerId === 0);
  assert.ok(hero);
  const emptied = { ...castle, stacks: [] };
  const emptiedState = { ...state, settlements: { ...state.settlements, [castle.id]: emptied } };
  const before = eligibleRecruitSources(emptied, { unitTypes, seatFactionId: "human" });
  assert.deepEqual(before, [], "an ashen-founded city offers a Crownlands seat nothing of its own");

  const captured = captureSettlement(emptiedState, hero.id, castle.id);
  assert.equal(captured.captured, true);
  const seized = captured.state.settlements[castle.id];
  const after = eligibleRecruitSources(seized, { unitTypes, seatFactionId: "human" });
  assert.ok(after.length > 0, "the captured capital can raise the player's own levy");
  assert.ok(after.every((s) => s.entry.unitTypeId === "peasant"));
  assert.ok(
    seized.buildings.every((b) => b.kind !== "crypt" && b.kind !== "ossuary"),
    "no ashen troop building survives the capture",
  );
});
