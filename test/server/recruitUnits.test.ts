import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  BuildingDef,
  Command,
  FactionId,
  HeroId,
  HeroState,
  Player,
  PlayerId,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { normalizePlatoons } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

function makeHero(id: HeroId, ownerId: PlayerId, q: number, r: number, overrides: Partial<HeroState> = {}): HeroState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    movementRemaining: 7,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q, r }],
    gold: 0,
    troops: 1,
    stacks: [],
    isChartering: false,
    charterId: null,
    horseVariant: "bubbly",
    ...overrides,
  };
}

function makeSettlement(
  id: SettlementId,
  ownerId: PlayerId | null,
  q: number,
  r: number,
  overrides: Partial<SettlementState> = {},
): SettlementState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    level: 1,
    population: 0,
    goldTax: 0,
    resourceRates: {},
    foundedOnResource: null,
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    autoTrade: true,
    castleVariant: 0,
    buildings: [],
    ...overrides,
  };
}

function building(kind: BuildingDef["kind"], gx: number, gy: number, level = 1): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
];

function makeRow(
  heroes: HeroState[],
  settlements: SettlementState[],
  overrides: Partial<HydratableGameRow> = {},
): HydratableGameRow {
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
    ...overrides,
  };
}

function makeDeps(row: HydratableGameRow, catalogUnitTypes: UnitType[] = []) {
  const gameRepo = createMockGameRepo({ [row.name as string]: row });
  const eventRepo = createMockEventRepo();
  const heroRepo = createMockHeroRepo({ [row.name as string]: row.heroes });
  const settlementRepo = createMockSettlementRepo({ [row.name as string]: row.settlements });
  const charterRepo = createMockCharterRepo();
  return {
    gameRepo,
    eventRepo,
    heroRepo,
    settlementRepo,
    charterRepo,
    deps: { gameRepo, eventRepo, heroRepo, settlementRepo, charterRepo, ctx: { rng: () => 0.5, catalog: { unitTypes: catalogUnitTypes } } },
  };
}

const BARRACKS = { gx: 2, gy: 3 };

function recruitRow(settlementOverrides: Partial<SettlementState> = {}): HydratableGameRow {
  return makeRow(
    [makeHero("h0", 0, 9, 9)],
    [
      makeSettlement("s0", 0, 5, 5, {
        gold: 1000,
        buildings: [building("barracks", BARRACKS.gx, BARRACKS.gy)],
        ...settlementOverrides,
      }),
      makeSettlement("s1", 1, 18, 4),
    ],
  );
}

function recruitCommand(overrides: Partial<Extract<Command, { kind: "RecruitUnits" }>> = {}): Extract<Command, { kind: "RecruitUnits" }> {
  return {
    kind: "RecruitUnits",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    buildingKind: "barracks",
    gx: BARRACKS.gx,
    gy: BARRACKS.gy,
    unitTypeId: "swordsman",
    count: 2,
    ...overrides,
  };
}

test("RecruitUnits recruits 2 swordsmen into the garrison, deducts treasury gold, and emits UnitsRecruited", async () => {
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(recruitRow());
  const result = await handleCommand(recruitCommand(), deps);
  assert.equal(result.ok, true);

  const garrison = result.settlement?.stacks ?? [];
  assert.equal(garrison.length, 8, "garrison normalizes to the fixed 8 platoon slots");
  assert.deepEqual(garrison[0].entries, [{ unitTypeId: "swordsman", count: 2 }]);
  assert.equal(result.settlement?.gold, 600, "2 swordsmen at 200g each");
  assert.equal(result.lastEventId, 1);
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "UnitsRecruited",
    actor: 0,
    settlementId: "s0",
    unitTypeId: "swordsman",
    count: 2,
  });

  const saved = gameRepo.rows["test-game"].settlements.s0;
  assert.equal(saved.gold, 600, "settlement gold deducted in the saved row");
  assert.deepEqual(saved.stacks, normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 2 }] }]));
  assert.equal(settlementRepo.calls.length, 1, "settlement dual-write fires");
  assert.equal(settlementRepo.calls[0].value.s0.gold, 600);
  assert.equal(heroRepo.calls.length, 0, "heroes unchanged, heroRepo never called");
});

test("RecruitUnits rejects recruiting from a settlement the actor doesn't own", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(recruitRow({ ownerId: 1 }));
  const result = await handleCommand(recruitCommand(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_settlement");
  assert.equal(eventRepo.events.length, 0);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 1000, "nothing persisted on rejection");
});

test("RecruitUnits rejects a buildingKind/gx/gy that matches no placed building", async () => {
  const { deps, eventRepo } = makeDeps(recruitRow());
  const result = await handleCommand(recruitCommand({ gx: 9, gy: 9 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_building");
  assert.equal(eventRepo.events.length, 0);
});

test("RecruitUnits rejects a unit above the building's level (pikeman needs barracks L2)", async () => {
  const { deps, eventRepo } = makeDeps(recruitRow());
  const result = await handleCommand(recruitCommand({ unitTypeId: "pikeman", count: 1 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "building_level_too_low");
  assert.equal(eventRepo.events.length, 0);
});

test("RecruitUnits rejects more recruits than the treasury can pay for and persists nothing", async () => {
  const { gameRepo, eventRepo, settlementRepo, deps } = makeDeps(recruitRow({ gold: 100 }));
  const result = await handleCommand(recruitCommand({ count: 1 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_enough_gold");
  assert.equal(eventRepo.events.length, 0);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 100);
  assert.equal(settlementRepo.calls.length, 0);
});

test("RecruitUnits rejects a count of 0", async () => {
  const { deps, eventRepo } = makeDeps(recruitRow());
  const result = await handleCommand(recruitCommand({ count: 0 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_count");
  assert.equal(eventRepo.events.length, 0);
});

// ── Faction gate (migration 024): the crypt's ghoul is an ashen-roster
// unit, so the server-side gate rejects it for a human seat and admits it
// for an ashen seat — the same crypt, the same command, only the acting
// seat's factionId differs. ──

function ghoulCatalogUnit(): UnitType {
  return {
    id: "ghoul",
    name: "Ghoul",
    attack: 3,
    defence: 1,
    health: 5,
    speed: 5,
    description: "",
    advantageType: "infantry",
    factionId: "ashen",
  };
}

function cryptRow(seatFactionId: FactionId): HydratableGameRow {
  const row = recruitRow({ buildings: [building("crypt", 1, 2)] });
  return {
    ...row,
    players: [{ ...PLAYERS[0], factionId: seatFactionId }, PLAYERS[1]],
  };
}

function cryptCommand(): Extract<Command, { kind: "RecruitUnits" }> {
  return recruitCommand({ buildingKind: "crypt", gx: 1, gy: 2, unitTypeId: "ghoul", count: 1 });
}

test("RecruitUnits admits the ashen ghoul for a human seat too, with an owned built crypt (the seat-faction gate is gone)", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(cryptRow("human"));
  deps.ctx.catalog.unitTypes = [ghoulCatalogUnit()];
  const result = await handleCommand(cryptCommand(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.gold, 960, "1 ghoul at 40g");
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 960);
  assert.equal(eventRepo.events.length, 1);
});

test("RecruitUnits admits the ashen ghoul for an ashen seat and charges the crypt's 40g", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(cryptRow("ashen"));
  deps.ctx.catalog.unitTypes = [ghoulCatalogUnit()];
  const result = await handleCommand(cryptCommand(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.gold, 960, "1 ghoul at 40g");
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 960);
  assert.equal(eventRepo.events.length, 1);
});

// ── Ironmark Holds faction gating (025_ironmark_holds): the server path ──

function ironmarkCatalogUnit(id: string): UnitType {
  return {
    id,
    name: id,
    attack: 1,
    defence: 1,
    health: 1,
    speed: 1,
    description: "",
    advantageType: "infantry",
    specialty: "sword",
    specialtyPriority: 1.0,
    factionId: "ironmark",
  };
}

const FORGE_HALL = { gx: 2, gy: 3 };

function forgeHallRow(actorFactionId?: "ironmark"): HydratableGameRow {
  const players: Player[] = [
    {
      id: 0,
      faction: "player",
      name: "Player 1",
      color: "#000000",
      heroIds: ["h0"],
      settlementIds: ["s0"],
      ...(actorFactionId ? { factionId: actorFactionId } : {}),
    },
  ];
  return makeRow(
    [makeHero("h0", 0, 9, 9)],
    [makeSettlement("s0", 0, 5, 5, { gold: 1000, buildings: [building("forgeHall", FORGE_HALL.gx, FORGE_HALL.gy)] })],
    { players, active_player_id: 0 },
  );
}

function forgeHallCommand(): Extract<Command, { kind: "RecruitUnits" }> {
  return {
    kind: "RecruitUnits",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    buildingKind: "forgeHall",
    gx: FORGE_HALL.gx,
    gy: FORGE_HALL.gy,
    unitTypeId: "dwarf_axeman",
    count: 2,
  };
}

test("RecruitUnits lets an ironmark seat recruit dwarf_axeman from a forgeHall", async () => {
  const { deps, eventRepo } = makeDeps(forgeHallRow("ironmark"), [ironmarkCatalogUnit("dwarf_axeman")]);
  const result = await handleCommand(forgeHallCommand(), deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.settlement?.stacks[0]?.entries, [{ unitTypeId: "dwarf_axeman", count: 2 }]);
  assert.equal(result.settlement?.gold, 1000 - 440, "2 dwarf axemen at 220g each");
  assert.equal(eventRepo.events[0].payload.unitTypeId, "dwarf_axeman");
});

test("RecruitUnits: a human seat can also recruit dwarf_axeman from an owned forgeHall (the seat-faction gate is gone)", async () => {
  // Construction-worker-gated faction-building feature (section 2): the
  // server's unitAllowedForSeatFaction pre-check is deleted. Every recruit
  // building's roster is already faction-pure, so owning the building is
  // the only gate left -- which is also what makes a CAPTURED forgeHall
  // finally worth capturing (recruiting from it used to be
  // unit_not_in_seat_faction forever for a non-ironmark owner).
  const { deps, eventRepo } = makeDeps(forgeHallRow(), [ironmarkCatalogUnit("dwarf_axeman")]);
  const result = await handleCommand(forgeHallCommand(), deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.settlement?.stacks[0]?.entries, [{ unitTypeId: "dwarf_axeman", count: 2 }]);
  assert.equal(eventRepo.events.length, 1);
});

// ── Building-ownership-only gating (026_verdant_wild buildings, now
// re-pinned for the seat-faction gate's removal): the server path owns no
// faction pre-check any more -- owning the recruit building is the gate.

function catalogUnit(id: string, factionId: FactionId): UnitType {
  return {
    id,
    name: id,
    attack: 1,
    defence: 1,
    health: 1,
    speed: 1,
    description: "",
    advantageType: "infantry",
    specialty: "",
    specialtyPriority: 0,
    factionId,
  };
}

const SYLVAN_STABLES = { gx: 4, gy: 4 };

function factionRow(seatFactionId?: FactionId): HydratableGameRow {
  const players: Player[] = PLAYERS.map((p) =>
    p.id === 0 ? { ...p, ...(seatFactionId !== undefined ? { factionId: seatFactionId } : {}) } : p,
  );
  return makeRow(
    [makeHero("h0", 0, 9, 9)],
    [
      makeSettlement("s0", 0, 5, 5, {
        gold: 5000,
        warehouse: { wood: 20, stone: 0, iron: 0, arcane: 10, food: 0 },
        buildings: [
          building("barracks", BARRACKS.gx, BARRACKS.gy),
          building("sylvanStables", SYLVAN_STABLES.gx, SYLVAN_STABLES.gy, 2),
        ],
      }),
      makeSettlement("s1", 1, 18, 4),
    ],
    { players },
  );
}

const FACTION_CATALOG: UnitType[] = [
  catalogUnit("swordsman", "human"),
  catalogUnit("elk_rider", "verdant"),
  catalogUnit("stag_knight", "verdant"),
];

test("RecruitUnits: a verdant seat recruits elk_rider from its own sylvanStables", async () => {
  const { deps, eventRepo } = makeDeps(factionRow("verdant"), FACTION_CATALOG);
  const result = await handleCommand(
    recruitCommand({
      buildingKind: "sylvanStables",
      gx: SYLVAN_STABLES.gx,
      gy: SYLVAN_STABLES.gy,
      unitTypeId: "elk_rider",
      count: 1,
    }),
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.gold, 5000 - 450, "1 elk rider at 450g");
  assert.deepEqual((result.settlement?.stacks ?? [])[0].entries, [{ unitTypeId: "elk_rider", count: 1 }]);
  assert.equal(eventRepo.events.length, 1);
});

test("RecruitUnits: a human (default) seat can ALSO recruit elk_rider from an owned sylvanStables (the seat-faction gate is gone)", async () => {
  // Same building-ownership-only gating as the forgeHall pin above: this
  // used to be unit_not_in_seat_faction before the seat-faction recruit
  // gate was deleted (section 2) -- a captured sylvanStables is now usable
  // by its new owner instead of permanently dead weight.
  const { deps, eventRepo } = makeDeps(factionRow(), FACTION_CATALOG);
  const result = await handleCommand(
    recruitCommand({
      buildingKind: "sylvanStables",
      gx: SYLVAN_STABLES.gx,
      gy: SYLVAN_STABLES.gy,
      unitTypeId: "elk_rider",
      count: 1,
    }),
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.gold, 5000 - 450, "1 elk rider at 450g");
  assert.equal(eventRepo.events.length, 1);
});

test("RecruitUnits: a verdant seat can also recruit human-rostered swordsman from its own barracks", async () => {
  const { deps, eventRepo } = makeDeps(factionRow("verdant"), FACTION_CATALOG);
  const result = await handleCommand(recruitCommand({ unitTypeId: "swordsman", count: 1 }), deps);
  assert.equal(result.ok, true);
  assert.equal(eventRepo.events.length, 1);
});

for (const [factionId, buildingKind, unitTypeId, price] of [
  ["human", "farmhouse", "peasant", 25],
  ["ashen", "crypt", "ghoul", 40],
  ["ironmark", "delversHall", "tunnel_levy", 30],
  ["verdant", "seedlingGrove", "sproutling", 25],
] as const) {
  test(`RecruitUnits recruits ${unitTypeId} from the ${factionId} starter and persists its draft and payment`, async () => {
    const row = recruitRow({ buildings: [building(buildingKind, 2, 3)] });
    row.players = [{ ...PLAYERS[0], factionId }, PLAYERS[1]];
    const { deps, eventRepo, settlementRepo } = makeDeps(row, [catalogUnit(unitTypeId, factionId)]);
    const result = await handleCommand(recruitCommand({ buildingKind, unitTypeId, count: 1 }), deps);
    assert.equal(result.ok, true);
    assert.equal(result.settlement?.gold, 1000 - price);
    assert.deepEqual(result.settlement?.stacks[0].entries, [{ unitTypeId, count: 1 }]);
    assert.equal(result.settlement?.buildings[0].draft?.[unitTypeId], 2);
    assert.equal(settlementRepo.calls.length, 1);
    assert.equal(settlementRepo.calls[0].value.s0.gold, 1000 - price);
    assert.equal(eventRepo.events[0].payload.unitTypeId, unitTypeId);
  });

  test(`RecruitUnits allows ${unitTypeId} from an existing ${buildingKind} even when the seat plays another faction (ownership-only gating)`, async () => {
    const row = recruitRow({ buildings: [building(buildingKind, 2, 3)] });
    row.players = [{ ...PLAYERS[0], factionId: factionId === "human" ? "ashen" : "human" }, PLAYERS[1]];
    const { deps, eventRepo, settlementRepo } = makeDeps(row, [catalogUnit(unitTypeId, factionId)]);
    const result = await handleCommand(recruitCommand({ buildingKind, unitTypeId, count: 1 }), deps);
    assert.equal(result.ok, true);
    assert.equal(result.settlement?.gold, 1000 - price);
    assert.equal(eventRepo.events.length, 1);
    assert.equal(settlementRepo.calls.length, 1);
  });
}
