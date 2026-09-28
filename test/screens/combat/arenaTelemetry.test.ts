import { test } from "node:test";
import assert from "node:assert/strict";
import { startManualBattle, type BattleSide, type ManualBattleState, type UnitType } from "@heroes/engine";
import {
  attackFromSelectedHex,
  attackFromTarget,
  castSpellAction,
  moveSelectedTo,
  retreatAction,
  surrenderAction,
  type BattleAction,
} from "../../../src/screens/combat/arena/state";

// Unit coverage for the arena's telemetry wrappers (plan
// 2026-09-27-manual-battle-wiring.md, work item 4b): each *applied* action
// must produce exactly one row with the arena-level phase plus the full
// action + state context, and a rejected click must produce nothing (there
// is no state change for a future re-simulation to verify). The
// start/end rows are emitted by openManualBattleArena itself -- that part is
// covered by the GameActions wiring, not here; this file pins the wrapper
// contract and the never-fail-the-arena guard against real engine states
// built by startManualBattle (no DOM needed -- these wrappers are engine-only).

const unitTypes: Record<string, UnitType> = {
  footman: {
    id: "footman",
    name: "Footman",
    attack: 5,
    defence: 5,
    health: 20,
    speed: 3,
    description: "",
    advantageType: "infantry",
    specialty: "shield",
    specialtyPriority: 0,
  },
  archer: {
    id: "archer",
    name: "Archer",
    attack: 5,
    defence: 2,
    health: 10,
    speed: 3,
    description: "",
    advantageType: "ranged",
    specialty: "archery",
    specialtyPriority: 0,
  },
};

function makeState(): ManualBattleState {
  const playerPlatoons = [{ entries: [{ unitTypeId: "footman", count: 5 }, { unitTypeId: "archer", count: 3 }] }];
  const aiPlatoons = [{ entries: [{ unitTypeId: "footman", count: 4 }] }];
  return startManualBattle(playerPlatoons, aiPlatoons, {
    unitTypes,
    obstacleSeed: 1,
    sideChoice: "attacker",
  });
}

function spy(): { rows: BattleAction[]; emit: (action: BattleAction) => void } {
  const rows: BattleAction[] = [];
  return { rows, emit: (action) => rows.push(action) };
}

test("moveSelectedTo streams one move row with side/slot/from/to/distance and round context", () => {
  const state = makeState();
  // Park the platoon somewhere deterministic rather than reasoning about
  // deployment slots.
  state.attacker[0].position = { q: 2, r: 2 };
  const from = { q: 2, r: 2 };
  const { rows, emit } = spy();

  const target = { q: 3, r: 2 };
  const result = moveSelectedTo(state, "attacker", 0, target, emit);

  assert.equal(result.moved, true);
  assert.equal(rows.length, 1, "an applied move streams exactly one row");
  assert.equal(rows[0].phase, "move");
  const payload = rows[0].payload as Record<string, unknown>;
  assert.equal(payload.side, "attacker");
  assert.equal(payload.slotIndex, 0);
  assert.deepEqual(payload.from, from);
  assert.deepEqual(payload.to, target);
  assert.equal(payload.distance, 1);
  assert.equal(payload.round, state.round);
  assert.equal(typeof payload.timeOfDay, "string", "time-of-day context rides every row");
});

test("a rejected move streams nothing (no state change, nothing to re-simulate)", () => {
  const state = makeState();
  const { rows, emit } = spy();
  // 20 hexes away: far outside any platoon's movement budget.
  const result = moveSelectedTo(state, "attacker", 0, { q: state.attacker[0].position.q + 20, r: state.attacker[0].position.r }, emit);
  assert.equal(result.moved, false);
  assert.deepEqual(rows, []);
});

test("attackFromTarget streams one attack row when the engine applies it", () => {
  // Hand-crafted adjacency: drop the attacker's first platoon next to the
  // defender's, then attack through the wrapper.
  const state = makeState();
  state.attacker[0].position = { q: 5, r: 5 };
  state.defender[0].position = { q: 6, r: 5 };
  const { rows, emit } = spy();

  const ok = attackFromTarget(state, "attacker", 0, 0, emit);
  assert.equal(ok, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phase, "attack");
  const payload = rows[0].payload as Record<string, unknown>;
  assert.equal(payload.side, "attacker");
  assert.equal(payload.slotIndex, 0);
  assert.equal(payload.targetSlotIndex, 0);
  assert.equal(payload.round, state.round);
});

test("retreat and surrender stream their own phase rows with side context", () => {
  const retreated = makeState();
  const retreatSpy = spy();
  retreatAction(retreated, "attacker", retreatSpy.emit);
  assert.deepEqual(
    retreatSpy.rows.map((r) => r.phase),
    ["retreat"],
  );
  assert.equal((retreatSpy.rows[0].payload as Record<string, unknown>).side, "attacker");
  assert.equal(retreated.attacker[0].retreated, true, "engine retreat applied before the row is emitted");

  const surrendered = makeState();
  const surrenderSpy = spy();
  surrenderAction(surrendered, "attacker", surrenderSpy.emit);
  assert.deepEqual(
    surrenderSpy.rows.map((r) => r.phase),
    ["surrender"],
  );
  assert.equal(surrendered.attacker[0].retreated, true);
});

test("a throwing telemetry callback never fails the arena action", () => {
  const state = makeState();
  // GameActions's production emit can't throw (api.postBattleAction swallows
  // its own errors), but the guard in state.ts must make that guarantee
  // structural: a broken callback is logged, not surfaced, and the action it
  // describes still stands.
  state.attacker[0].position = { q: 2, r: 2 };
  const target = { q: 3, r: 2 };
  assert.doesNotThrow(() => {
    moveSelectedTo(state, "attacker", 0, target, () => {
      throw new Error("telemetry endpoint exploded");
    });
  });
  assert.deepEqual(state.attacker[0].position, target, "the move itself still applied");
});

test("attackFromSelectedHex streams the approach-hex move+attack as a single attack row", () => {
  const state = makeState();
  // Two hexes apart on the same row: (5,5) -> approach hex (5,6)? Use the
  // straight horizontal case -- approach hex (6,5) is adjacent to both.
  state.attacker[0].position = { q: 4, r: 5 };
  state.defender[0].position = { q: 6, r: 5 };
  const { rows, emit } = spy();

  const ok = attackFromSelectedHex(state, "attacker", 0, 0, { q: 5, r: 5 }, emit);
  assert.equal(ok, true, "move-then-attack via the approach hex applies");
  assert.deepEqual(
    rows.map((r) => r.phase),
    ["attack"],
    "the combined move+attack is one streamed action, not two",
  );
  const payload = rows[0].payload as Record<string, unknown>;
  assert.deepEqual(payload.from, { q: 5, r: 5 });
});

// ---- Spellcasting v1 (roadmap §"Spellcasting v1", wiring requirement) ------

function spellState(): { state: ManualBattleState } {
  const playerPlatoons = [{ entries: [{ unitTypeId: "footman", count: 5 }] }];
  const aiPlatoons = [{ entries: [{ unitTypeId: "footman", count: 4 }] }];
  const loadout = { spell: "magic_arrow" as const, mana: 20, maxMana: 20, power: 10 };
  const state = startManualBattle(playerPlatoons, aiPlatoons, {
    unitTypes,
    obstacleSeed: 1,
    sideChoice: "attacker",
    heroSpells: { attacker: loadout },
  });
  return { state };
}

test("castSpellAction streams one spell row with spell id, sides, target, damage and mana", () => {
  const { state } = spellState();
  const { rows, emit } = spy();

  const cast = castSpellAction(state, "attacker", 0, emit);
  assert.ok(cast, "the cast applied");
  assert.equal(rows.length, 1, "an applied cast streams exactly one row");
  assert.equal(rows[0].phase, "spell");
  const payload = rows[0].payload as Record<string, unknown>;
  assert.equal(payload.side, "attacker");
  assert.equal(payload.spell, "magic_arrow");
  assert.equal(payload.targetSlotIndex, 0);
  assert.equal(payload.damage, 10, "the flat arcane-scaled damage rides the row");
  assert.equal(payload.manaSpent, 10);
  assert.equal(payload.round, state.round);
  assert.equal(typeof payload.timeOfDay, "string", "time-of-day context rides every row");
  assert.ok(Array.isArray(payload.casualties), "casualties ride the row for the future re-simulator");
  assert.equal(state.heroSpells.attacker!.mana, 10, "the engine state's mana was spent before emission");
});

test("a rejected cast streams nothing (no state change, nothing to re-simulate)", () => {
  // No loadout on this state: the engine refuses the cast and the wrapper
  // must not emit a row.
  const state = makeState();
  const { rows, emit } = spy();
  assert.equal(castSpellAction(state, "attacker", 0, emit), null);
  assert.deepEqual(rows, []);
});

test("out-of-mana casts stream nothing", () => {
  const { state } = spellState();
  state.heroSpells.attacker!.mana = 0;
  const { rows, emit } = spy();
  assert.equal(castSpellAction(state, "attacker", 0, emit), null);
  assert.deepEqual(rows, []);
});
