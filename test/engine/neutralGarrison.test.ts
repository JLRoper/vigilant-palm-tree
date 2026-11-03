import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import {
  CURRENT_MAP_GEN_VERSION,
  getOrCreateGameMap,
  makeInitialStatePayload,
  mulberry32,
  neutralGarrisonStacks,
  playerHeroId,
  platoonTroopTotal,
  settlementStacks,
} from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

// A neutral settlement is a level-3 capital with nobody sitting in it, and
// before NEUTRAL_CAPITAL_GARRISON existed it carried no `stacks` at all:
// walking a hero onto one captured it for free, so six free capitals in the
// fog were the whole middle game (seed 12345 / 36x27 medium: 9 settlements,
// 6 neutral L3, every one `stacks` ABSENT).
//
// These tests pin both halves: the seeded neutral capital now carries a live
// garrison, and the walk-in refusal (`garrison_not_defeated`) applies to it —
// with a no-garrison control still capturing, because that is the rule the
// refusal was written for and it must not have become "neutral always blocked".

function seededRow(seed: number, size: "small" | "medium"): HydratableGameRow {
  const map = getOrCreateGameMap(seed, size, CURRENT_MAP_GEN_VERSION);
  const payload = makeInitialStatePayload(map, mulberry32(seed ^ 0x706c6179), {
    playerCount: 2,
    humanSeatCount: 1,
  });
  return {
    name: "neutral-garrison",
    seed,
    round: payload.round,
    day: payload.day,
    active_player_id: payload.active_player_id,
    players: payload.players,
    heroes: payload.heroes,
    settlements: payload.settlements,
  };
}

function makeDeps(row: HydratableGameRow) {
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
    deps: {
      gameRepo,
      eventRepo,
      heroRepo,
      settlementRepo,
      charterRepo,
      ctx: { rng: () => 0.5, catalog: { unitTypes: [] } },
    },
  };
}

/** Row variant with seat 0's hero lifted onto `settlementId`'s tile. */
function heroOnSettlement(row: HydratableGameRow, settlementId: SettlementId): HydratableGameRow {
  const settlement = row.settlements[settlementId];
  assert.ok(settlement, `${settlementId} exists in the seeded row`);
  const heroId = playerHeroId();
  const hero = row.heroes[heroId];
  assert.ok(hero, `${heroId} exists in the seeded row`);
  return {
    ...row,
    heroes: {
      ...row.heroes,
      [heroId]: { ...hero, q: settlement.q, r: settlement.r, movementRemaining: 7 },
    },
  };
}

test("the neutral capital garrison is one platoon of 12 pikemen + 4 archers", () => {
  const stacks = neutralGarrisonStacks(3);
  assert.deepEqual(stacks, [
    { entries: [{ unitTypeId: "pikeman", count: 12 }, { unitTypeId: "archer", count: 4 }] },
  ]);
  assert.equal(platoonTroopTotal(stacks), 16);
  assert.equal(neutralGarrisonStacks(1).length, 0, "a level-1 neutral is not garrisoned");
  assert.equal(neutralGarrisonStacks(2).length, 0, "a level-2 neutral is not garrisoned");
});

test("every neutral settlement the generator seeds carries a live garrison", () => {
  for (const [seed, size] of [[12345, "medium"], [42, "small"]] as const) {
    const row = seededRow(seed, size);
    const settlements = Object.values(row.settlements);
    const neutrals = settlements.filter((s) => s.ownerId === null);
    assert.ok(neutrals.length > 0, `seed ${seed} (${size}) places at least one neutral`);
    for (const s of neutrals) {
      assert.equal(s.level, 3, "a generated neutral is a capital");
      assert.ok(s.stacks !== undefined, `${s.id} must carry stacks — this is the whole defect`);
      assert.equal(
        platoonTroopTotal(settlementStacks(s)),
        16,
        `${s.id} must carry the 16-troop capital garrison`,
      );
    }
    // The change is NEUTRAL-ONLY: a seat's own starting castle is untouched.
    for (const s of settlements.filter((s) => s.ownerId !== null)) {
      assert.equal(s.stacks, undefined, `${s.id} (owned) must still start with no garrison`);
    }
  }
});

test("walking onto a generated neutral capital is refused (garrison_not_defeated)", async () => {
  const seeded = seededRow(12345, "medium");
  const neutral = Object.values(seeded.settlements).find((s) => s.ownerId === null);
  assert.ok(neutral, "the seed places a neutral capital");
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(heroOnSettlement(seeded, neutral.id));

  const command: Command = {
    kind: "CaptureSettlement",
    gameName: "neutral-garrison",
    actor: 0,
    heroId: playerHeroId(),
    settlementId: neutral.id,
  };
  const result = await handleCommand(command, deps);

  assert.equal(result.ok, false, "a garrisoned neutral capital cannot be walked into");
  assert.equal(result.reason, "garrison_not_defeated");
  assert.equal(eventRepo.events.length, 0);
  assert.equal(gameRepo.rows["neutral-garrison"].settlements[neutral.id].ownerId, null, "owner unchanged");
  assert.equal(heroRepo.calls.length, 0);
  assert.equal(settlementRepo.calls.length, 0);
});

test("control: a neutral settlement with NO stacks is still walkable", async () => {
  const seeded = seededRow(12345, "medium");
  const neutral = Object.values(seeded.settlements).find((s) => s.ownerId === null);
  assert.ok(neutral, "the seed places a neutral capital");
  const ungarrisoned: SettlementState = { ...neutral };
  delete (ungarrisoned as { stacks?: SettlementState["stacks"] }).stacks;
  const row = heroOnSettlement(
    { ...seeded, settlements: { ...seeded.settlements, [neutral.id]: ungarrisoned } },
    neutral.id,
  );
  const { gameRepo, deps } = makeDeps(row);

  const command: Command = {
    kind: "CaptureSettlement",
    gameName: "neutral-garrison",
    actor: 0,
    heroId: playerHeroId(),
    settlementId: neutral.id,
  };
  const result = await handleCommand(command, deps);

  assert.equal(result.ok, true, `an ungarrisoned neutral stays walkable: ${result.reason}`);
  assert.equal(result.settlement?.ownerId, 0);
  assert.equal(gameRepo.rows["neutral-garrison"].settlements[neutral.id].ownerId, 0);
});
