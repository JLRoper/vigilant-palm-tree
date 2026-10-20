// Side-effect barrel: imports each boot-critical view module so its
// registerView(...) call fires at app startup. This keeps the viewLauncher
// registry fully populated before any openView() call can fire, and avoids
// side-effect imports between view files (which would create cycles between
// settingsMenu <-> developerSettingsMenu <-> testBattleSetup <-> manualBattleArena).
// Deferred views (developerSettingsMenu, testBattleSetup, manualBattleArena,
// networkMap) do NOT load at startup: they are registered here as lazy loaders
// and await-loaded on first openView, which keeps the battle-arena chain out
// of the entry chunk while preserving the "a module registers itself at load"
// convention on both paths. (multiplayerLobby is loaded on demand by homeView.)

import { registerLazyView } from "@screens/shared/viewLauncher";

import "@screens/home/settingsMenu";
import "@screens/home/homeView";
import "@screens/home/assetManager";
import "@screens/heroes/heroInfoMenu";
import "@screens/heroes/heroRosterMenu";
import "@screens/shared/hud";
import "@screens/home/newGameScreen";
import "@screens/settlements/settlementInfoMenu";
import "@screens/settlements/settlementRosterMenu";
import "@screens/shared/toolbar";

registerLazyView("developerSettingsMenu", () => import("@screens/home/developerSettingsMenu"));
registerLazyView("testBattleSetup", () => import("@screens/combat/testBattleSetup"));
registerLazyView("manualBattleArena", () => import("@screens/combat/manualBattleArena"));
registerLazyView("networkMap", () => import("@screens/debug/networkMap"));
