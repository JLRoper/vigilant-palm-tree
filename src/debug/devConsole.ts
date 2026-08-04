import { openCenteredModal, menuTheme, styleButton, styleInput } from "../views/menu";
import { EventLog, type LogEntry, type LogSource } from "./eventLog";

export interface DevConsoleOptions {
  parent?: HTMLElement;
  title?: string;
  width?: number;
  pageSize?: number;
  /** Storage key used to persist pin state + filters. Pass null to disable. */
  persistKey?: string | null;
}

export interface DevConsoleHandle {
  close(): void;
  show(): void;
  hide(): void;
  isPinned(): boolean;
  setPinned(value: boolean): void;
  togglePin(): boolean;
  log: EventLog;
}

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_PERSIST_KEY = "devConsole.state.v1";

interface PersistedState {
  pinned?: boolean;
  typeFilter?: string;
  sourceFilter?: LogSource | "all";
  paused?: boolean;
}

function loadPersisted(key: string | null | undefined): PersistedState {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePersisted(key: string | null | undefined, state: PersistedState): void {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* ignore quota / privacy mode errors */
  }
}

function clearPersisted(key: string | null | undefined): void {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function openDevConsole(log: EventLog, options: DevConsoleOptions = {}): DevConsoleHandle {
  const title = options.title ?? "Dev Console — Event Log";
  const width = options.width ?? 720;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const persistKey = options.persistKey === null ? null : (options.persistKey ?? DEFAULT_PERSIST_KEY);
  const initial = loadPersisted(persistKey);

  const modal = openCenteredModal(options.parent ?? document.body, title, width, true);

  let paused = initial.paused ?? false;
  let typeFilter = initial.typeFilter ?? "";
  let sourceFilter: LogSource | "all" = initial.sourceFilter ?? "all";
  let pinned = initial.pinned ?? false;
  let renderToken = 0;
  let hidden = false;

  const state = { current: log.getEntries({ limit: pageSize }) };

  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "8px";

  const controlsRow = document.createElement("div");
  Object.assign(controlsRow.style, {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
  });

  const filterInput = document.createElement("input");
  filterInput.type = "text";
  filterInput.placeholder = "type prefix filter (e.g. hero: or move_)";
  styleInput(filterInput);
  filterInput.style.flex = "1 1 200px";
  filterInput.value = typeFilter;
  filterInput.addEventListener("input", () => {
    typeFilter = filterInput.value.trim();
    persistFilters();
    rerender();
  });
  controlsRow.appendChild(filterInput);

  const sourceSelect = document.createElement("select");
  for (const v of ["all", "bus", "hook"] as const) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sourceSelect.appendChild(opt);
  }
  sourceSelect.value = sourceFilter;
  sourceSelect.addEventListener("change", () => {
    sourceFilter = sourceSelect.value as LogSource | "all";
    persistFilters();
    rerender();
  });
  Object.assign(sourceSelect.style, {
    background: menuTheme.input.background,
    color: menuTheme.input.color,
    border: menuTheme.input.border,
    borderRadius: menuTheme.input.borderRadius,
    padding: menuTheme.input.padding,
    fontFamily: menuTheme.input.fontFamily,
  });
  controlsRow.appendChild(sourceSelect);

  const pauseBtn = document.createElement("button");
  styleButton(pauseBtn);
  const refreshPauseBtn = (): void => {
    pauseBtn.textContent = paused ? "Resume" : "Pause";
  };
  refreshPauseBtn();
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    refreshPauseBtn();
    persistFilters();
  });
  controlsRow.appendChild(pauseBtn);

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  styleButton(clearBtn);
  clearBtn.addEventListener("click", () => {
    log.clear();
    rerender();
  });
  controlsRow.appendChild(clearBtn);

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy JSON";
  styleButton(copyBtn);
  copyBtn.addEventListener("click", () => {
    const json = JSON.stringify(state.current, null, 2);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(json);
    } else {
      console.log("[devConsole] entries:\n", json);
    }
  });
  controlsRow.appendChild(copyBtn);

  const pinBtn = document.createElement("button");
  styleButton(pinBtn);
  const refreshPinBtn = (): void => {
    pinBtn.textContent = pinned ? "Pinned ✓" : "Pin";
    pinBtn.title = pinned
      ? "Pinned: closing (×) hides the console instead of destroying it. State persists across reloads."
      : "Pin the console so it persists across reloads and × hides instead of closing.";
    pinBtn.style.opacity = pinned ? "1" : "0.85";
    pinBtn.style.borderColor = pinned ? "rgba(120,200,120,0.55)" : "";
  };
  refreshPinBtn();
  pinBtn.addEventListener("click", () => {
    setPinned(!pinned);
  });
  controlsRow.appendChild(pinBtn);

  content.appendChild(controlsRow);

  const status = document.createElement("div");
  Object.assign(status.style, {
    fontSize: "11px",
    opacity: "0.65",
    display: "flex",
    justifyContent: "space-between",
  });
  const refreshStatus = () => {
    const s = log.stats();
    status.innerHTML = "";
    const left = document.createElement("span");
    left.textContent = `${s.total} / ${s.capacity} entries (bus:${s.bySource.bus} hook:${s.bySource.hook})`;
    status.appendChild(left);
    const right = document.createElement("span");
    right.textContent = paused ? "PAUSED" : "LIVE";
    right.style.color = paused ? "#fa8" : "#8fa";
    status.appendChild(right);
  };
  content.appendChild(status);

  const list = document.createElement("div");
  Object.assign(list.style, {
    maxHeight: "420px",
    overflowY: "auto",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "3px",
    background: "#0e0e0e",
    padding: "4px 6px",
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    fontSize: "11px",
    lineHeight: "1.45",
  });
  content.appendChild(list);

  modal.setContent(content);

  const rerender = () => {
    const token = ++renderToken;
    const query: Parameters<EventLog["getEntries"]>[0] = { limit: pageSize };
    if (typeFilter) query.typePrefix = typeFilter;
    if (sourceFilter !== "all") query.source = sourceFilter;
    const entries = log.getEntries(query);
    if (token !== renderToken) return;
    state.current = entries;
    refreshStatus();
    list.innerHTML = "";
    for (const e of entries) renderEntry(e);
    list.scrollTop = list.scrollHeight;
  };

  const renderEntry = (e: LogEntry): void => {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      gap: "6px",
      padding: "2px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    });
    const time = document.createElement("span");
    time.style.color = "#888";
    time.style.flex = "0 0 70px";
    time.textContent = new Date(e.ts).toISOString().slice(11, 23);
    row.appendChild(time);

    const src = document.createElement("span");
    src.style.flex = "0 0 38px";
    src.style.opacity = "0.7";
    src.textContent = e.source;
    row.appendChild(src);

    const type = document.createElement("span");
    type.style.flex = "0 0 180px";
    type.style.fontWeight = "600";
    type.textContent = e.type;
    row.appendChild(type);

    const payload = document.createElement("span");
    payload.style.flex = "1 1 auto";
    payload.style.wordBreak = "break-all";
    payload.style.opacity = "0.85";
    payload.textContent = formatPayload(e.payload);
    row.appendChild(payload);

    list.appendChild(row);
  };

  const unsub = log.subscribe((entry) => {
    if (paused) return;
    if (typeFilter && !entry.type.startsWith(typeFilter)) return;
    if (sourceFilter !== "all" && entry.source !== sourceFilter) return;
    rerender();
  });

  rerender();

  const persistFilters = (): void => {
    if (!pinned) return;
    savePersisted(persistKey, {
      pinned: true,
      typeFilter,
      sourceFilter,
      paused,
    });
  };

  const persistPin = (): void => {
    if (pinned) {
      savePersisted(persistKey, { pinned: true, typeFilter, sourceFilter, paused });
    } else {
      clearPersisted(persistKey);
    }
  };

  const setPinned = (next: boolean): void => {
    if (pinned === next) return;
    pinned = next;
    refreshPinBtn();
    if (pinned) {
      persistFilters();
    } else {
      clearPersisted(persistKey);
    }
  };

  const show = (): void => {
    if (!hidden) return;
    hidden = false;
    modal.setContent(content);
    rerender();
  };

  const hide = (): void => {
    if (hidden) return;
    hidden = true;
    modal.setContent("");
  };

  const originalClose = modal.close.bind(modal);
  modal.close = (): void => {
    if (pinned && !hidden) {
      hide();
      return;
    }
    unsub();
    persistPin();
    originalClose();
  };

  return {
    close: () => modal.close(),
    show,
    hide,
    isPinned: () => pinned,
    setPinned,
    togglePin: () => {
      setPinned(!pinned);
      return pinned;
    },
    log,
  };
}

/**
 * Opens the dev console and re-applies its pinned state on every boot.
 * If the previous run left the console pinned, it auto-opens; otherwise no-op.
 * Pass `persistKey: null` in `options` to disable persistence.
 */
export function mountPersistentDevConsole(
  log: EventLog,
  options: DevConsoleOptions = {},
): DevConsoleHandle | null {
  const persistKey = options.persistKey === null ? null : (options.persistKey ?? DEFAULT_PERSIST_KEY);
  const persisted = loadPersisted(persistKey);
  if (!persisted.pinned) return null;
  return openDevConsole(log, options);
}

function formatPayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) return "{}";
  try {
    const json = JSON.stringify(payload);
    return json.length > 240 ? json.slice(0, 240) + "…" : json;
  } catch {
    return "{…}";
  }
}

export interface DevConsoleFooterOptions {
  parent?: HTMLElement;
  maxLines?: number;
}

export interface DevConsoleFooterHandle {
  destroy(): void;
}

export function mountDevConsoleFooter(
  log: EventLog,
  options: DevConsoleFooterOptions = {},
): DevConsoleFooterHandle {
  const parent = options.parent ?? document.body;
  const maxLines = options.maxLines ?? 5;

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    position: "fixed",
    left: "50%",
    bottom: "4px",
    transform: "translateX(-50%)",
    zIndex: "40",
    background: "rgba(0,0,0,0.78)",
    color: "#eee",
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    fontSize: "10px",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "4px",
    padding: "4px 8px",
    pointerEvents: "none",
    minWidth: "320px",
    maxWidth: "80vw",
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  });
  parent.appendChild(footer);

  const render = (entries: LogEntry[]): void => {
    footer.innerHTML = "";
    const slice = entries.slice(-maxLines);
    for (const e of slice) {
      const row = document.createElement("div");
      row.style.opacity = "0.9";
      const time = document.createElement("span");
      time.style.color = "#888";
      time.style.marginRight = "6px";
      time.textContent = new Date(e.ts).toISOString().slice(11, 19);
      row.appendChild(time);
      const src = document.createElement("span");
      src.style.color = e.source === "bus" ? "#8cf" : "#fc8";
      src.style.marginRight = "6px";
      src.textContent = `[${e.source}]`;
      row.appendChild(src);
      const type = document.createElement("span");
      type.style.fontWeight = "600";
      type.style.marginRight = "6px";
      type.textContent = e.type;
      row.appendChild(type);
      const payload = document.createElement("span");
      payload.style.opacity = "0.7";
      payload.textContent = formatPayload(e.payload);
      row.appendChild(payload);
      footer.appendChild(row);
    }
  };

  const unsub = log.subscribe(() => render(log.getEntries()));
  render(log.getEntries());

  return {
    destroy: () => {
      unsub();
      footer.remove();
    },
  };
}
