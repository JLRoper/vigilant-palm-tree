import type { BattleSide } from "@heroes/engine";

// Arena side conventions. The engine's attacker/defender roles keep their
// grid colors (attacker blue, defender red) and the battle painter mirrors
// the defender's sprites (art is authored facing right once), so deployment
// is fixed by convention rather than by who controls whom: the attacker
// always takes the grid's left column and the defender the right — even
// when the human plays defender and the AI jumped them.
export interface ArenaSidePlan {
  /** Which engine role the AI plays — always the one the human does not. */
  aiSide: BattleSide;
  /** True when the human's platoons are the engine's attacker. */
  humanPlatoonsAreAttacker: boolean;
  /** Engine `sideChoice`: the role that deploys on the left column. */
  leftColumnSide: BattleSide;
}

export function planArenaSides(humanSide: BattleSide): ArenaSidePlan {
  return {
    aiSide: humanSide === "attacker" ? "defender" : "attacker",
    humanPlatoonsAreAttacker: humanSide === "attacker",
    leftColumnSide: "attacker",
  };
}
