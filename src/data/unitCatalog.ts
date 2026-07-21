// Client-side cache for the unit-type catalog served by GET /api/units.
// The catalog is fetched once at startup (best-effort) and stashed in a module
// variable; UI code reads the synchronous snapshot via getCachedUnit(id).

import type { UnitType } from "../state/units";

const BASE = "/api";

let cache: Map<string, UnitType> | null = null;
let loading: Promise<UnitType[]> | null = null;
let loadFailed = false;

export async function loadUnitCatalog(): Promise<UnitType[]> {
  if (cache) return Array.from(cache.values());
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(`${BASE}/units`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const rows = (await res.json()) as UnitType[];
      cache = new Map(rows.map((r) => [r.id, r]));
      loadFailed = false;
      return rows;
    } catch (err) {
      console.warn("[unitCatalog] failed to load unit catalog:", err);
      loadFailed = true;
      cache = new Map();
      return [];
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function getCachedUnit(id: string | null): UnitType | null {
  if (!id || !cache) return null;
  return cache.get(id) ?? null;
}

export function catalogReady(): boolean {
  return cache !== null;
}

export function catalogFailed(): boolean {
  return loadFailed;
}