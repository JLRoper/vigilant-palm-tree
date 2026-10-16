import type { GameState } from "@heroes/contracts";
import { bus } from "../../core/eventBus";
import type { MpStateChangedEvent, MpTurnStartedEvent } from "../../core/events";
import { getInMemoryLocalPlayerId } from "../../players/localPlayer";

export function shouldShowAiThinking(
  state: GameState,
  activePlayerId: number,
  localSeat: number | null,
): boolean {
  const activePlayer = state.players.find((p) => p.id === activePlayerId);
  if (!activePlayer || activePlayer.faction !== "ai") return false;
  return localSeat === null || activePlayerId !== localSeat;
}

export interface AiThinkingTracker {
  onStateChanged(ev: MpStateChangedEvent): void;
  onTurnStarted(ev: MpTurnStartedEvent): void;
  getVisible(): boolean;
  getText(): string;
}

export function createAiThinkingTracker(opts?: {
  getLocalSeat?: (gameName: string) => number | null;
}): AiThinkingTracker {
  const getLocalSeat = opts?.getLocalSeat ?? ((g) => getInMemoryLocalPlayerId(g));
  let gameName: string | null = null;
  let lastState: GameState | null = null;
  let lastActivePlayerId: number | null = null;

  const visible = (): boolean => {
    if (gameName === null || lastState === null || lastActivePlayerId === null) return false;
    return shouldShowAiThinking(lastState, lastActivePlayerId, getLocalSeat(gameName));
  };
  const text = (): string => {
    if (!visible() || lastState === null || lastActivePlayerId === null) return "";
    const activePlayer = lastState.players.find((p) => p.id === lastActivePlayerId);
    if (!activePlayer) return "";
    const who = activePlayer.name || `AI (seat ${lastActivePlayerId})`;
    return `${who} is thinking\u2026`;
  };

  return {
    onStateChanged(ev: MpStateChangedEvent): void {
      gameName = ev.gameName;
      lastState = ev.next;
      lastActivePlayerId = ev.next.activePlayerId;
    },
    onTurnStarted(ev: MpTurnStartedEvent): void {
      if (gameName !== null && ev.gameName !== gameName) return;
      gameName = ev.gameName;
      lastActivePlayerId = ev.activePlayerId;
    },
    getVisible: visible,
    getText: text,
  };
}

const HINT_ID = "ai-thinking-hint";

function getOrCreateHint(): HTMLDivElement {
  const existing = document.getElementById(HINT_ID);
  if (existing instanceof HTMLDivElement) return existing;
  const el = document.createElement("div");
  el.id = HINT_ID;
  Object.assign(el.style, {
    position: "fixed",
    left: "16px",
    bottom: "76px",
    padding: "6px 12px",
    background: "rgba(28, 22, 48, 0.9)",
    border: "1px solid rgba(150, 140, 255, 0.5)",
    color: "#e6e2ff",
    borderRadius: "4px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "12px",
    zIndex: "9000",
    pointerEvents: "none",
    display: "none",
  });
  document.body.appendChild(el);
  return el;
}

export interface AiThinkingHintHandle {
  detach(): void;
}

export function attachAiThinkingHint(): AiThinkingHintHandle {
  const el = getOrCreateHint();
  const tracker = createAiThinkingTracker();

  function refresh(): void {
    if (!tracker.getVisible()) {
      el.style.display = "none";
      return;
    }
    el.textContent = tracker.getText();
    el.style.display = "block";
  }

  const onStateChanged = (ev: MpStateChangedEvent): void => {
    tracker.onStateChanged(ev);
    refresh();
  };
  const onTurnStarted = (ev: MpTurnStartedEvent): void => {
    tracker.onTurnStarted(ev);
    refresh();
  };

  bus.on("mp:stateChanged", onStateChanged);
  bus.on("mp:turnStarted", onTurnStarted);
  return {
    detach: () => {
      bus.off("mp:stateChanged", onStateChanged);
      bus.off("mp:turnStarted", onTurnStarted);
      el.remove();
    },
  };
}
