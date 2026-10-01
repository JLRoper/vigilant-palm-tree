// Event-derived battle verdict feedback (B6/D6, server-side AI actor plan
// Phase 2 -- closes the D5 silent-defender window). On a SERVER-DRIVEN
// (flagged) game the AI driver resolves battles server-side, so no browser
// ever sees the command response that used to carry the verdict: the only
// signal is the game_events row, fanned out as `mp:battleOutcome` by
// multiplayerSync. This consumer turns that event into the simplified
// verdict result card (winner banner + per-side verdict lines, NO casualty
// tables) when the local seat was involved, and an info toast otherwise.
//
// Unflagged games are ignored entirely -- the direct-response paths
// (GameActions' arena cards/toasts) keep owning their UX byte-identically.
// Own-seat rows are skipped here too: a flagged human attacker's own battle
// already showed the arena card via the direct response, so the event copy
// would double-render.
//
// Explicit-attach from GameEngine.initEventListeners (the toast.ts /
// mpPresenceHint convention). Rendering is deferred to the next
// mp:resynced for the game -- both battle kinds are resync-answered, and
// post-resync state is what makes "retreated to <name>" resolvable
// (settlementNameAt on the relocated hero's hex). A fallback timer renders
// from current state if the resync never lands.

import type { GameState, HeroBattleVerdict } from "@heroes/contracts";
import { bus } from "../../core/eventBus";
import type {
  BattleOutcomeEventPayload,
  BattleOutcomeKind,
  MpBattleOutcomeEvent,
} from "../../core/events";
import { isServerDriven } from "../../io/serverDrivenGames";
import { openCenteredModal, styleButton } from "@screens/shared/menu";
import { showToast } from "@screens/shared/toast";
import {
  battleToastMessage,
  battleVerdictCardLine,
  heroBattleDrawBanner,
  settlementBattleCardBanner,
  settlementBattleToastMessage,
  settlementNameAt,
  type SettlementBattleOutcomeView,
} from "./battleResultText";

export interface BattleOutcomeFeedbackDeps {
  getState(): GameState | null;
  getGameName(): string | null;
  getLocalSeat(): number | null;
  /** Dedupe window for repeat battle identities (re-delivery backstop). */
  identityWindowMs?: number;
  /** How long to wait for the rendering resync before falling back. */
  renderFallbackMs?: number;
  /** Test seam: card/toast render overrides (no DOM under node:test). */
  render?: {
    card(model: BattleOutcomeCardModel): void;
    toast(message: string): void;
  };
}

type HeroBattlePayload = Extract<BattleOutcomeEventPayload, { type: "BattleResolved" }>;
type SettlementBattlePayload = Extract<BattleOutcomeEventPayload, { type: "SettlementBattleResolved" }>;

export interface BattleOutcomeSideView {
  heroId: string;
  label: string;
  ownerName?: string;
  verdict?: HeroBattleVerdict;
}

export type PendingBattleOutcome =
  | {
      family: "hero";
      gameName: string;
      card: boolean;
      winner: "attacker" | "defender" | "draw";
      attacker: BattleOutcomeSideView;
      defender: BattleOutcomeSideView;
    }
  | {
      family: "settlement";
      gameName: string;
      card: boolean;
      outcome: SettlementBattleOutcomeView;
      captured: boolean;
      settlementName?: string;
      attacker: BattleOutcomeSideView;
    };

interface TrackedOutcome {
  pending: PendingBattleOutcome;
  timer: ReturnType<typeof setTimeout>;
}

// A server-driven AI game fires a battle the local seat is involved in every
// few turns, and each one rendered a card only its own "Carry On" button could
// close. On the full-viewport z-300 wrapper that wedged the client: the card
// was still up when the player reached for End Turn, the click landed on the
// overlay, and the toolbar went dead with no error and no network request. The
// card is a notification, not a decision, so it also takes a backdrop click
// and Escape (opt-in on openCenteredModal), plus this bounded timer so it
// cannot outlive its usefulness even when none of those are used.
export const VERDICT_CARD_AUTO_DISMISS_MS = 8_000;

export interface VerdictCardDismissTimers {
  schedule: (fn: () => void, ms: number) => number;
  cancel: (handle: number) => void;
}

/**
 * The verdict card's bounded auto-dismiss. Returns the two operations the
 * renderer needs: `start` (arm it) and `cancel` (any earlier dismissal --
 * Carry On, backdrop, Escape -- must cancel it, or the timer would fire a
 * second close on an already-removed card). The timer seams are injectable so
 * the whole thing is unit-testable without a DOM.
 */
export function createVerdictCardAutoDismiss(
  close: () => void,
  timers?: Partial<VerdictCardDismissTimers>,
  autoDismissMs: number = VERDICT_CARD_AUTO_DISMISS_MS,
): { start: () => number; cancel: () => void } {
  const schedule = timers?.schedule ?? ((fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number);
  const cancelTimer = timers?.cancel ?? ((handle: number) => globalThis.clearTimeout(handle));
  let handle: number | null = null;
  return {
    start: () => {
      if (handle !== null) cancelTimer(handle);
      handle = schedule(() => {
        handle = null;
        close();
      }, autoDismissMs);
      return handle;
    },
    cancel: () => {
      if (handle !== null) cancelTimer(handle);
      handle = null;
    },
  };
}

export interface BattleOutcomeCardModel {
  family: "hero" | "settlement";
  banner: string;
  lines: Array<{ text: string; defeated: boolean }>;
}

const MAX_SEEN_IDS = 512;
const DEFAULT_IDENTITY_WINDOW_MS = 10_000;
const DEFAULT_RENDER_FALLBACK_MS = 10_000;

function isHeroPayload(payload: BattleOutcomeEventPayload): payload is HeroBattlePayload {
  return payload.type === "BattleResolved";
}

// Display name of a seat from state's players ("Player N" standard), with a
// positional fallback when the seat is unknown to state.
function seatName(state: GameState | null, seat: number): string {
  return state?.players.find((p) => p.id === seat)?.name ?? `Player ${seat + 1}`;
}

// GameActions' toast label shape ("<owner>'s <hero>"); a hero the state no
// longer knows (or a seat with none) degrades to the bare seat name.
function heroLabel(state: GameState | null, seat: number, heroId: string): string {
  const hero = state?.heroes[heroId];
  const name = seatName(state, seat);
  return hero ? `${name}'s ${hero.name}` : name;
}

// Retreat/surrender relocation name, resolved from the caller's (merged,
// post-resync) state -- GameActions' verdictSettlementName shape.
function verdictSettlementName(
  state: GameState | null,
  heroId: string,
  verdict: HeroBattleVerdict | undefined,
): string | undefined {
  if (!verdict || verdict === "stood" || verdict === "defeated") return undefined;
  const hero = state?.heroes[heroId];
  if (!hero || !state) return undefined;
  return settlementNameAt(state.settlements, hero.q, hero.r);
}

// The result-card policy for event-derived battles: a card only when the
// local seat was on a side -- a hero battle's attacker or defender (the
// attacker seat is the event's actor) or a settlement battle's settlement
// owner / attacker. Pre-battle state is the right lookup: the battle's own
// state effects reach this client via the resync that follows the row, so
// ownership at emit time is still pre-battle.
export function isLocalSeatInvolved(
  kind: BattleOutcomeKind,
  payload: BattleOutcomeEventPayload,
  actorSeat: number | null,
  localSeat: number | null,
  state: GameState | null,
): boolean {
  if (localSeat === null) return false;
  if (actorSeat === localSeat) return true;
  if (kind === "heroBattle") {
    if (!isHeroPayload(payload)) return false;
    return state?.heroes[payload.defenderId]?.ownerId === localSeat;
  }
  if (isHeroPayload(payload)) return false;
  const settlement = state?.settlements[payload.settlementId];
  return settlement !== undefined && settlement.ownerId === localSeat;
}

// Belt-and-braces dedupe identity: the event id is the primary key, this
// catches a re-delivered battle under a fresh row id (cursor replay) inside
// a short window. Hero battles seed-discriminate (same pair, genuinely new
// fight -> new obstacleSeed); settlement battles lean on the window.
function identityKey(payload: BattleOutcomeEventPayload): string {
  if (isHeroPayload(payload)) {
    return `h:${payload.attackerId}:${payload.defenderId}:${payload.obstacleSeed}`;
  }
  return `s:${payload.attackerId}:${payload.settlementId}`;
}

function normalizeSettlementOutcome(payload: SettlementBattlePayload): SettlementBattleOutcomeView {
  return payload.outcome ?? (payload.winner === "attacker" ? "attackerWon" : "defenderWon");
}

// Everything the wording needs, captured at event time from pre-battle
// state; only the retreat/surrender relocation names wait for post-resync
// state at render time.
export function buildPendingOutcome(
  ev: Pick<MpBattleOutcomeEvent, "gameName" | "kind" | "payload" | "actorSeat">,
  involved: boolean,
  state: GameState | null,
): PendingBattleOutcome {
  if (isHeroPayload(ev.payload)) {
    const payload = ev.payload;
    const attackerSeat: number = payload.actor;
    const defenderHero = state?.heroes[payload.defenderId];
    const defenderSeat: number | null = defenderHero ? defenderHero.ownerId : null;
    return {
      family: "hero",
      gameName: ev.gameName,
      card: involved,
      winner: payload.winner,
      attacker: {
        heroId: payload.attackerId,
        label: heroLabel(state, attackerSeat, payload.attackerId),
        ownerName: seatName(state, attackerSeat),
        verdict: payload.attackerVerdict,
      },
      defender: {
        heroId: payload.defenderId,
        label:
          defenderSeat !== null ? heroLabel(state, defenderSeat, payload.defenderId) : payload.defenderId,
        ownerName: defenderSeat !== null ? seatName(state, defenderSeat) : undefined,
        verdict: payload.defenderVerdict,
      },
    };
  }
  const payload = ev.payload;
  const attackerSeat: number = payload.actor;
  const settlement = state?.settlements[payload.settlementId];
  return {
    family: "settlement",
    gameName: ev.gameName,
    card: involved,
    outcome: normalizeSettlementOutcome(payload),
    captured: payload.captured,
    settlementName: settlement?.name,
    attacker: {
      heroId: payload.attackerId,
      label: heroLabel(state, attackerSeat, payload.attackerId),
      ownerName: seatName(state, attackerSeat),
      verdict: payload.attackerVerdict,
    },
  };
}

export function buildHeroBattleCardBanner(
  winner: "attacker" | "defender" | "draw",
  attacker: BattleOutcomeSideView,
  defender: BattleOutcomeSideView,
): string {
  if (winner === "draw") return heroBattleDrawBanner(attacker.verdict, defender.verdict);
  const winnerLabel = winner === "attacker" ? attacker.label : defender.label;
  return `${winnerLabel} wins!`;
}

export function buildCardModel(
  pending: PendingBattleOutcome,
  state: GameState | null,
): BattleOutcomeCardModel {
  if (pending.family === "hero") {
    const lines: Array<{ text: string; defeated: boolean }> = [];
    for (const side of [pending.attacker, pending.defender]) {
      const line = battleVerdictCardLine(
        side.label,
        side.verdict,
        verdictSettlementName(state, side.heroId, side.verdict),
      );
      if (line) lines.push({ text: line, defeated: side.verdict === "defeated" });
    }
    return {
      family: "hero",
      banner: buildHeroBattleCardBanner(pending.winner, pending.attacker, pending.defender),
      lines,
    };
  }
  const lines: Array<{ text: string; defeated: boolean }> = [];
  const line = battleVerdictCardLine(
    pending.attacker.label,
    pending.attacker.verdict,
    verdictSettlementName(state, pending.attacker.heroId, pending.attacker.verdict),
  );
  if (line) lines.push({ text: line, defeated: pending.attacker.verdict === "defeated" });
  return {
    family: "settlement",
    banner: settlementBattleCardBanner({
      outcome: pending.outcome,
      captured: pending.captured,
      attackerLabel: pending.attacker.label,
      settlementName: pending.settlementName,
    }),
    lines,
  };
}

export function buildToastText(pending: PendingBattleOutcome, state: GameState | null): string {
  if (pending.family === "hero") {
    return battleToastMessage({
      attackerLabel: pending.attacker.label,
      defenderLabel: pending.defender.label,
      winner: pending.winner,
      attacker: {
        verdict: pending.attacker.verdict,
        ownerName: pending.attacker.ownerName,
        settlementName: verdictSettlementName(state, pending.attacker.heroId, pending.attacker.verdict),
      },
      defender: {
        verdict: pending.defender.verdict,
        ownerName: pending.defender.ownerName,
        settlementName: verdictSettlementName(state, pending.defender.heroId, pending.defender.verdict),
      },
    });
  }
  return settlementBattleToastMessage({
    attackerLabel: pending.attacker.label,
    settlementName: pending.settlementName,
    outcome: pending.outcome,
    captured: pending.captured,
    attackerVerdict: pending.attacker.verdict,
    attackerOwnerName: pending.attacker.ownerName,
  });
}

export function showVerdictCard(model: BattleOutcomeCardModel, autoDismissMs = VERDICT_CARD_AUTO_DISMISS_MS): void {
  const modal = openCenteredModal(document.body, "Battle Results", 420, false, false, undefined, {
    backdropClick: true,
    escape: true,
  });
  const wrapper = modal.root.parentElement;
  const autoDismiss = createVerdictCardAutoDismiss(() => modal.close(), undefined, autoDismissMs);
  modal.setOnClose(() => {
    // Every dismissal route lands here -- Carry On, backdrop click, Escape,
    // and the timer itself -- so cancelling here is what stops the timer from
    // firing a second close against an already-removed card.
    autoDismiss.cancel();
    wrapper?.remove();
  });

  const banner = document.createElement("div");
  banner.textContent = model.banner;
  banner.style.fontSize = "16px";
  banner.style.fontWeight = "700";
  banner.style.textAlign = "center";
  banner.style.margin = "4px 0 8px";
  modal.appendContent(banner);

  for (const line of model.lines) {
    const el = document.createElement("div");
    el.textContent = line.text;
    el.style.fontSize = "12px";
    el.style.textAlign = "center";
    el.style.color = line.defeated ? "#f88" : "rgba(241,228,195,0.85)";
    el.style.margin = "2px 0 0";
    modal.appendContent(el);
  }

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.marginTop = "12px";

  const carryOnBtn = document.createElement("button");
  carryOnBtn.textContent = "Carry On";
  styleButton(carryOnBtn, true);
  carryOnBtn.addEventListener("click", () => modal.close());
  row.appendChild(carryOnBtn);
  modal.appendContent(row);

  autoDismiss.start();
}

let activeDetach: (() => void) | null = null;

export function detachBattleOutcomeFeedback(): void {
  activeDetach?.();
  activeDetach = null;
}

export function attachBattleOutcomeFeedback(deps: BattleOutcomeFeedbackDeps): () => void {
  detachBattleOutcomeFeedback();

  const identityWindowMs = deps.identityWindowMs ?? DEFAULT_IDENTITY_WINDOW_MS;
  const renderFallbackMs = deps.renderFallbackMs ?? DEFAULT_RENDER_FALLBACK_MS;
  const seenIds = new Set<string>();
  const identities = new Map<string, number>();
  const tracked = new Set<TrackedOutcome>();

  const render = deps.render ?? {
    card: showVerdictCard,
    toast: (message: string) => showToast(message, "info"),
  };

  const renderTracked = (entry: TrackedOutcome, state: GameState | null): void => {
    if (entry.pending.card) {
      render.card(buildCardModel(entry.pending, state));
    } else {
      render.toast(buildToastText(entry.pending, state));
    }
  };

  const onOutcome = (ev: MpBattleOutcomeEvent): void => {
    if (!isServerDriven(ev.gameName)) return;
    const localSeat = deps.getLocalSeat();
    // Own-seat rows never render here: the flagged human attacker's own
    // battle already showed its card through the direct command response
    // (GameActions), so this copy would double-render.
    if (localSeat !== null && ev.actorSeat === localSeat) return;
    if (seenIds.has(ev.id)) return;
    seenIds.add(ev.id);
    if (seenIds.size > MAX_SEEN_IDS) {
      const oldest = seenIds.values().next();
      if (!oldest.done) seenIds.delete(oldest.value);
    }
    const now = Date.now();
    const key = identityKey(ev.payload);
    const identityExpiry = identities.get(key);
    if (identityExpiry !== undefined && identityExpiry > now) return;
    identities.set(key, now + identityWindowMs);
    if (identities.size > MAX_SEEN_IDS) {
      for (const [k, expiry] of identities) {
        if (expiry <= now) identities.delete(k);
      }
      while (identities.size > MAX_SEEN_IDS) {
        const oldest = identities.keys().next();
        if (oldest.done) break;
        identities.delete(oldest.value);
      }
    }

    const state = deps.getState();
    const involved = isLocalSeatInvolved(ev.kind, ev.payload, ev.actorSeat, localSeat, state);
    const entry: TrackedOutcome = {
      pending: buildPendingOutcome(ev, involved, state),
      timer: setTimeout(() => {
        tracked.delete(entry);
        // A pending from a game this client has switched away from is
        // dropped rather than rendered against the wrong game's state.
        if (deps.getGameName() !== entry.pending.gameName) return;
        renderTracked(entry, deps.getState());
      }, renderFallbackMs),
    };
    tracked.add(entry);
  };

  const onResynced = (ev: { gameName: string; state: GameState }): void => {
    for (const entry of [...tracked]) {
      if (entry.pending.gameName !== ev.gameName) continue;
      clearTimeout(entry.timer);
      tracked.delete(entry);
      renderTracked(entry, ev.state);
    }
  };

  bus.on("mp:battleOutcome", onOutcome);
  bus.on("mp:resynced", onResynced);
  activeDetach = () => {
    bus.off("mp:battleOutcome", onOutcome);
    bus.off("mp:resynced", onResynced);
    for (const entry of tracked) clearTimeout(entry.timer);
    tracked.clear();
    seenIds.clear();
    identities.clear();
  };
  return activeDetach;
}
