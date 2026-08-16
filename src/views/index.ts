// Side-effect barrel: imports each view module so its registerView(...) call
// fires at app startup. This keeps the viewLauncher registry fully populated
// before any launchView() call can fire, and avoids side-effect imports
// between view files (which would create cycles between
// settingsMenu <-> developerSettingsMenu <-> testBattleSetup <-> manualBattleArena).

import "./settingsMenu";
import "./developerSettingsMenu";
import "@screens/combat/testBattleSetup";
import "@screens/combat/manualBattleArena";
import "./homeView";
import "./assetManager";
import "@screens/settlements/cityView/cityView";
import "./developerSettingsMenu";
import "./heroInfoMenu";
import "./heroRosterMenu";
import "@screens/shared/hud";
import "@screens/shared/menu";
import "./newGameScreen";
import "./multiplayerLobby";
import "@screens/settlements/settlementInfoMenu";
import "@screens/settlements/settlementRosterMenu";
import "@screens/shared/toolbar";
