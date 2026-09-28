import { GameStateManager } from "./GameStateManager";
import { SessionManager } from "./SessionManager";
import { showBattleModal } from "@screens/combat/battleModal";
import { showBattleResultCard } from "@screens/combat/battleResultCard";
import { openManualBattleArena, type ManualBattleOutcome } from "@screens/combat/arena/openManualBattleArena";
import type { BattleActionPhase } from "@screens/combat/arena/state";
import { canEndTurn, cleanupDefeatedHeroCharters, endBattlePhase, platoonsHaveTroops, settlementStacks, spellLoadoutForHero, type BattleResult } from "@heroes/engine";
import type { GameState, HeroState } from "@heroes/contracts";
import { bus } from "../core/eventBus";
import { getInMemoryLocalPlayerId } from "../players/localPlayer";
import { catalogFailed, loadUnitCatalog } from "../data/unitCatalog";
import { submitBattleResult, submitSettlementBattleResult, type SubmitBattleResultResult, type SubmitSettlementBattleResultResult } from "../io/commands";
import { api } from "../io/api";

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

  /** Possibly start battle flow if in BATTLE or SETTLEMENT_BATTLE phase. */
  maybeAutoResolveBattle(): boolean {
    const gs = this.state.getState();
    if (this.battleInFlight) return false;
    if (gs.phase.kind === "BATTLE") {
      void this.startBattleFlow();
      return true;
    }
    if (gs.phase.kind === "SETTLEMENT_BATTLE") {
      void this.startSettlementBattleFlow();
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
      const attacker = gs.heroes[attackerId];
      const defender = gs.heroes[defenderId];
      if (!attacker || !defender) return;

      // Whose fight is this? The local seat's view decides the modal's Fight
      // button (the arena is a human-controlled surface) and which side the
      // human plays. attacker is always the mover (turnController.enterBattle
      // is only ever called with (mover, stationary)), so defender-owned-by-
      // local-seat is the "enemy moved onto me" case — the arena opens with
      // the human in the defender role and everything else works unchanged.
      const gameName = this.session.getActiveGameName();
      const localSeat = getInMemoryLocalPlayerId(gameName ?? "") ?? 0;
      const localIsAttacker = attacker.ownerId === localSeat;
      const localIsDefender = defender.ownerId === localSeat;

      // Hero-vs-hero collisions between two human players stay on the
      // auto-resolver (plan decision 1): a client only ever plays its OWN
      // hero's army in the arena, so a fight between two remote human seats
      // has no local side to hand the mouse to. Quick-resolve it silently —
      // the modal's Fight button would be a lie for both players.
      const defenderOwnerIsHuman =
        gs.players.find((p) => p.id === defender.ownerId)?.faction === "player";
      const pvp = !localIsAttacker && !localIsDefender ? true : !localIsAttacker && defenderOwnerIsHuman;

      let choice: "fight" | "quickResolve" | "cancel" = "quickResolve";
      if (!pvp) {
        choice = await showBattleModal({
          attackerName: `Hero ${attackerName}`,
          defenderName: `Hero ${defenderName}`,
        });
      }

      const tc = this.state.getTurnController();
      let battle: BattleResult | null = null;
      if (choice === "fight") {
        const fought = await this.fightInArena(gameName, attackerId, defenderId, localIsAttacker ? attacker : defender, localIsAttacker ? defender : attacker);
        if (fought.kind === "applied") {
          this.state.replaceState(fought.state);
          this.captureAfterBattleIfNeeded(attackerId);
          showBattleResultCard({
            result: fought.result,
            attackerLabel: `Hero ${attackerName}`,
            defenderLabel: `Hero ${defenderName}`,
            onCarryOn: fought.closeArena,
          });
          return;
        }
        if (fought.kind === "done") {
          // Submission failed and the pre-battle position was already
          // restored inside fightInArena (flee semantics), or the BATTLE
          // phase evaporated under a concurrent sync. Either way the flow is
          // over -- the one thing it must NOT do is auto-resolve a battle
          // the player just fought out by hand.
          return;
        }
        // "unavailable": the arena could not be opened at all (unit catalog
        // missing) -- fall through to the auto-resolver rather than leave
        // the modal's Fight promise unfulfilled. The catalog is fetched
        // once at startup and cached, so this is a defensive path.
        battle = await tc.resolveCurrentBattle();
      } else if (choice === "quickResolve") {
        battle = await tc.resolveCurrentBattle();
      } else {
        tc.cancelMove(attackerId);
      }
      this.state.replaceState(tc.getState());
      this.captureAfterBattleIfNeeded(attackerId);
      if (battle) {
        showBattleResultCard({
          result: battle,
          attackerLabel: `Hero ${attackerName}`,
          defenderLabel: `Hero ${defenderName}`,
          onCarryOn: () => {},
        });
      }
    } finally {
      this.battleInFlight = false;
    }
  }

  /**
   * Fight a BATTLE phase out in the manual arena (plan
   * 2026-09-27-manual-battle-wiring.md, work items 2+3). Opens the arena
   * with the two heroes' real armies and the local player in whichever role
   * their hero holds in the phase, waits for the played-out outcome, submits
   * it server-side (SubmitBattleResult), and merges the authoritative hero
   * pair back into client state before ending the BATTLE phase — mirroring
   * TurnController.resolveCurrentBattle()'s own post-server application, so
   * the Fight path ends the phase exactly like Quick Resolve does.
   *
   * "done" covers every path where the flow simply ends without an applied
   * result — a rejected/failed submission (restored to the pre-battle
   * position with flee semantics inside) or a phase that evaporated under a
   * concurrent sync. The caller must return, never auto-resolve.
   */
  private async fightInArena(
    gameName: string | null,
    attackerId: string,
    defenderId: string,
    humanHero: HeroState,
    enemyHero: HeroState,
  ): Promise<
    | { kind: "applied"; state: GameState; result: BattleResult; closeArena: () => void }
    | { kind: "done" }
    | { kind: "unavailable" }
  > {
    // The arena resolves unit stats from the server-backed catalog (same
    // source the auto-resolver uses server-side, via /api/units).
    const catalog = await loadUnitCatalog();
    if (catalogFailed() || catalog.length === 0) return { kind: "unavailable" };
    const unitTypes = Object.fromEntries(catalog.map((u) => [u.id, u]));

    // Live action stream (work item 4b): every applied arena action posts a
    // battle_actions row as it happens. Seq is assigned here, synchronously
    // at emit time (seed row = 0), so the per-battle replay order is exact
    // even though the POSTs themselves are fire-and-forget. Failures are
    // swallowed by api.postBattleAction and must never block the arena.
    let actionSeq = 0;
    const telemetry = gameName
      ? (phase: BattleActionPhase, payload: Record<string, unknown>) => {
          void api.postBattleAction(gameName, { attackerId, defenderId, seq: actionSeq++, phase, payload });
        }
      : undefined;

    let closeArena: () => void = () => {};
    const outcome: ManualBattleOutcome = await new Promise<ManualBattleOutcome>((resolve) => {
      const handle = openManualBattleArena(
        humanHero.stacks,
        enemyHero.stacks,
        unitTypes,
        humanHero.id === attackerId ? "attacker" : "defender",
        {
          heroGold: Number(humanHero.gold) || 0,
          // Spellcasting v1: the human hero's persistent mana/spell stats
          // (HeroState) become the arena loadout, exactly like heroGold.
          // The AI side never casts in v1 (locked decision), so only the
          // human's loadout is threaded.
          heroSpell: spellLoadoutForHero(humanHero),
          onComplete: resolve,
          telemetry,
        },
      );
      closeArena = handle.close;
    });

    // Re-grab the controller after the arena: a multiplayerSync poll may
    // have replaceState()'d underneath the overlay while the fight played
    // out, and the pre-battle tc reference would be stale.
    const tc = this.state.getTurnController();
    const current = tc.getState();
    if (current.phase.kind !== "BATTLE") return { kind: "done" };

    const server = await submitBattleResult(gameName ?? "", {
      actor: humanHero.ownerId,
      attackerId,
      defenderId,
      outcome: outcome.outcome,
      attackerStacks: outcome.attackerSurvivors,
      defenderStacks: outcome.defenderSurvivors,
      ...(outcome.surrenderedGold > 0 ? { surrenderedGold: outcome.surrenderedGold } : {}),
      rounds: outcome.result.rounds,
      obstacleSeed: outcome.result.obstacleSeed,
    }).catch((err: unknown): SubmitBattleResultResult | null => {
      // Server rejected or the request failed: no authoritative result to
      // apply. Restore the pre-battle position (same as Flee) so the game
      // is not stuck in the BATTLE phase, and surface the failure the same
      // way failed commands do.
      bus.emit({ type: "command:rejected", action: "SubmitBattleResult", reason: String(err) });
      tc.cancelMove(attackerId);
      this.state.replaceState(tc.getState());
      return null;
    });
    if (!server) return { kind: "done" };

    // Mirror resolveCurrentBattle()'s post-server application: authoritative
    // heroes in, charter cleanup for a wiped defender, then end the phase.
    // (The BATTLE phase itself never left client state — the arena played
    // out over it — so endBattlePhase() is what actually closes it.)
    let next = { ...current, heroes: { ...current.heroes, [attackerId]: server.attackerHero, [defenderId]: server.defenderHero } };
    const defenderAfter = next.heroes[defenderId];
    if (defenderAfter && !platoonsHaveTroops(defenderAfter.stacks) && defenderAfter.isChartering) {
      next = cleanupDefeatedHeroCharters(next, defenderId);
    }
    next = endBattlePhase(next);
    bus.emit({
      type: "battle:resolved",
      attackerId,
      defenderId,
      attackerSurvived: platoonsHaveTroops(server.attackerHero.stacks),
    });
    return { kind: "applied", state: next, result: outcome.result, closeArena };
  }

  /**
   * Fight a SETTLEMENT_BATTLE phase out in the manual arena
   * (plan/1790560842471-unit-recruitment-garrison-plan.md §9): the attacker
   * hero's platoons vs the garrison's, the human always in the attacker
   * role, the rails/log labeled "<Settlement name> Garrison" instead of a
   * defender hero. Submits via SubmitSettlementBattleResult; on success the
   * authoritative hero + settlement pair is merged, the phase is ended
   * client-side (the server's applySettlementBattleResult already captured
   * on a win / bounced the attacker on every other outcome), and the shared
   * result card closes the arena. Submission failure mirrors fightInArena:
   * the pre-battle position is restored with flee semantics and the flow
   * ends without an applied result.
   */
  private async startSettlementBattleFlow(): Promise<void> {
    const gs = this.state.getState();
    if (gs.phase.kind !== "SETTLEMENT_BATTLE" || this.battleInFlight) return;
    this.battleInFlight = true;
    try {
      const { attackerId, settlementId } = gs.phase;
      const attacker = gs.heroes[attackerId];
      const settlement = gs.settlements[settlementId];
      if (!attacker || !settlement) return;

      // The arena resolves unit stats from the server-backed catalog. If it
      // is unavailable there is nothing to fight with: bounce the attacker
      // (flee semantics) so the game is not stuck in the phase.
      const catalog = await loadUnitCatalog();
      if (catalogFailed() || catalog.length === 0) {
        const tc = this.state.getTurnController();
        tc.cancelMove(attackerId);
        this.state.replaceState(tc.getState());
        return;
      }
      const unitTypes = Object.fromEntries(catalog.map((u) => [u.id, u]));

      const gameName = this.session.getActiveGameName();
      const defenderLabel = `${settlement.name} Garrison`;
      // Live action stream: same fire-and-forget shape as the hero battle,
      // keyed attacker hero vs settlement (battle_actions only needs a
      // non-empty defender string).
      let actionSeq = 0;
      const telemetry = gameName
        ? (phase: BattleActionPhase, payload: Record<string, unknown>) => {
            void api.postBattleAction(gameName, { attackerId, defenderId: settlementId, seq: actionSeq++, phase, payload });
          }
        : undefined;

      let closeArena: () => void = () => {};
      const outcome: ManualBattleOutcome = await new Promise<ManualBattleOutcome>((resolve) => {
        const handle = openManualBattleArena(
          attacker.stacks,
          settlementStacks(settlement),
          unitTypes,
          "attacker",
          {
            heroGold: Number(attacker.gold) || 0,
            heroSpell: spellLoadoutForHero(attacker),
            onComplete: resolve,
            telemetry,
            defenderLabel,
          },
        );
        closeArena = handle.close;
      });

      // Re-grab the controller after the arena: a multiplayerSync poll may
      // have replaceState()'d underneath the overlay while the fight played
      // out. The phase must still be THIS attacker-vs-settlement pair.
      const tc = this.state.getTurnController();
      const current = tc.getState();
      const phase = current.phase;
      if (phase.kind !== "SETTLEMENT_BATTLE" || phase.attackerId !== attackerId || phase.settlementId !== settlementId) {
        return;
      }

      const server = await submitSettlementBattleResult(gameName ?? "", {
        actor: attacker.ownerId,
        attackerId,
        settlementId,
        outcome: outcome.outcome,
        attackerStacks: outcome.attackerSurvivors,
        defenderStacks: outcome.defenderSurvivors,
        ...(outcome.surrenderedGold > 0 ? { surrenderedGold: outcome.surrenderedGold } : {}),
        rounds: outcome.result.rounds,
        obstacleSeed: outcome.result.obstacleSeed,
      }).catch((err: unknown): SubmitSettlementBattleResultResult | null => {
        bus.emit({ type: "command:rejected", action: "SubmitSettlementBattleResult", reason: String(err) });
        tc.cancelMove(attackerId);
        this.state.replaceState(tc.getState());
        return null;
      });
      if (!server) return;

      const next = endBattlePhase({
        ...current,
        heroes: { ...current.heroes, [attackerId]: server.attackerHero },
        settlements: { ...current.settlements, [settlementId]: server.settlement },
      });
      this.state.replaceState(next);
      bus.emit({
        type: "battle:resolved",
        attackerId,
        defenderId: settlementId,
        attackerSurvived: platoonsHaveTroops(server.attackerHero.stacks),
      });
      showBattleResultCard({
        result: outcome.result,
        attackerLabel: `Hero ${attacker.name}`,
        defenderLabel,
        onCarryOn: closeArena,
      });
    } finally {
      this.battleInFlight = false;
    }
  }

  // Post-battle capture re-check (plan §9): after a hero-vs-hero battle the
  // attacker may now stand on an enemy settlement tile whose defending hero
  // is gone and whose garrison is empty — tryCaptureAt deferred entirely to
  // the battle in that case, so the capture check runs again here. Runs on
  // the CURRENT controller (state was already battle-applied and
  // replaceState'd); replaces state only when the check actually captured,
  // so the no-capture common case emits no redundant state:committed.
  private captureAfterBattleIfNeeded(heroId: string): void {
    const tc = this.state.getTurnController();
    const before = tc.getState();
    tc.captureAfterBattleIfNeeded(heroId);
    const after = tc.getState();
    if (after !== before) {
      this.state.replaceState(after);
    }
  }

  async handleEndTurn(): Promise<void> {
    const gs = this.state.getState();
    if (!canEndTurn(gs)) return;
    const tc = this.state.getTurnController();
    await tc.endHumanTurn();
    this.state.replaceState(tc.getState());
    this.session.setSaveStatus("saved");
    this.maybeAutoResolveBattle();
  }
}
