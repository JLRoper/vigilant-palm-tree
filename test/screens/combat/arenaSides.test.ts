import { test } from "node:test";
import assert from "node:assert/strict";
import { startManualBattle } from "@heroes/engine";
import { planArenaSides } from "../../../src/screens/combat/arena/sides";
import { axialToPixel } from "../../../src/core/hex";
import type { Platoon, UnitType } from "../../../src/state/units";

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
};

test("planArenaSides: attacker-side human keeps attacker-left convention", () => {
  const plan = planArenaSides("attacker");
  assert.equal(plan.aiSide, "defender");
  assert.equal(plan.humanPlatoonsAreAttacker, true);
  assert.equal(plan.leftColumnSide, "attacker");
});

test("planArenaSides: defender-side human still deploys the attacker on the left", () => {
  const plan = planArenaSides("defender");
  assert.equal(plan.aiSide, "attacker");
  assert.equal(plan.humanPlatoonsAreAttacker, false);
  // Regression pin: the bug passed the human's role (here "defender") as the
  // engine's sideChoice, which deployed the defender on the left column.
  assert.equal(plan.leftColumnSide, "attacker");
});

test("defender-controlled battle: attacker platoons deploy strictly left of defender platoons", () => {
  const humanSide = "defender" as const;
  const plan = planArenaSides(humanSide);
  const playerPlatoons: Platoon[] = [
    { entries: [{ unitTypeId: "footman", count: 5 }] },
    { entries: [{ unitTypeId: "footman", count: 4 }] },
    { entries: [{ unitTypeId: "footman", count: 3 }] },
  ];
  const aiPlatoons: Platoon[] = [
    { entries: [{ unitTypeId: "footman", count: 6 }] },
    { entries: [{ unitTypeId: "footman", count: 2 }] },
    { entries: [{ unitTypeId: "footman", count: 2 }] },
  ];
  // Exactly the mapping openManualBattleArena uses: the human's platoons take
  // the defender role when the human is the one being attacked.
  const attackerPlatoons = plan.humanPlatoonsAreAttacker ? playerPlatoons : aiPlatoons;
  const defenderPlatoons = plan.humanPlatoonsAreAttacker ? aiPlatoons : playerPlatoons;
  const state = startManualBattle(attackerPlatoons, defenderPlatoons, {
    unitTypes,
    obstacleSeed: 1,
    grid: { cols: 5, rows: 5 },
    sideChoice: plan.leftColumnSide,
  });

  const attackerXs = state.attacker.map((c) => axialToPixel(c.position.q, c.position.r, 1).x);
  const defenderXs = state.defender.map((c) => axialToPixel(c.position.q, c.position.r, 1).x);
  assert.ok(attackerXs.length > 0, "attacker side must have combatants");
  assert.ok(defenderXs.length > 0, "defender side must have combatants");
  for (const ax of attackerXs) {
    for (const dx of defenderXs) {
      assert.ok(
        ax < dx,
        `attacker pixel x (${ax}) must be strictly left of defender pixel x (${dx})`,
      );
    }
  }
});
