import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, Command, Player, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { eligibleRecruitSources } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";
import { makeHero, makeSettlement } from "../charter/_helpers";

function building(kind: BuildingDef["kind"], gx: number, gy: number, level = 1): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

const CRYPT = { gx: 4, gy: 4 };

function catalogUnit(id: string, factionId: "human" | "ashen"): UnitType {
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

const CATALOG: UnitType[] = [
  catalogUnit("peasant", "human"),
  catalogUnit("ghoul", "ashen"),
  catalogUnit("skeleton_warrior", "ashen"),
];

const CATALOG_BY_ID: Record<string, UnitType> = Object.fromEntries(CATALOG.map((u) => [u.id, u]));

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"], factionId: "human" },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"], factionId: "ashen" },
];

/** The ashen seat's capital: a crypt whose draft pool is posted, and nobody defending it. */
function ashenCapitalRow(): HydratableGameRow {
  const capital: SettlementState = {
    ...makeSettlement("s1", 1, CRYPT.gx, CRYPT.gy, {
      level: 3,
      gold: 1000,
      buildings: [building("townHall", 4, 5), building("crypt", CRYPT.gx, CRYPT.gy)],
    }),
    stacks: [],
  };
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: {
      h0: makeHero("h0", 0, CRYPT.gx, CRYPT.gy),
      h1: makeHero("h1", 1, 20, 20),
    },
    settlements: {
      s0: makeSettlement("s0", 0, 1, 1),
      s1: capital,
    },
  };
}

function makeDeps(row: HydratableGameRow) {
  const gameName = row.name as string;
  const gameRepo = createMockGameRepo({ [gameName]: row });
  const eventRepo = createMockEventRepo();
  const heroRepo = createMockHeroRepo({ [gameName]: row.heroes });
  const settlementRepo = createMockSettlementRepo({ [gameName]: row.settlements });
  const charterRepo = createMockCharterRepo();
  return {
    gameRepo,
    eventRepo,
    settlementRepo,
    deps: {
      gameRepo,
      eventRepo,
      heroRepo,
      settlementRepo,
      charterRepo,
      ctx: { rng: () => 0.5, catalog: { unitTypes: CATALOG } },
    },
  };
}

function captureCommand(): Extract<Command, { kind: "CaptureSettlement" }> {
  return { kind: "CaptureSettlement", gameName: "test-game", actor: 0, heroId: "h0", settlementId: "s1" };
}

function recruitCommand(overrides: Partial<Extract<Command, { kind: "RecruitUnits" }>> = {}) {
  return {
    kind: "RecruitUnits" as const,
    gameName: "test-game",
    actor: 0,
    settlementId: "s1",
    buildingKind: "farmhouse" as BuildingDef["kind"],
    gx: CRYPT.gx,
    gy: CRYPT.gy,
    unitTypeId: "peasant",
    count: 1,
    ...overrides,
  };
}

test("the server seizes a captured troop building: the player recruits their own levy from the ashen crypt's cell", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(ashenCapitalRow());

  const captured = await handleCommand(captureCommand(), deps);
  assert.equal(captured.ok, true, `${captured.reason ?? ""}`);
  assert.equal(captured.settlement?.ownerId, 0);
  assert.deepEqual(
    captured.settlement?.buildings.map((b) => b.kind),
    ["townHall", "farmhouse"],
    "the captured settlement holds the capturing faction's own troop building",
  );
  assert.deepEqual(
    gameRepo.rows["test-game"].settlements.s1.buildings.map((b) => b.kind),
    ["townHall", "farmhouse"],
    "and so does the row the server persisted",
  );

  const recruited = await handleCommand(recruitCommand(), deps);
  assert.equal(recruited.ok, true, `${recruited.reason ?? ""}`);
  assert.equal(recruited.settlement?.gold, 975, "1 peasant at 25g, from the captured city's own treasury");
  assert.deepEqual(recruited.settlement?.stacks?.[0].entries, [{ unitTypeId: "peasant", count: 1 }]);
  assert.equal(eventRepo.events.at(-1)?.kind, "UnitsRecruited");
});

test("the ashen roster has no building left to come out of", async () => {
  const { gameRepo, deps } = makeDeps(ashenCapitalRow());
  const captured = await handleCommand(captureCommand(), deps);
  assert.equal(captured.ok, true, `${captured.reason ?? ""}`);

  const persisted = gameRepo.rows["test-game"].settlements.s1;
  assert.equal(persisted.buildings.some((b) => b.kind === "crypt" || b.kind === "ossuary"), false);
  assert.deepEqual(
    eligibleRecruitSources(persisted, { unitTypes: CATALOG_BY_ID, seatFactionId: "ashen" }),
    [],
    "nothing in the captured city offers the old owner's roster",
  );
  const ghouls = await handleCommand(
    recruitCommand({ buildingKind: "crypt", unitTypeId: "ghoul", count: 1 }),
    deps,
  );
  assert.equal(ghouls.ok, false);
});
