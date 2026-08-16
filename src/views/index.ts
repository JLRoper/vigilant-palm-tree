// Side-effect barrel: imports each view module so its registerView(...) call
// fires at app startup. This keeps the viewLauncher registry fully populated
// before any launchView() call can fire, and avoids side-effect imports
// between view files (which would create cycles between
// settingsMenu <-> developerSettingsMenu <-> testBattleSetup <-> manualBattleArena).

import "./settingsMenu";
import "./developerSettingsMenu";
import "./testBattleSetup";
import "./manualBattleArena";
import "./homeView";
import "./assetManager";
import "./cityView";
import "./developerSettingsMenu";
import "./heroInfoMenu";
import "./heroRosterMenu";
import "./hud";
import "./menu";
import "./newGameScreen";
import "./multiplayerLobby";
import "./settlementInfoMenu";
import "./settlementRosterMenu";
import "./toolbar";
