// Thin delegation: the provisioning evaluator moved into @heroes/engine
// (packages/engine/src/charter/requirements.ts) so the driver-side AI planner,
// the server-side gate, and this UI share one implementation. The public API
// is unchanged.
import type { GameState, HeroId } from "@heroes/contracts";
import {
  evaluateCharterRequirements as evaluateEngineCharterRequirements,
  type CharterRequirementRow,
  type CharterRequirements,
  CHARTER_PURSE_HINT,
} from "@heroes/engine";

export { CHARTER_PURSE_HINT };
export type { CharterRequirementRow, CharterRequirements };

export function evaluateCharterRequirements(state: GameState, heroId: HeroId | null): CharterRequirements {
  return evaluateEngineCharterRequirements(state, heroId);
}
