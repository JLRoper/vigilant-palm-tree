import { test } from "node:test";
import assert from "node:assert/strict";
import { totalHealth } from "@heroes/engine";
import type { BattleGrid, BattleHex, Combatant, ManualBattleState, PlatoonEntry, UnitType } from "@heroes/engine";
import { axialToPixel } from "../../src/core/hex";
import { buildBattleScene, type BattleSceneInput } from "../../src/render/scene/sceneBuilder/battleScene";
import type {
  BattleAiActingRingNode,
  BattleAiTelegraphHexNode,
  BattleAttackTargetRingNode,
  BattleCombatantNode,
  BattleFloatingTextNode,
  BattleHexNode,
  BattleImpactRingNode,
  BattleMovePathNode,
} from "../../src/render/scene/types";

function nodesOfKind<K extends { kind: string }>(nodes: unknown[], kind: K["kind"]): K[] {
  return (nodes as { kind: string }[]).filter((n) => n.kind === kind) as K[];
}

const UNIT_TYPES: Record<string, UnitType> = {
  sword: {
    id: "sword",
    name: "Swordsman",
    attack: 5,
    defence: 5,
    health: 10,
    speed: 4,
    description: "",
    advantageType: "infantry",
    specialty: "sword",
    specialtyPriority: 1,
  },
  archer: {
    id: "archer",
    name: "Archer",
    attack: 4,
    defence: 2,
    health: 6,
    speed: 3,
    description: "",
    advantageType: "ranged",
    specialty: "archery",
    specialtyPriority: 1,
  },
};

/** 4x3 grid with a single impassable hex at (2,1). */
function makeGrid(): BattleGrid {
  const hexes: BattleHex[] = [];
  for (let r = 0; r < 3; r++) {
    for (let q = 0; q < 4; q++) {
      hexes.push({ q, r, impassable: q === 2 && r === 1 });
    }
  }
  return { cols: 4, rows: 3, hexes };
}

function makeCombatant(overrides: Partial<Combatant> & { entries: PlatoonEntry[] }): Combatant {
  return {
    side: "attacker",
    slotIndex: 0,
    position: { q: 0, r: 0 },
    maxHealth: totalHealth(overrides.entries, UNIT_TYPES),
    hasCounterCharge: true,
    retreated: false,
    ...overrides,
  };
}

function makeState(overrides: Partial<ManualBattleState> = {}): ManualBattleState {
  return {
    grid: makeGrid(),
    attacker: [],
    defender: [],
    attackerOriginalPlatoons: [],
    defenderOriginalPlatoons: [],
    unitTypes: UNIT_TYPES,
    round: 1,
    unactedAttacker: new Set(),
    unactedDefender: new Set(),
    moveBudgetAttacker: new Map(),
    moveBudgetDefender: new Map(),
    log: [],
    maxRounds: 30,
    obstacleSeed: 1,
    over: false,
    sidesRetreated: new Set(),
    ...overrides,
  };
}

function baseInput(overrides: Partial<BattleSceneInput> = {}): BattleSceneInput {
  return {
    state: makeState(),
    humanSide: "attacker",
    aiSide: "defender",
    selectedSlot: null,
    moveRange: [],
    attackTargets: [],
    aiActing: false,
    aiActingSlot: null,
    aiTargetHex: null,
    moveAnim: null,
    impact: null,
    floats: [],
    hexSize: 32,
    offsetX: 0,
    offsetY: 0,
    nowMs: 1_000,
    ...overrides,
  };
}

test("baseline: an idle battle emits one battleHex per grid hex and one battleCombatant per living combatant, nothing else", () => {
  const attacker = makeCombatant({ side: "attacker", slotIndex: 0, position: { q: 0, r: 0 }, entries: [{ unitTypeId: "sword", count: 10 }] });
  const defender = makeCombatant({ side: "defender", slotIndex: 0, position: { q: 3, r: 0 }, entries: [{ unitTypeId: "archer", count: 5 }] });
  const state = makeState({ attacker: [attacker], defender: [defender] });
  const nodes = buildBattleScene(baseInput({ state }));

  assert.equal(nodesOfKind(nodes, "battleHex").length, 12, "4x3 grid = 12 hexes");
  assert.equal(nodesOfKind(nodes, "battleCombatant").length, 2);
  for (const kind of [
    "battleAttackTargetRing",
    "battleAiTelegraphHex",
    "battleMovePath",
    "battleImpactRing",
    "battleAiActingRing",
    "battleFloatingText",
  ]) {
    assert.equal(nodesOfKind(nodes, kind).length, 0, `${kind} should not appear while idle`);
  }
});

test("battleHex flags: impassable comes from the grid, inMoveRange from moveRange, available from the human side's unacted living combatants", () => {
  const human = makeCombatant({ side: "attacker", slotIndex: 0, position: { q: 0, r: 0 }, entries: [{ unitTypeId: "sword", count: 10 }] });
  const state = makeState({ attacker: [human], unactedAttacker: new Set([0]) });
  const nodes = buildBattleScene(baseInput({ state, humanSide: "attacker", moveRange: [{ q: 1, r: 0 }] }));
  const hexes = nodesOfKind<BattleHexNode>(nodes, "battleHex");
  const at = (q: number, r: number) => hexes.find((h) => h.q === q && h.r === r)!;

  assert.equal(at(2, 1).impassable, true);
  assert.equal(at(0, 0).impassable, false);

  assert.equal(at(1, 0).inMoveRange, true);
  assert.equal(at(0, 0).inMoveRange, false);

  assert.equal(at(0, 0).available, true, "the human's unacted, living combatant occupies (0,0)");
  assert.equal(at(1, 0).available, false);
});

test("available hexes are suppressed while the AI is acting, even with unacted living human platoons", () => {
  const human = makeCombatant({ side: "attacker", slotIndex: 0, position: { q: 0, r: 0 }, entries: [{ unitTypeId: "sword", count: 10 }] });
  const state = makeState({ attacker: [human], unactedAttacker: new Set([0]) });
  const nodes = buildBattleScene(baseInput({ state, humanSide: "attacker", aiActing: true }));
  const hexes = nodesOfKind<BattleHexNode>(nodes, "battleHex");
  assert.ok(hexes.every((h) => h.available === false));
});

test("battleHex world position and hexRadius resolve via axialToPixel(hexSize) plus the offset, matching manualBattleArena.ts's toCanvas()", () => {
  const nodes = buildBattleScene(baseInput({ hexSize: 30, offsetX: 15, offsetY: -7 }));
  const hexes = nodesOfKind<BattleHexNode>(nodes, "battleHex");
  const sample = hexes.find((h) => h.q === 2 && h.r === 1)!;
  const expected = axialToPixel(2, 1, 30);
  assert.deepEqual(sample.world, { x: expected.x + 15, y: expected.y - 7 });
  assert.equal(sample.hexRadius, 29);
});

test("attack target rings: one per attackTarget, at the target's raw (non-interpolated) position, radius hexSize*0.8", () => {
  const target = makeCombatant({ side: "defender", slotIndex: 1, position: { q: 3, r: 2 }, entries: [{ unitTypeId: "archer", count: 4 }] });
  const state = makeState({ defender: [target] });
  const nodes = buildBattleScene(
    baseInput({
      state,
      attackTargets: [target],
      hexSize: 40,
      // Even though moveAnim names this exact combatant, the ring must use
      // its raw position -- draw() rings attackTargets via toCanvas(t.
      // position), never renderPixelFor(t).
      moveAnim: { side: "defender", slotIndex: 1, path: [{ q: 3, r: 2 }, { q: 3, r: 1 }], startedAt: 0, durationMs: 1000 },
      nowMs: 500,
    }),
  );
  const rings = nodesOfKind<BattleAttackTargetRingNode>(nodes, "battleAttackTargetRing");
  assert.equal(rings.length, 1);
  assert.equal(rings[0].side, "defender");
  assert.equal(rings[0].slotIndex, 1);
  assert.deepEqual(rings[0].world, axialToPixel(3, 2, 40));
  assert.equal(rings[0].radius, 32);
});

test("battleCombatant: dead/retreated combatants are excluded; selected is gated on humanSide+selectedSlot; unitCount and hpRatio are computed from entries", () => {
  const alive = makeCombatant({
    side: "attacker",
    slotIndex: 0,
    position: { q: 0, r: 0 },
    entries: [{ unitTypeId: "sword", count: 6 }, { unitTypeId: "archer", count: 4 }],
  });
  const retreated = makeCombatant({ side: "attacker", slotIndex: 1, position: { q: 0, r: 1 }, entries: [{ unitTypeId: "sword", count: 5 }], retreated: true });
  const wipedOut = makeCombatant({ side: "attacker", slotIndex: 2, position: { q: 0, r: 2 }, entries: [{ unitTypeId: "sword", count: 0 }] });
  const enemy = makeCombatant({ side: "defender", slotIndex: 0, position: { q: 3, r: 0 }, entries: [{ unitTypeId: "archer", count: 3 }] });
  const damaged = makeCombatant({ side: "defender", slotIndex: 1, position: { q: 3, r: 1 }, entries: [{ unitTypeId: "archer", count: 3 }], maxHealth: 24 });

  const state = makeState({ attacker: [alive, retreated, wipedOut], defender: [enemy, damaged] });
  const nodes = buildBattleScene(baseInput({ state, humanSide: "attacker", selectedSlot: 0 }));
  const combatants = nodesOfKind<BattleCombatantNode>(nodes, "battleCombatant");
  assert.equal(combatants.length, 3, "retreated and wiped-out combatants are excluded");

  const aliveNode = combatants.find((c) => c.side === "attacker" && c.slotIndex === 0)!;
  assert.equal(aliveNode.selected, true);
  assert.equal(aliveNode.unitCount, 10);
  assert.equal(aliveNode.hpRatio, 1, "maxHealth defaults to totalHealth(entries), so a fresh platoon is always at 100%");

  const enemyNode = combatants.find((c) => c.side === "defender" && c.slotIndex === 0)!;
  assert.equal(enemyNode.selected, false, "selected is gated on side === humanSide, not just a matching slotIndex");

  const damagedNode = combatants.find((c) => c.side === "defender" && c.slotIndex === 1)!;
  const expectedRatio = totalHealth(damaged.entries, UNIT_TYPES) / 24;
  assert.equal(damagedNode.hpRatio, expectedRatio);
});

test("combatant markers are emitted attacker-array-then-defender-array, matching draw()'s fixed side loop regardless of who is human", () => {
  const attackerC = makeCombatant({ side: "attacker", slotIndex: 0, position: { q: 0, r: 0 }, entries: [{ unitTypeId: "sword", count: 1 }] });
  const defenderC = makeCombatant({ side: "defender", slotIndex: 0, position: { q: 3, r: 0 }, entries: [{ unitTypeId: "archer", count: 1 }] });
  const state = makeState({ attacker: [attackerC], defender: [defenderC] });

  const nodes = buildBattleScene(baseInput({ state, humanSide: "defender", aiSide: "attacker" }));
  const combatants = nodesOfKind<BattleCombatantNode>(nodes, "battleCombatant");
  assert.equal(combatants[0].side, "attacker");
  assert.equal(combatants[1].side, "defender");
});

test("battleCombatant world position interpolates along an active moveAnim path exactly like renderPixelFor()", () => {
  const mover = makeCombatant({ side: "attacker", slotIndex: 0, position: { q: 2, r: 0 }, entries: [{ unitTypeId: "sword", count: 5 }] });
  const path = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
  const state = makeState({ attacker: [mover] });
  const nodes = buildBattleScene(
    baseInput({
      state,
      hexSize: 32,
      moveAnim: { side: "attacker", slotIndex: 0, path, startedAt: 0, durationMs: 1000 },
      nowMs: 250,
    }),
  );
  const node = nodesOfKind<BattleCombatantNode>(nodes, "battleCombatant")[0];

  const a = axialToPixel(0, 0, 32);
  const b = axialToPixel(1, 0, 32);
  assert.deepEqual(node.world, { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 });
});

test("an expired moveAnim (nowMs past startedAt+durationMs) emits no battleMovePath node, and the combatant falls back to its raw position", () => {
  const mover = makeCombatant({ side: "attacker", slotIndex: 0, position: { q: 2, r: 0 }, entries: [{ unitTypeId: "sword", count: 5 }] });
  const state = makeState({ attacker: [mover] });
  const nodes = buildBattleScene(
    baseInput({
      state,
      hexSize: 32,
      moveAnim: { side: "attacker", slotIndex: 0, path: [{ q: 0, r: 0 }, { q: 2, r: 0 }], startedAt: 0, durationMs: 500 },
      nowMs: 500,
    }),
  );
  assert.equal(nodesOfKind(nodes, "battleMovePath").length, 0);
  const node = nodesOfKind<BattleCombatantNode>(nodes, "battleCombatant")[0];
  assert.deepEqual(node.world, axialToPixel(2, 0, 32), "falls back to the combatant's own engine position");
});

test("battleMovePath carries the resolved path points in order, tagged with the moving combatant's side/slotIndex", () => {
  const path = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }];
  const nodes = buildBattleScene(
    baseInput({ hexSize: 20, moveAnim: { side: "defender", slotIndex: 3, path, startedAt: 0, durationMs: 1000 }, nowMs: 0 }),
  );
  const [node] = nodesOfKind<BattleMovePathNode>(nodes, "battleMovePath");
  assert.equal(node.side, "defender");
  assert.equal(node.slotIndex, 3);
  assert.deepEqual(node.points, path.map((h) => axialToPixel(h.q, h.r, 20)));
});

test("impact ring radius grows and alpha fades with elapsed time, and disappears once IMPACT_MS has elapsed", () => {
  const early = buildBattleScene(baseInput({ hexSize: 40, impact: { hex: { q: 1, r: 1 }, startedAt: 0 }, nowMs: 0 }));
  const [earlyRing] = nodesOfKind<BattleImpactRingNode>(early, "battleImpactRing");
  assert.equal(earlyRing.radius, 40 * 0.5);
  assert.equal(earlyRing.alpha, 0.9);

  const mid = buildBattleScene(baseInput({ hexSize: 40, impact: { hex: { q: 1, r: 1 }, startedAt: 0 }, nowMs: 150 }));
  const [midRing] = nodesOfKind<BattleImpactRingNode>(mid, "battleImpactRing");
  const t = 150 / 300;
  assert.equal(midRing.radius, 40 * (0.5 + t * 0.55));
  assert.equal(midRing.alpha, (1 - t) * 0.9);

  const expired = buildBattleScene(baseInput({ impact: { hex: { q: 1, r: 1 }, startedAt: 0 }, nowMs: 300 }));
  assert.equal(nodesOfKind(expired, "battleImpactRing").length, 0);
});

test("floating text drifts upward and fades on the same schedule as draw(), and disappears once FLOAT_MS has elapsed", () => {
  const hex = { q: 0, r: 0 };
  const early = buildBattleScene(baseInput({ hexSize: 30, floats: [{ hex, text: "-3", startedAt: 0 }], nowMs: 0 }));
  const [earlyFloat] = nodesOfKind<BattleFloatingTextNode>(early, "battleFloatingText");
  const base = axialToPixel(0, 0, 30);
  assert.deepEqual(earlyFloat.world, { x: base.x, y: base.y - 30 * 0.7 });
  assert.equal(earlyFloat.alpha, 1);
  assert.equal(earlyFloat.text, "-3");

  const late = buildBattleScene(baseInput({ hexSize: 30, floats: [{ hex, text: "-3", startedAt: 0 }], nowMs: 680 }));
  const [lateFloat] = nodesOfKind<BattleFloatingTextNode>(late, "battleFloatingText");
  const t = 680 / 800;
  assert.equal(lateFloat.alpha, 1 - (t - 0.7) / 0.3);
  assert.deepEqual(lateFloat.world, { x: base.x, y: base.y - 30 * (0.7 + t * 0.9) });

  const expired = buildBattleScene(baseInput({ floats: [{ hex, text: "-3", startedAt: 0 }], nowMs: 800 }));
  assert.equal(nodesOfKind(expired, "battleFloatingText").length, 0);
});

test("the AI telegraph hex node appears only when aiTargetHex is set", () => {
  const withoutTarget = buildBattleScene(baseInput());
  assert.equal(nodesOfKind(withoutTarget, "battleAiTelegraphHex").length, 0);

  const nodes = buildBattleScene(baseInput({ hexSize: 25, aiTargetHex: { q: 1, r: 2 } }));
  const [node] = nodesOfKind<BattleAiTelegraphHexNode>(nodes, "battleAiTelegraphHex");
  assert.equal(node.q, 1);
  assert.equal(node.r, 2);
  assert.deepEqual(node.world, axialToPixel(1, 2, 25));
  assert.equal(node.hexRadius, 24);
});

test("the AI acting ring only appears for a living combatant, and uses the interpolated position when the actor is mid-move", () => {
  const dead = makeCombatant({ side: "defender", slotIndex: 0, position: { q: 0, r: 0 }, entries: [{ unitTypeId: "sword", count: 0 }] });
  const noneAlive = buildBattleScene(baseInput({ state: makeState({ defender: [dead] }), aiSide: "defender", aiActingSlot: 0 }));
  assert.equal(nodesOfKind(noneAlive, "battleAiActingRing").length, 0, "no ring for a dead/absent combatant");

  const acting = makeCombatant({ side: "defender", slotIndex: 2, position: { q: 3, r: 0 }, entries: [{ unitTypeId: "sword", count: 5 }] });
  const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }];
  const nodes = buildBattleScene(
    baseInput({
      state: makeState({ defender: [acting] }),
      aiSide: "defender",
      aiActingSlot: 2,
      hexSize: 32,
      moveAnim: { side: "defender", slotIndex: 2, path, startedAt: 0, durationMs: 1000 },
      nowMs: 500,
    }),
  );
  const [ring] = nodesOfKind<BattleAiActingRingNode>(nodes, "battleAiActingRing");
  assert.equal(ring.side, "defender");
  assert.equal(ring.slotIndex, 2);
  assert.equal(ring.radius, 32 * 0.78);

  const t = 0.5;
  const scaled = t * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(scaled));
  const localT = scaled - i;
  const a = axialToPixel(path[i].q, path[i].r, 32);
  const b = axialToPixel(path[i + 1].q, path[i + 1].r, 32);
  assert.deepEqual(ring.world, { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT });
});

test("nodes are emitted in draw()'s exact paint order when every overlay is present simultaneously", () => {
  const human = makeCombatant({ side: "attacker", slotIndex: 0, position: { q: 0, r: 0 }, entries: [{ unitTypeId: "sword", count: 5 }] });
  const enemy = makeCombatant({ side: "defender", slotIndex: 0, position: { q: 3, r: 0 }, entries: [{ unitTypeId: "archer", count: 5 }] });
  const state = makeState({ attacker: [human], defender: [enemy] });
  const nodes = buildBattleScene(
    baseInput({
      state,
      humanSide: "attacker",
      aiSide: "defender",
      attackTargets: [enemy],
      aiTargetHex: { q: 3, r: 0 },
      moveAnim: { side: "defender", slotIndex: 0, path: [{ q: 2, r: 0 }, { q: 3, r: 0 }], startedAt: 0, durationMs: 1000 },
      impact: { hex: { q: 2, r: 0 }, startedAt: 0 },
      aiActingSlot: 0,
      floats: [{ hex: { q: 0, r: 0 }, text: "-1", startedAt: 0 }],
      nowMs: 0,
    }),
  );
  const kindSequence = nodes.map((n) => n.kind);
  const firstIndexOf = (kind: string) => kindSequence.indexOf(kind);
  const lastIndexOf = (kind: string) => kindSequence.lastIndexOf(kind);

  assert.ok(lastIndexOf("battleHex") < firstIndexOf("battleAttackTargetRing"));
  assert.ok(lastIndexOf("battleAttackTargetRing") < firstIndexOf("battleAiTelegraphHex"));
  assert.ok(firstIndexOf("battleAiTelegraphHex") < firstIndexOf("battleMovePath"));
  assert.ok(firstIndexOf("battleMovePath") < firstIndexOf("battleImpactRing"));
  assert.ok(firstIndexOf("battleImpactRing") < firstIndexOf("battleAiActingRing"));
  assert.ok(firstIndexOf("battleAiActingRing") < firstIndexOf("battleCombatant"));
  assert.ok(lastIndexOf("battleCombatant") < firstIndexOf("battleFloatingText"));
});
