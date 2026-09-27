import { bus } from "../../core/eventBus";
import type { MpPresenceUpdatedEvent, MpStateChangedEvent } from "../../core/events";

// Drop-policy client signal (docs/multiplayer.md, shipped 2026-09-27):
// minimal in-game hint for a disconnected seat that is holding up the
// table -- "Waiting for seat N (disconnected)" -- fed by the mp:presenceUpdated
// (server-side presence off the per-poll telemetry read / game row) and
// mp:stateChanged (whose seat is active) bus events.
//
// Deliberately self-contained raw DOM, mirroring toast.ts's
// attachCommandFailureToasts pattern rather than touching the HUD text
// line: explicit-attach, called once from GameEngine.initEventListeners(),
// one fixed-position element shown/hidden, no redesign of any existing UI.

const HINT_ID = "mp-presence-hint";

function getOrCreateHint(): HTMLDivElement {
  const existing = document.getElementById(HINT_ID);
  if (existing instanceof HTMLDivElement) return existing;
  const el = document.createElement("div");
  el.id = HINT_ID;
  Object.assign(el.style, {
    position: "fixed",
    left: "16px",
    bottom: "44px",
    padding: "6px 12px",
    background: "rgba(60, 40, 8, 0.9)",
    border: "1px solid rgba(230, 170, 60, 0.55)",
    color: "#f1e4c3",
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

export interface MpPresenceHintHandle {
  detach(): void;
}

export function attachMpPresenceHint(): MpPresenceHintHandle {
  const el = getOrCreateHint();
  let gameName: string | null = null;
  let activePlayerId: number | null = null;
  let presence: MpPresenceUpdatedEvent["presence"] = {};

  function refresh(): void {
    if (gameName === null || activePlayerId === null) {
      el.style.display = "none";
      return;
    }
    // The signal that matters is the blocking one: a disconnected seat that
    // currently holds the turn. Other disconnected seats stay quiet here --
    // the lobby seat list already shows those.
    const blocking = Object.entries(presence).find(
      ([seat, p]) => p.connected === false && Number(seat) === activePlayerId,
    );
    if (!blocking) {
      el.style.display = "none";
      return;
    }
    el.textContent = `Waiting for seat ${blocking[0]} (disconnected)`;
    el.style.display = "block";
  }

  const onStateChanged = (ev: MpStateChangedEvent): void => {
    gameName = ev.gameName;
    activePlayerId = ev.next.activePlayerId;
    refresh();
  };
  const onPresence = (ev: MpPresenceUpdatedEvent): void => {
    // Ignore presence for a game we've moved on from (poll cycles can
    // outlive a game switch, same guard the topology event uses).
    if (ev.gameName !== gameName) return;
    presence = ev.presence;
    refresh();
  };

  bus.on("mp:stateChanged", onStateChanged);
  bus.on("mp:presenceUpdated", onPresence);
  return {
    detach: () => {
      bus.off("mp:stateChanged", onStateChanged);
      bus.off("mp:presenceUpdated", onPresence);
      el.remove();
    },
  };
}
