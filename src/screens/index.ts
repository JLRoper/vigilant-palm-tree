// Side-effect barrel: imports each view module so its registerView(...) call
// fires at app startup. This keeps the viewLauncher registry fully populated
// before any launchView() call can fire, and avoids side-effect imports
// between view files (which would create cycles between
// settingsMenu <-> developerSettingsMenu <-> testBattleSetup <-> manualBattleArena).

import "@screens/home/settingsMenu";
import "@screens/home/developerSettingsMenu";
import "@screens/combat/testBattleSetup";
import "@screens/combat/manualBattleArena";
import "@screens/home/homeView";
import "@screens/home/assetManager";
import "@screens/settlements/cityView/cityView";
import "@screens/home/developerSettingsMenu";
import "@screens/heroes/heroInfoMenu";
import "@screens/heroes/heroRosterMenu";
import "@screens/shared/hud";
import "@screens/shared/menu";
import "@screens/home/newGameScreen";
import "@screens/multiplayer/multiplayerLobby";
import "@screens/settlements/settlementInfoMenu";
import "@screens/settlements/settlementRosterMenu";
import "@screens/shared/toolbar";
import "@screens/debug/networkMap";
