import { GameStateManager } from "./GameStateManager";
import { SessionManager } from "./SessionManager";
import { showBattleModal } from "../views/battleModal";

/**
 * Handles game-flow actions: end turn, manual save, battle resolution.
 * Each method orchestrates state + session + UI in a self-contained unit.
 */
export class GameActions {
  private battleInFlight = false;

  constructor(
    private state: GameStateManager,
    private session: SessionManager,
  ) {}

  /** Re-sync visuals from TurnController and trigger battle if needed. */
  syncFromController(onChanged: () => void): void {
    this.state.syncHeroVisualsToState();
    this.state.rebuildSettlementsFromState();
    onChanged();
  }

  /** Possibly start battle flow if in BATTLE phase. */
  maybeAutoResolveBattle(): boolean {
    const gs = this.state.getState();
    if (gs.phase.kind === "BATTLE" && !this.battleInFlight) {
      void this.startBattleFlow();
      return true;
    }
    return false;
  }

  async startBattleFlow(): Promise<void> {
    const gs = this.state.getState();
    if (gs.phase.kind !== "BATTLE" || this.battleInFlight) return;
    this.battleInFlight = true;
    try {
      const { attackerId, defenderId } = gs.phase;
      const attackerName = this.state.getHero(attackerId)?.id ?? attackerId;
      const defenderName = this.state.getHero(defenderId)?.id ?? defenderId;
      const result = await showBattleModal({
        attackerName: `Hero ${attackerName}`,
        defenderName: `Hero ${defenderName}`,
      });
      const tc = this.state.getTurnController();
      if (result === "resolve") {
        await tc.resolveCurrentBattle();
      } else {
        tc.cancelMove(attackerId);
      }
      this.state.replaceState(tc.getState());
    } finally {
      this.battleInFlight = false;
    }
  }

  async handleEndTurn(): Promise<void> {
    const gs = this.state.getState();
    const phase = gs.phase;
    if (phase.kind !== "PLAYER_TURN") return;
    if (gs.players.find((p) => p.id === phase.playerId)?.faction !== "player") return;
    const tc = this.state.getTurnController();
    await tc.endHumanTurn();
    this.state.replaceState(tc.getState());
    this.session.setSaveStatus("saved");
    this.maybeAutoResolveBattle();
  }
}
