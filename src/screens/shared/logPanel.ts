import { bus } from "../../core/eventBus";
import type { MpLogRow, MpLogRowEvent } from "../../core/events";
import { api } from "../../io/api";
import { settings, subscribeSettings } from "../../state/settings";

// Log Message Panel (plan/2026-09-28-sse-event-push.md, use case 1): a
// user-facing audit view of every game_events row for the current game --
// engine kinds and legacy audit kinds alike, all seats, this client's own
// included. Deliberately NOT an extension of the dev console's EventLog
// (src/debug/eventLog.ts): that tool only ever saw local bus/hook events,
// and widening it would couple a user feature to a debug tool.
//
// Layering: LogRowBuffer/LogPanelState/formatLogRow are pure and
// unit-tested without a DOM; attachLogPanelStore owns the bus/backlog
// wiring; createLogPanel is the thin DOM shell. No filtering of rows ever
// happens here -- applyRows already feeds every row to mp:logRow before its
// own state filtering.

export const LOG_PANEL_CAPACITY = 500;
const SUMMARY_MAX_CHARS = 120;
// scrollTop within this distance of the bottom counts as "user is at the
// bottom"; any higher and autoscroll stands down until they return.
const STICK_THRESHOLD_PX = 24;

/** Ring buffer of rows, newest-last, deduped by row id. */
export class LogRowBuffer {
  private rows: MpLogRow[] = [];
  private ids = new Set<string>();

  /** Appends unless a row with this id is already buffered. True when appended. */
  append(row: MpLogRow): boolean {
    if (this.ids.has(row.id)) return false;
    this.rows.push(row);
    this.ids.add(row.id);
    if (this.rows.length > LOG_PANEL_CAPACITY) {
      for (const dropped of this.rows.splice(0, this.rows.length - LOG_PANEL_CAPACITY)) {
        this.ids.delete(dropped.id);
      }
    }
    return true;
  }

  /**
   * Hydrates from a full-log fetch (api.getEvents(name, 0), newest-last):
   * tail-trims to capacity, then appends. Id-dedupe makes a subsequent live
   * frame for an already-buffered row a no-op, which is what lets the
   * backlog fetch race the live stream without duplicating rows.
   */
  appendBacklog(rows: readonly MpLogRow[]): number {
    const tail = rows.slice(Math.max(0, rows.length - LOG_PANEL_CAPACITY));
    let added = 0;
    for (const row of tail) {
      if (this.append(row)) added++;
    }
    // A backlog fetch can resolve after newer live frames already landed
    // (hydration runs while the stream keeps appending). Row ids are the
    // log's monotonic order, so one sort here restores newest-last without
    // paying for it on every live append.
    if (added > 0) {
      this.rows.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return added;
  }

  /** Snapshot, newest-last. */
  getAll(): MpLogRow[] {
    return this.rows.slice();
  }

  size(): number {
    return this.rows.length;
  }

  clear(): void {
    this.rows = [];
    this.ids.clear();
  }
}

export function formatLogRow(row: MpLogRow): string {
  let summary: string;
  try {
    summary = JSON.stringify(row.payload) ?? "";
  } catch {
    summary = "<unserializable>";
  }
  if (summary.length > SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, SUMMARY_MAX_CHARS - 1)}\u2026`;
  }
  return `#${row.id} \u00b7 ${row.created_at} \u00b7 ${row.kind} \u00b7 ${summary}`;
}

/**
 * Pure per-panel state: the buffer plus the gating rules. The showLogPanel
 * setting is checked at event time (no subscribe/unsubscribe churn), pause
 * freezes the buffer, and the current game is learned from the rows
 * themselves -- a different gameName resets the buffer and re-arms backlog
 * hydration.
 */
export class LogPanelState {
  readonly buffer = new LogRowBuffer();
  private paused = false;
  private game: string | null = null;
  private hydrated = false;

  appendLive(ev: MpLogRowEvent): void {
    if (!settings().showLogPanel) return;
    if (ev.gameName !== this.game) {
      this.buffer.clear();
      this.game = ev.gameName;
      this.hydrated = false;
    }
    if (this.paused) return;
    this.buffer.append(ev.row);
  }

  /** A backlog fetch is wanted (and not yet done for this game). */
  needsHydration(): boolean {
    return !this.hydrated && this.game !== null;
  }

  markHydrated(): void {
    this.hydrated = true;
  }

  hydrateBacklog(rows: readonly MpLogRow[]): void {
    this.buffer.appendBacklog(rows);
  }

  setPaused(v: boolean): void {
    this.paused = v;
  }

  isPaused(): boolean {
    return this.paused;
  }

  gameName(): string | null {
    return this.game;
  }

  clear(): void {
    this.buffer.clear();
  }
}

export interface LogPanelStore {
  state: LogPanelState;
  /** Fire the backlog fetch if one is needed for the current game. */
  hydrateIfNeeded(): void;
  detach(): void;
}

/**
 * Bus + backlog wiring for one panel. Pass onChange to be notified whenever
 * the buffer contents changed (or the game switched) so a DOM shell can
 * re-render.
 */
export function attachLogPanelStore(onChange: (state: LogPanelState) => void = () => {}): LogPanelStore {
  const state = new LogPanelState();
  let hydratingFor: string | null = null;

  async function hydrate(): Promise<void> {
    const gameName = state.gameName();
    if (!gameName || hydratingFor === gameName || state.isPaused()) return;
    hydratingFor = gameName;
    state.markHydrated();
    try {
      const rows = await api.getEvents(gameName, 0);
      if (state.gameName() !== gameName) return;
      state.hydrateBacklog(rows);
      onChange(state);
    } catch (e) {
      console.warn("[logPanel] backlog fetch failed:", e);
    } finally {
      if (hydratingFor === gameName) hydratingFor = null;
    }
  }

  const onRow = (ev: MpLogRowEvent): void => {
    state.appendLive(ev);
    if (state.needsHydration()) void hydrate();
    onChange(state);
  };
  bus.on("mp:logRow", onRow);
  return {
    state,
    hydrateIfNeeded: () => void hydrate(),
    detach: () => bus.off("mp:logRow", onRow),
  };
}

export interface LogPanelHandle {
  el: HTMLElement;
  destroy(): void;
}

/** DOM shell: a small fixed dock, hidden unless settings().showLogPanel. */
export function createLogPanel(): LogPanelHandle {
  const el = document.createElement("div");
  el.id = "game-log-panel";
  Object.assign(el.style, {
    position: "fixed",
    left: "16px",
    bottom: "76px",
    width: "440px",
    height: "240px",
    display: "none",
    flexDirection: "column",
    background: "rgba(12, 12, 14, 0.92)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    borderRadius: "4px",
    color: "#d8d8d8",
    fontFamily: "system-ui, sans-serif",
    fontSize: "12px",
    zIndex: "8500",
    boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.15)",
    flex: "0 0 auto",
  });
  const title = document.createElement("span");
  title.textContent = "Game log";
  title.style.fontWeight = "600";
  header.appendChild(title);
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  header.appendChild(spacer);

  const list = document.createElement("div");
  Object.assign(list.style, {
    flex: "1 1 auto",
    overflowY: "auto",
    padding: "4px 8px",
    fontFamily: "Consolas, Menlo, monospace",
    fontSize: "11px",
    lineHeight: "1.45",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  });

  let stickToBottom = true;
  list.addEventListener("scroll", () => {
    stickToBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - STICK_THRESHOLD_PX;
  });

  const makeControl = (label: string): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.textContent = label;
    Object.assign(btn.style, {
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.25)",
      borderRadius: "3px",
      color: "#d8d8d8",
      cursor: "pointer",
      fontSize: "10px",
      padding: "2px 8px",
    });
    return btn;
  };
  const pauseBtn = makeControl("Pause");
  const clearBtn = makeControl("Clear");
  header.appendChild(pauseBtn);
  header.appendChild(clearBtn);

  el.appendChild(header);
  el.appendChild(list);
  document.body.appendChild(el);

  const render = (): void => {
    const keepScroll = list.scrollTop;
    list.textContent = "";
    for (const row of store.state.buffer.getAll()) {
      const line = document.createElement("div");
      line.textContent = formatLogRow(row);
      line.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
      list.appendChild(line);
    }
    if (stickToBottom) {
      list.scrollTop = list.scrollHeight;
    } else {
      list.scrollTop = keepScroll;
    }
    pauseBtn.textContent = store.state.isPaused() ? "Resume" : "Pause";
  };

  const store = attachLogPanelStore(() => {
    if (settings().showLogPanel) render();
  });

  pauseBtn.addEventListener("click", () => {
    store.state.setPaused(!store.state.isPaused());
    store.hydrateIfNeeded();
    render();
  });
  clearBtn.addEventListener("click", () => {
    store.state.clear();
    render();
  });

  const applyVisibility = (visible: boolean): void => {
    el.style.display = visible ? "flex" : "none";
    if (visible) {
      store.hydrateIfNeeded();
      render();
    }
  };
  const unsubscribeSettings = subscribeSettings((s) => applyVisibility(s.showLogPanel));
  applyVisibility(settings().showLogPanel);

  return {
    el,
    destroy: () => {
      unsubscribeSettings();
      store.detach();
      el.remove();
    },
  };
}
