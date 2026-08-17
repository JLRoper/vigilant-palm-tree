import { bus } from "../../core/eventBus";

// #100: minimal, non-blocking UI notification for fire-and-forget command
// rejections (src/game/turnHooks.ts's reportCommandFailure). Deliberately
// simple/self-contained -- raw DOM styling like every other src/screens/
// shared/ module (menu.ts, hud.ts, toolbar.ts), no new dependency, no
// animation library. Toasts stack, auto-dismiss, and are click-to-dismiss.

const CONTAINER_ID = "toast-container";
const DEFAULT_DURATION_MS = 6000;

// Above every other overlay in src/screens (openCenteredModal's wrapper is
// the highest at 300, see menu.ts) -- a command-rejection toast should stay
// visible even if a modal (e.g. the trade modal that triggered the command)
// is still open on top of it.
const TOAST_Z_INDEX = 10_000;

export type ToastKind = "error" | "info";

function getOrCreateContainer(): HTMLDivElement {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing instanceof HTMLDivElement) return existing;
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  Object.assign(container.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    zIndex: String(TOAST_Z_INDEX),
    pointerEvents: "none",
    maxWidth: "360px",
  });
  document.body.appendChild(container);
  return container;
}

const KIND_STYLES: Record<ToastKind, { background: string; border: string }> = {
  error: { background: "rgba(90,20,20,0.92)", border: "1px solid rgba(255,120,120,0.5)" },
  info: { background: "rgba(20,20,20,0.92)", border: "1px solid rgba(255,255,255,0.2)" },
};

export function showToast(message: string, kind: ToastKind = "error", durationMs = DEFAULT_DURATION_MS): void {
  const container = getOrCreateContainer();
  const toast = document.createElement("div");
  const style = KIND_STYLES[kind];
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  Object.assign(toast.style, {
    background: style.background,
    border: style.border,
    color: "#f1e4c3",
    padding: "10px 14px",
    borderRadius: "4px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "12px",
    lineHeight: "1.4",
    boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
    cursor: "pointer",
    pointerEvents: "auto",
  });
  toast.title = "Click to dismiss";
  const dismiss = () => toast.remove();
  toast.addEventListener("click", dismiss);
  container.appendChild(toast);
  window.setTimeout(dismiss, durationMs);
}

export interface CommandFailureToastsHandle {
  detach(): void;
}

// Explicit attach function (called once from src/managers/GameEngine.ts),
// mirroring src/debug/eventLog.ts's attachEventLog()/mountPersistentDevConsole()
// pattern rather than a side effect on import.
export function attachCommandFailureToasts(): CommandFailureToastsHandle {
  const handler = (ev: { type: string; action?: unknown; reason?: unknown }) => {
    const action = typeof ev.action === "string" && ev.action ? ev.action : "Action";
    const reason = typeof ev.reason === "string" && ev.reason ? ev.reason : "unknown error";
    showToast(`${action} failed: ${reason}`, "error");
  };
  bus.on("command:rejected", handler);
  return {
    detach: () => bus.off("command:rejected", handler),
  };
}
