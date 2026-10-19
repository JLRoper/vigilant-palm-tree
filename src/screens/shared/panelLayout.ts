export type PanelGeometryKey = "heroInfo" | "settlementInfo" | "buildPalette" | "workforcePanel" | "recruitmentPanel";

export interface PanelGeometry {
  x: number;
  y: number;
}

type StoredGeometry = Partial<Record<PanelGeometryKey, PanelGeometry>>;

const STORAGE_KEY = "heroesJs.panelGeometry.v1";

const ALLOWED: ReadonlySet<string> = new Set(["heroInfo", "settlementInfo", "buildPalette", "workforcePanel", "recruitmentPanel"]);

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

// Panel SIZES live in their own store: a size is saved by the resize grip even
// before the panel has ever been moved, and mixing the two would leave a size
// entry claiming position (0,0) and pin the panel to the corner.
const SIZE_STORAGE_KEY = "heroesJs.panelSize.v1";

export interface PanelSize {
  w: number;
  h: number;
}

let cachedSizeRaw: string | null = null;
let cachedSizeStore: Partial<Record<PanelGeometryKey, PanelSize>> = {};

function validateSize(entry: unknown): PanelSize | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { w, h } = entry as { w?: unknown; h?: unknown };
  if (typeof w !== "number" || !Number.isFinite(w) || w < 0) return null;
  if (typeof h !== "number" || !Number.isFinite(h) || h < 0) return null;
  return { w, h };
}

function readSizeStore(): Partial<Record<PanelGeometryKey, PanelSize>> {
  if (typeof localStorage === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SIZE_STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === cachedSizeRaw) return cachedSizeStore;
  cachedSizeRaw = raw;
  const out: Partial<Record<PanelGeometryKey, PanelSize>> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        if (!ALLOWED.has(key)) continue;
        const size = validateSize(parsed[key]);
        if (size) out[key as PanelGeometryKey] = size;
      }
    } catch { /* ignore */ }
  }
  cachedSizeStore = out;
  return out;
}

export function loadPanelSize(key: PanelGeometryKey): PanelSize | null {
  return readSizeStore()[key] ?? null;
}

export function savePanelSize(key: PanelGeometryKey, size: PanelSize): void {
  const store = readSizeStore();
  store[key] = { w: Math.round(size.w), h: Math.round(size.h) };
  cachedSizeRaw = JSON.stringify(store);
  cachedSizeStore = store;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, cachedSizeRaw);
  } catch { /* ignore */ }
}
