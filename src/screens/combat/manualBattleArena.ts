// Compatibility shim — see src/screens/combat/arena/openManualBattleArena.ts
// for the real implementation. This file exists so the old import path
// (`@screens/combat/manualBattleArena`) keeps working: src/screens/index.ts
// imports this module for its `registerView` side-effect, and any future
// caller can still reach the orchestrator via the same name they always have.
// The registration itself stays here (not in the arena/ module) so the
// side-effect is gated behind this specific legacy import path.
import { registerView } from "@screens/shared/viewLauncher";
import type { BattleSide } from "@heroes/engine";
import type { Platoon, UnitType } from "../../state/units";
import { openManualBattleArena } from "./arena/openManualBattleArena";

registerView("manualBattleArena", (opts) => {
  const o = opts as { playerPlatoons: Platoon[]; aiPlatoons: Platoon[]; unitTypes: Record<string, UnitType>; humanSide: BattleSide };
  openManualBattleArena(o.playerPlatoons, o.aiPlatoons, o.unitTypes, o.humanSide);
});

export { openManualBattleArena } from "./arena/openManualBattleArena";