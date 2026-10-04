import { GameStateManager } from "./GameStateManager";
import { SessionManager } from "./SessionManager";
import { showBattleModal } from "@screens/combat/battleModal";
import { showBattleResultCard } from "@screens/combat/battleResultCard";
import { shouldShowResultCard } from "@screens/combat/resultCardPolicy";
import { showToast } from "@screens/shared/toast";
import { openManualBattleArena, type ManualBattleOutcome } from "@screens/combat/arena/openManualBattleArena";
import type { BattleActionPhase } from "@screens/combat/arena/state";
import { canEndTurn, cleanupDefeatedHeroCharters, endBattlePhase, platoonsHaveTroops, settlementStacks, spellLoadoutForHero, type BattleResult } from "@heroes/engine";
import type { GameState, HeroBattleVerdict, HeroState } from "@heroes/contracts";
import { bus } from "../core/eventBus";
import { getInMemoryLocalPlayerId } from "../players/localPlayer";
import { catalogFailed, cachedUnitTypes, loadUnitCatalog } from "../data/unitCatalog";
import type { UnitType } from "../state/units";
import { submitBattleResult, submitSettlementBattleResult, type SubmitBattleResultResult, type SubmitSettlementBattleResultResult } from "../io/commands";
import { consumeResolveBattleVerdicts, mergeBattleOutcomeHero, mergeBattleOutcomeHeroes } from "../game/turnHooks";
import { battleToastMessage, settlementNameAt } from "@screens/combat/battleResultText";
import {
  evaluateUpkeepWarnings,
  upkeepSummaryToastMessage,
  upkeepToastMessage,
  UPKEEP_SUMMARY_OFFENDER_LIMIT,
} from "@screens/shared/upkeepWarnings";
import {
  applyTreasuryCapSessionDedupe,
  newlyCappedSettlements,
  treasuryCapSummaryToastMessage,
  treasuryCapToastMessage,
  TREASURY_CAP_SUMMARY_OFFENDER_LIMIT,
} from "@screens/settlements/treasuryCap";
import { evaluateTradeReminder } from "@screens/shared/tradeNeedsReminder";
import {
  formatStacksLabel,
  openAssaultConfirmModal,
  type AssaultConfirmChoice,
} from "@screens/combat/assaultConfirmModal";
import { api } from "../io/api";

// Settlement name for a relocated hero's verdict line ("retreated to <name>").
// Only retreat/surrender relocate (hero present post-merge); defeat leaves no
// hero to look up and "stood" renders no line.
function verdictSettlementName(
  state: GameState,
  heroId: string,
  verdict: HeroBattleVerdict | undefined,
): string | undefined {
  if (!verdict || verdict === "stood" || verdict === "defeated") return undefined;
  const hero = state.heroes[heroId];
  return hero ? settlementNameAt(state.settlements, hero.q, hero.r) : undefined;
}

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
      // The arena is a human-controlled surface, so it only fits a battle
      // the local seat fights. An AI attacker's settlement battle exists
      // only on the primary client (the SETTLEMENT_BATTLE phase is
      // client-local and only the primary browser runs the AI tick); it
      // resolves silently there and surfaces a card/toast.
      const attacker = gs.heroes[gs.phase.attackerId];
      const gameName = this.session.getActiveGameName();
      const localSeat = getInMemoryLocalPlayerId(gameName ?? "") ?? 0;
      if (attacker && attacker.ownerId === localSeat) {
        void this.startSettlementBattleFlow();
      } else {
        void this.autoResolveSettlementBattle(gs.phase.attackerId, gs.phase.settlementId);
      }
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
            attackerVerdict: fought.attackerVerdict,
            defenderVerdict: fought.defenderVerdict,
            attackerSettlementName: fought.attackerSettlementName,
            defenderSettlementName: fought.defenderSettlementName,
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
        const verdicts = consumeResolveBattleVerdicts();
        const after = this.state.getState();
        // D4 display policy (plan/2026-09-29-ai-enemies.md): a result card
        // only when the local human's hero was attacker or defender;
        // AI-vs-AI (and remote-human-vs-remote-human) auto-resolves are
        // silent -- one info toast, max. Stacked un-clicked cards were the
        // symptom; suppression is the policy-level fix.
        if (shouldShowResultCard(localSeat, attacker.ownerId, defender.ownerId)) {
          showBattleResultCard({
            result: battle,
            attackerLabel: `Hero ${attackerName}`,
            defenderLabel: `Hero ${defenderName}`,
            onCarryOn: () => {},
            attackerVerdict: verdicts.attackerVerdict,
            defenderVerdict: verdicts.defenderVerdict,
            attackerSettlementName: verdictSettlementName(after, attackerId, verdicts.attackerVerdict),
            defenderSettlementName: verdictSettlementName(after, defenderId, verdicts.defenderVerdict),
          });
        } else {
          const attackerPlayer = gs.players.find((p) => p.id === attacker.ownerId);
          const defenderPlayer = gs.players.find((p) => p.id === defender.ownerId);
          const attackerSide = `${attackerPlayer?.name ?? "AI"}'s ${attacker.name}`;
          const defenderSide = `${defenderPlayer?.name ?? "AI"}'s ${defender.name}`;
          showToast(
            battleToastMessage({
              attackerLabel: attackerSide,
              defenderLabel: defenderSide,
              winner: battle.winner,
              attacker: {
                verdict: verdicts.attackerVerdict,
                ownerName: attackerPlayer?.name,
                settlementName: verdictSettlementName(after, attackerId, verdicts.attackerVerdict),
              },
              defender: {
                verdict: verdicts.defenderVerdict,
                ownerName: defenderPlayer?.name,
                settlementName: verdictSettlementName(after, defenderId, verdicts.defenderVerdict),
              },
            }),
            "info",
          );
        }
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
    | {
        kind: "applied";
        state: GameState;
        result: BattleResult;
        closeArena: () => void;
        attackerVerdict?: HeroBattleVerdict;
        defenderVerdict?: HeroBattleVerdict;
        attackerSettlementName?: string;
        defenderSettlementName?: string;
      }
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
    // heroes in (absent = defeated → removed locally, heroIds pruned,
    // selection cleared), charter cleanup for a wiped defender, then end the
    // phase. (The BATTLE phase itself never left client state — the arena
    // played out over it — so endBattlePhase() is what actually closes it.)
    let next = mergeBattleOutcomeHeroes(current, attackerId, defenderId, server);
    const defenderAfter = next.heroes[defenderId];
    if (defenderAfter && !platoonsHaveTroops(defenderAfter.stacks) && defenderAfter.isChartering) {
      next = cleanupDefeatedHeroCharters(next, defenderId);
    }
    next = endBattlePhase(next);
    const attackerAfter = next.heroes[attackerId];
    bus.emit({
      type: "battle:resolved",
      attackerId,
      defenderId,
      attackerSurvived: attackerAfter ? platoonsHaveTroops(attackerAfter.stacks) : false,
    });
    return {
      kind: "applied",
      state: next,
      result: outcome.result,
      closeArena,
      attackerVerdict: server.attackerVerdict,
      defenderVerdict: server.defenderVerdict,
      attackerSettlementName: verdictSettlementName(next, attackerId, server.attackerVerdict),
      defenderSettlementName: verdictSettlementName(next, defenderId, server.defenderVerdict),
    };
  }

  /**
   * Silent auto-resolve of a SETTLEMENT_BATTLE whose attacker is not the
   * local human seat (an AI attacker on the primary client). The controller
   * runs the engine auto-resolver, applies and POSTs the result; the D4
   * display policy then decides card vs toast exactly like the hero-battle
   * quick-resolve path -- a card when the local human owned the attacker or
   * the defending settlement, a one-line info toast otherwise.
   */
  private async autoResolveSettlementBattle(attackerId: string, settlementId: string): Promise<void> {
    this.battleInFlight = true;
    try {
      const gs = this.state.getState();
      const attackerBefore = gs.heroes[attackerId];
      const settlementBefore = gs.settlements[settlementId];
      if (!attackerBefore || !settlementBefore) return;
      const gameName = this.session.getActiveGameName();
      const localSeat = getInMemoryLocalPlayerId(gameName ?? "") ?? 0;
      const attackerPlayer = gs.players.find((p) => p.id === attackerBefore.ownerId);
      const defenderLabel = `${settlementBefore.name} Garrison`;
      const catalog = await loadUnitCatalog();
      const unitTypes: Record<string, UnitType> | null =
        catalogFailed() || catalog.length === 0 ? null : Object.fromEntries(catalog.map((u) => [u.id, u]));
      const tc = this.state.getTurnController();
      const outcome = await tc.resolveSettlementBattle(unitTypes);
      this.state.replaceState(tc.getState());
      if (!outcome) return;
      const after = this.state.getState();
      // A neutral settlement has no owner seat, so it can never involve the
      // local human: -1 matches no seat in the display policy.
      if (shouldShowResultCard(localSeat, attackerBefore.ownerId, settlementBefore.ownerId ?? -1)) {
        showBattleResultCard({
          result: outcome.battle,
          attackerLabel: `Hero ${attackerBefore.name}`,
          defenderLabel,
          onCarryOn: () => {},
          attackerVerdict: outcome.attackerVerdict,
          attackerSettlementName: verdictSettlementName(after, attackerId, outcome.attackerVerdict),
        });
      } else {
        showToast(
          battleToastMessage({
            attackerLabel: `${attackerPlayer?.name ?? "AI"}'s ${attackerBefore.name}`,
            defenderLabel,
            winner: outcome.battle.winner,
            attacker: {
              verdict: outcome.attackerVerdict,
              ownerName: attackerPlayer?.name,
              settlementName: verdictSettlementName(after, attackerId, outcome.attackerVerdict),
            },
          }),
          "info",
        );
      }
    } finally {
      this.battleInFlight = false;
    }
  }

  /**
   * Fight a SETTLEMENT_BATTLE phase out in the manual arena
   * (plan/1790560842471-unit-recruitment-garrison-plan.md §9): the attacker
   * hero's platoons vs the garrison's, the human always in the attacker
   * role, the rails/log labeled "<Settlement name> Garrison" instead of a
   * defender hero. An assault-confirm modal (B5) runs first: Assault enters
   * this arena, Auto-resolve delegates to autoResolveSettlementBattle(),
   * Cancel ends the phase via TurnController.cancelSettlementBattle() with
   * the hero still on the settlement tile and nothing resolved. Submits via
   * SubmitSettlementBattleResult; on success the
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

      // B5 assault confirm: the local-human attacker confirms before the
      // arena. Assault continues into the arena flow below unchanged;
      // Auto-resolve takes the same silent controller path an AI attacker
      // gets; Cancel ends the phase with the hero standing on the
      // settlement tile (the walk-in move is already persisted, the
      // garrison is untouched, nothing is submitted) — a later
      // re-selection of the hero re-runs tryCaptureAt and re-opens this
      // flow.
      const unitNames: Record<string, string> = {};
      for (const u of catalog) unitNames[u.id] = u.name;
      const choice = await new Promise<AssaultConfirmChoice>((resolve) => {
        openAssaultConfirmModal({
          settlementName: settlement.name,
          attackerSummary: formatStacksLabel(attacker.stacks, unitNames),
          garrisonSummary: formatStacksLabel(settlementStacks(settlement), unitNames),
          onAssault: () => resolve("assault"),
          onAutoResolve: () => resolve("autoResolve"),
          onCancel: () => resolve("cancel"),
        });
      });
      if (choice === "cancel") {
        const tc = this.state.getTurnController();
        if (tc.cancelSettlementBattle()) {
          this.state.replaceState(tc.getState());
        }
        return;
      }
      if (choice === "autoResolve") {
        await this.autoResolveSettlementBattle(attackerId, settlementId);
        return;
      }

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
            title: `Assault on ${settlement.name}`,
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

      // Mirror the hero-battle outcome rules (2026-09-29 hero outcomes): a
      // defeated attacker is absent from the result — drop their outstanding
      // charter while the row is still readable, then remove the hero
      // locally (heroIds prune + selection clear via the shared merge);
      // retreat/surrender come back already relocated server-side and merge
      // as a plain row replace.
      let next = current;
      if (!server.attackerHero) next = cleanupDefeatedHeroCharters(next, attackerId);
      next = mergeBattleOutcomeHero(next, attackerId, server.attackerHero);
      next = endBattlePhase({
        ...next,
        settlements: { ...next.settlements, [settlementId]: server.settlement },
      });
      this.state.replaceState(next);
      bus.emit({
        type: "battle:resolved",
        attackerId,
        defenderId: settlementId,
        attackerSurvived: platoonsHaveTroops(server.attackerHero?.stacks ?? []),
      });
      showBattleResultCard({
        result: outcome.result,
        attackerLabel: `Hero ${attacker.name}`,
        defenderLabel,
        onCarryOn: closeArena,
        attackerVerdict: server.attackerVerdict,
        attackerSettlementName: verdictSettlementName(next, attackerId, server.attackerVerdict),
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
    this.reportUnpaidUpkeep();
    this.reportTreasuryCaps(gs);
    this.remindTradeRoutes();
    this.session.setSaveStatus("saved");
    this.maybeAutoResolveBattle();
  }

  // A full treasury throws away the settlement's entire gold income with
  // nothing on screen saying why, so the player watches an income rate pay
  // nothing. Fires on the TRANSITION into the cap, not on every turn spent
  // there, which is the whole reason the pre-EndTurn state is threaded through
  // as `previous`: it is the record of what was already capped, recomputed from
  // the game on every turn. On top of that sits the per-session dedupe
  // (E1a): a capped treasury that oscillates below cap and back (weekly route
  // upkeep, a bank deposit) would re-cross the transition every cycle, so
  // each settlement toasts once per session while it stays capped and only
  // re-arms once it is observed below cap. Both layers are in-memory only, so
  // there is no "already warned" state to reset on game load -- a reload's
  // fresh page re-toasts once, which is the honest reading after a reload.
  // `previous` is stale-by-construction
  // safe: the reducers replace the state object (see endCurrentTurn's own
  // stateBeforeEnd reference check), so it still reads the pre-turn values.
  private reportTreasuryCaps(previous: GameState): void {
    const merged = this.state.getState();
    const gameName = this.session.getActiveGameName();
    const seat = getInMemoryLocalPlayerId(gameName ?? "") ?? 0;
    const rows = applyTreasuryCapSessionDedupe(
      gameName,
      merged,
      seat,
      newlyCappedSettlements(previous, merged, seat),
    );
    if (rows.length === 0) return;
    if (rows.length > TREASURY_CAP_SUMMARY_OFFENDER_LIMIT) {
      showToast(treasuryCapSummaryToastMessage(rows), "info");
      return;
    }
    for (const row of rows) {
      showToast(treasuryCapToastMessage(row), "info");
    }
  }

  // Phase 5 trade-route reminder: recommendations exist and the player has
  // ZERO configured routes -> one summary toast. TOAST ONLY (see the
  // module's header for why a blocking surface is categorically off the
  // table), deduped once per session per distinct recommendation inside the
  // pure module. Reads the post-EndTurn merged state, like
  // reportUnpaidUpkeep.
  private remindTradeRoutes(): void {
    const merged = this.state.getState();
    const gameName = this.session.getActiveGameName();
    const seat = getInMemoryLocalPlayerId(gameName ?? "");
    const message = evaluateTradeReminder(merged, seat, cachedUnitTypes());
    if (message) showToast(message, "info");
  }

  // Unpaid upkeep is otherwise invisible: consumption clamps at zero, morale
  // decays, and troops desert with nothing on screen saying why. Runs on the
  // post-EndTurn merged state (the weekly upkeep pass has already applied, so
  // days/weeks-unpaid are current) and stays inside the toast surface — a modal
  // was rejected for this because it can wedge the turn UI.
  private reportUnpaidUpkeep(): void {
    const merged = this.state.getState();
    const gameName = this.session.getActiveGameName();
    const seat = getInMemoryLocalPlayerId(gameName ?? "") ?? 0;
    const rows = evaluateUpkeepWarnings(merged, seat);
    if (rows.length === 0) return;
    if (rows.length > UPKEEP_SUMMARY_OFFENDER_LIMIT) {
      showToast(upkeepSummaryToastMessage(rows), "error");
      return;
    }
    for (const row of rows) {
      showToast(upkeepToastMessage(row), "error");
    }
  }
}
