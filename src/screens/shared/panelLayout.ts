export type PanelGeometryKey = "heroInfo" | "settlementInfo" | "buildPalette";

export interface PanelGeometry {
  x: number;
  y: number;
}

type StoredGeometry = Partial<Record<PanelGeometryKey, PanelGeometry>>;

const STORAGE_KEY = "heroesJs.panelGeometry.v1";

const ALLOWED: ReadonlySet<string> = new Set(["heroInfo", "settlementInfo", "buildPalette"]);

let cachedRaw: string | null = null;
let cachedStore: StoredGeometry = {};

function validateEntry(entry: unknown): PanelGeometry | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { x, y } = entry as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return null;
  if (typeof y !== "number" || !Number.isFinite(y) || y < 0) return null;
  return { x, y };
}

function parseStore(raw: string): StoredGeometry {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: StoredGeometry = {};
    for (const key of Object.keys(parsed)) {
      if (!ALLOWED.has(key)) continue;
      const entry = validateEntry(parsed[key]);
      if (entry) out[key as PanelGeometryKey] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

function readStore(): StoredGeometry {
  if (typeof localStorage === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === cachedRaw) return cachedStore;
  cachedRaw = raw;
  cachedStore = raw ? parseStore(raw) : {};
  return cachedStore;
}

export function loadPanelGeometry(key: PanelGeometryKey): PanelGeometry | null {
  return readStore()[key] ?? null;
}

export function savePanelGeometry(key: PanelGeometryKey, pos: PanelGeometry): void {
  const store = readStore();
  store[key] = { x: pos.x, y: pos.y };
  cachedRaw = JSON.stringify(store);
  cachedStore = store;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, cachedRaw);
  } catch { /* ignore */ }
}
