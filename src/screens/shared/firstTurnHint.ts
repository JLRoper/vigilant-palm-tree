import { bus } from "../../core/eventBus";

// F12a (playtest fixes 2026-09-29): one-time first-turn hint. Deliberately
// self-contained raw DOM mirroring mpPresenceHint.ts / toast.ts: explicit
// attach from GameEngine.initEventListeners, shown once per browser (persisted
// flag, panelLayout.ts's validated/cached localStorage pattern) when the
// engine first reports an active game.
//
// Load-bearing for the Playwright suites (they clear localStorage, so the
// hint WILL be visible during tests): the panel container is
// pointer-events:none and only the "Got it" button is clickable, and the
// document-level dismissal listeners never preventDefault/stopPropagation --
// the widget must be invisible to input handling so the same click still
// reaches the canvas underneath.

const STORAGE_KEY = "heroesJs.firstTurnHint.v1";
const HINT_ID = "first-turn-hint";

const HINT_LINES = [
  "Click your hero, then click a hex to move",
  "Double-click your settlement to enter it",
  "Gear menu → Shortcuts for keys",
];

let cachedRaw: string | null = null;
let cachedSeen = false;

export function hasSeenFirstTurnHint(): boolean {
  if (typeof localStorage === "undefined") return false;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (raw === cachedRaw) return cachedSeen;
  cachedRaw = raw;
  cachedSeen = raw === "1";
  return cachedSeen;
}

export function markFirstTurnHintSeen(): void {
  cachedRaw = "1";
  cachedSeen = true;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function getOrCreateHint(): HTMLDivElement {
  const existing = document.getElementById(HINT_ID);
  if (existing instanceof HTMLDivElement) return existing;
  const panel = document.createElement("div");
  panel.id = HINT_ID;
  panel.setAttribute("data-first-turn-hint", "");
  Object.assign(panel.style, {
    position: "fixed",
    left: "50%",
    bottom: "16px",
    transform: "translateX(-50%)",
    zIndex: "8000",
    pointerEvents: "none",
    display: "none",
    maxWidth: "420px",
    padding: "10px 14px",
    background: "rgba(20, 24, 34, 0.92)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    borderRadius: "6px",
    color: "#f1e4c3",
    fontFamily: "system-ui, sans-serif",
    fontSize: "12px",
    lineHeight: "1.5",
    boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
  });
  for (const line of HINT_LINES) {
    const row = document.createElement("div");
    row.textContent = line;
    panel.appendChild(row);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Got it";
  Object.assign(btn.style, {
    pointerEvents: "auto",
    marginTop: "6px",
    padding: "3px 10px",
    cursor: "pointer",
    background: "rgba(230, 170, 60, 0.9)",
    border: "1px solid rgba(230, 170, 60, 0.9)",
    borderRadius: "4px",
    color: "#1c1408",
    fontFamily: "inherit",
    fontSize: "12px",
  });
  panel.appendChild(btn);
  document.body.appendChild(panel);
  return panel;
}

export interface FirstTurnHintHandle {
  detach(): void;
}

export function attachFirstTurnHint(opts: { hasActiveGame: () => boolean }): FirstTurnHintHandle {
  const el = getOrCreateHint();
  let shown = false;

  function dismiss(): void {
    el.style.display = "none";
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeydown);
  }

  function onDocClick(): void {
    dismiss();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") dismiss();
  }

  function show(): void {
    if (shown) return;
    shown = true;
    markFirstTurnHintSeen();
    el.style.display = "block";
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeydown);
  }

  const btn = el.querySelector("button");
  if (btn) btn.addEventListener("click", dismiss);

  function maybeShow(): void {
    if (shown || hasSeenFirstTurnHint() || !opts.hasActiveGame()) return;
    show();
  }

  maybeShow();
  bus.on("state:committed", maybeShow);
  return {
    detach: () => {
      bus.off("state:committed", maybeShow);
      dismiss();
      el.remove();
    },
  };
}
