import type { BuildingDef, BuildingKind, GenerationStyle } from "./cityBuildingDraw";
import type { CityViewSize } from "../core/cityGrid";

export type GenerationPattern =
  | "denseUrban"
  | "sparseRural"
  | "radial"
  | "grid"
  | "clustered"
  | "sampler";

const ALL_STYLES: GenerationStyle[] = ["classic", "blocky", "crystalline", "organic", "industrial"];

const ALL_KINDS: BuildingKind[] = [
  "townHall", "house", "tower", "mageGuild", "mine", "market", "barracks", "smithy",
];

function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

export interface GenerationConfig {
  size: CityViewSize;
  pattern: GenerationPattern;
  style: GenerationStyle;
  seed: number;
  townHallAt: { gx: number; gy: number };
}

export function generateBuildings(config: GenerationConfig): BuildingDef[] {
  const rng = seededRandom(config.seed);

  let buildings: BuildingDef[];
  switch (config.pattern) {
    case "denseUrban":
      buildings = generateDenseUrban(config, rng);
      break;
    case "sparseRural":
      buildings = generateSparseRural(config, rng);
      break;
    case "radial":
      buildings = generateRadial(config, rng);
      break;
    case "grid":
      buildings = generateGrid(config, rng);
      break;
    case "clustered":
      buildings = generateClustered(config, rng);
      break;
    case "sampler":
      buildings = generateSampler(config, rng);
      break;
  }

  // The organic faction gets its signature agrarian + living structures.
  if (config.style === "organic") {
    enrichOrganic(buildings, config.size, config.townHallAt, rng, config.style);
  }
  if (config.style === "blocky") {
    enrichBlocky(buildings, config.size, config.townHallAt, rng, config.style);
  }

  return buildings;
}

function coversCell(b: BuildingDef, gx: number, gy: number): boolean {
  const w = b.w ?? 1;
  const h = b.h ?? 1;
  return gx >= b.gx && gx < b.gx + w && gy >= b.gy && gy < b.gy + h;
}

function canPlaceMulticell(
  buildings: BuildingDef[],
  center: { gx: number; gy: number },
  size: CityViewSize,
  gx: number, gy: number, w: number, h: number,
): boolean {
  if (gx < 0 || gy < 0 || gx + w > size || gy + h > size) return false;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      const cx = gx + dx;
      const cy = gy + dy;
      if (cx === center.gx && cy === center.gy) return false;
      if (buildings.some((b) => coversCell(b, cx, cy))) return false;
    }
  }
  return true;
}

function firstFreeCell(
  buildings: BuildingDef[],
  center: { gx: number; gy: number },
  size: CityViewSize,
  candidates: Array<{ gx: number; gy: number }>,
): { gx: number; gy: number } | null {
  for (const c of candidates) {
    if (c.gx < 0 || c.gy < 0 || c.gx >= size || c.gy >= size) continue;
    if (c.gx === center.gx && c.gy === center.gy) continue;
    if (buildings.some((b) => coversCell(b, c.gx, c.gy))) continue;
    return c;
  }
  return null;
}

// Adds an apartment (1x1), a 2x2 farm field, and an adjacent farmhouse to an
// organic-style settlement so the faction's agrarian art can be previewed.
function enrichOrganic(
  buildings: BuildingDef[],
  size: CityViewSize,
  center: { gx: number; gy: number },
  rng: () => number,
  style: GenerationStyle,
): void {
  // 1) Apartment: a multi-level living unit near the town hall.
  for (let r = 1; r <= 2; r++) {
    const ring = shuffle(ringCells(center, r, size), rng);
    const spot = firstFreeCell(buildings, center, size, ring);
    if (spot) {
      buildings.push({ gx: spot.gx, gy: spot.gy, kind: "apartment", level: 1 + Math.floor(rng() * 3), style });
      break;
    }
  }

  // 1b) Archery range: another building near the town hall on a free cell.
  for (let r = 1; r <= 2; r++) {
    const ring = shuffle(ringCells(center, r, size), rng);
    const spot = firstFreeCell(buildings, center, size, ring);
    if (spot) {
      buildings.push({ gx: spot.gx, gy: spot.gy, kind: "archeryRange", level: 1 + Math.floor(rng() * 2), style });
      break;
    }
  }

  // 2) 2x2 farm field: prefer a corner-ish block away from center.
  const fieldCandidates: Array<{ gx: number; gy: number }> = [];
  // corners
  fieldCandidates.push({ gx: 0, gy: 0 });
  fieldCandidates.push({ gx: size - 2, gy: size - 2 });
  fieldCandidates.push({ gx: size - 2, gy: 0 });
  fieldCandidates.push({ gx: 0, gy: size - 2 });
  // a few random interior roots
  for (let i = 0; i < 6; i++) {
    fieldCandidates.push({
      gx: Math.floor(rng() * (size - 1)),
      gy: Math.floor(rng() * (size - 1)),
    });
  }
  let fieldRoot: { gx: number; gy: number } | null = null;
  for (const c of fieldCandidates) {
    if (canPlaceMulticell(buildings, center, size, c.gx, c.gy, 2, 2)) {
      fieldRoot = c;
      break;
    }
  }
  if (fieldRoot) {
    buildings.push({ gx: fieldRoot.gx, gy: fieldRoot.gy, kind: "farmField", level: 1, style, w: 2, h: 2 });

    // 3) Farmhouse in front of (south of) the field. Try cells just beyond the
    //    field's lower-right / lower-left edges, then anywhere adjacent.
    const front: Array<{ gx: number; gy: number }> = [
      { gx: fieldRoot.gx, gy: fieldRoot.gy + 2 },
      { gx: fieldRoot.gx + 2, gy: fieldRoot.gy },
      { gx: fieldRoot.gx + 1, gy: fieldRoot.gy + 2 },
      { gx: fieldRoot.gx + 2, gy: fieldRoot.gy + 1 },
      { gx: fieldRoot.gx - 1, gy: fieldRoot.gy + 1 },
      { gx: fieldRoot.gx + 1, gy: fieldRoot.gy - 1 },
    ];
    const spot = firstFreeCell(buildings, center, size, front);
    if (spot) {
      buildings.push({ gx: spot.gx, gy: spot.gy, kind: "farmhouse", level: 1, style });
    }
  }
}

// Adds a blocky archery range, farmhouse, and high‑rise complex to a
// blocky‑style settlement for visual testing.
function enrichBlocky(
  buildings: BuildingDef[],
  size: CityViewSize,
  center: { gx: number; gy: number },
  rng: () => number,
  style: GenerationStyle,
): void {
  // 1) Archery range near center
  for (let r = 1; r <= 2; r++) {
    const ring = shuffle(ringCells(center, r, size), rng);
    const spot = firstFreeCell(buildings, center, size, ring);
    if (spot) {
      buildings.push({ gx: spot.gx, gy: spot.gy, kind: "archeryRange", level: 1 + Math.floor(rng() * 2), style });
      break;
    }
  }

  // 2) Farmhouse on an edge cell
  for (let r = 1; r <= 2; r++) {
    const ring = shuffle(ringCells(center, r, size), rng);
    const spot = firstFreeCell(buildings, center, size, ring);
    if (spot) {
      buildings.push({ gx: spot.gx, gy: spot.gy, kind: "farmhouse", level: 1, style });
      break;
    }
  }

  // 3) High‑rise complex (apartment) near center
  for (let r = 1; r <= 2; r++) {
    const ring = shuffle(ringCells(center, r, size), rng);
    const spot = firstFreeCell(buildings, center, size, ring);
    if (spot) {
      buildings.push({ gx: spot.gx, gy: spot.gy, kind: "apartment", level: 1 + Math.floor(rng() * 3), style });
      break;
    }
  }
}

function isOccupied(
  gx: number,
  gy: number,
  buildings: BuildingDef[],
  center: { gx: number; gy: number },
  size: CityViewSize,
): boolean {
  if (gx < 0 || gy < 0 || gx >= size || gy >= size) return true;
  if (gx === center.gx && gy === center.gy) return true;
  return buildings.some((b) => coversCell(b, gx, gy));
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function ringCells(
  center: { gx: number; gy: number },
  radius: number,
  size: CityViewSize,
): Array<{ gx: number; gy: number }> {
  const cells: Array<{ gx: number; gy: number }> = [];
  for (let dx = -radius; dx <= radius; dx++) {
    const dy = radius - Math.abs(dx);
    const candidates = [
      { gx: center.gx + dx, gy: center.gy + dy },
      { gx: center.gx + dx, gy: center.gy - dy },
    ];
    for (const c of candidates) {
      if (c.gx >= 0 && c.gy >= 0 && c.gx < size && c.gy < size) {
        if (!cells.some((e) => e.gx === c.gx && e.gy === c.gy)) {
          cells.push(c);
        }
      }
    }
  }
  return cells;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Pattern: Dense Urban ───────────────────────────────────────────────────

function generateDenseUrban(config: GenerationConfig, rng: () => number): BuildingDef[] {
  const { size, style, townHallAt } = config;
  const buildings: BuildingDef[] = [];
  const center = townHallAt;

  buildings.push({ gx: center.gx, gy: center.gy, kind: "townHall", level: 2, style });

  const maxRadius = Math.ceil(size / 2);
  for (let r = 1; r <= maxRadius; r++) {
    const ring = ringCells(center, r, size);
    for (const cell of ring) {
      if (isOccupied(cell.gx, cell.gy, buildings, center, size)) continue;
      if (rng() < 0.7) {
        const kind = pick<BuildingKind>(["house", "house", "house", "market", "smithy", "tower"], rng);
        buildings.push({ gx: cell.gx, gy: cell.gy, kind, level: Math.ceil(rng() * 2), style });
      }
    }
  }

  if (buildings.length < 4) {
    fillRemaining(buildings, size, center, rng, style);
  }

  return buildings;
}

// ─── Pattern: Sparse Rural ──────────────────────────────────────────────────

function generateSparseRural(config: GenerationConfig, rng: () => number): BuildingDef[] {
  const { size, style, townHallAt } = config;
  const buildings: BuildingDef[] = [];
  const center = townHallAt;

  buildings.push({ gx: center.gx, gy: center.gy, kind: "townHall", level: 1, style });

  const maxRadius = Math.ceil(size / 2);
  for (let r = 1; r <= maxRadius; r++) {
    const ring = ringCells(center, r, size);
    const shuffled = shuffle(ring, rng);
    let placed = 0;
    for (const cell of shuffled) {
      if (placed >= 2) break;
      if (isOccupied(cell.gx, cell.gy, buildings, center, size)) continue;
      const kind = pick<BuildingKind>(["house", "house", "mine", "smithy"], rng);
      buildings.push({ gx: cell.gx, gy: cell.gy, kind, level: 1, style });
      placed++;
    }
  }

  return buildings;
}

// ─── Pattern: Radial ────────────────────────────────────────────────────────

function generateRadial(config: GenerationConfig, rng: () => number): BuildingDef[] {
  const { size, style, townHallAt } = config;
  const buildings: BuildingDef[] = [];
  const center = townHallAt;

  buildings.push({ gx: center.gx, gy: center.gy, kind: "townHall", level: 3, style });

  const spokes = 4 + Math.floor(rng() * 3);
  const maxRadius = Math.ceil(size / 2);
  for (let s = 0; s < spokes; s++) {
    const angle = (s / spokes) * Math.PI * 2 + rng() * 0.3;
    for (let r = 1; r <= maxRadius; r++) {
      const gx = Math.round(center.gx + Math.cos(angle) * r);
      const gy = Math.round(center.gy + Math.sin(angle) * r);
      if (isOccupied(gx, gy, buildings, center, size)) continue;
      if (rng() < 0.8 - r * 0.1) {
        const kind = pick<BuildingKind>(["tower", "house", "barracks", "mageGuild", "market"], rng);
        buildings.push({ gx, gy, kind, level: Math.min(3, Math.ceil((maxRadius - r + 1) * 0.5)), style });
      }
    }
  }

  return buildings;
}

// ─── Pattern: Grid ──────────────────────────────────────────────────────────

function generateGrid(config: GenerationConfig, rng: () => number): BuildingDef[] {
  const { size, style, townHallAt } = config;
  const buildings: BuildingDef[] = [];
  const center = townHallAt;

  buildings.push({ gx: center.gx, gy: center.gy, kind: "townHall", level: 2, style });

  const step = size <= 5 ? 2 : size <= 10 ? 2 : 3;
  for (let gx = 0; gx < size; gx += step) {
    for (let gy = 0; gy < size; gy += step) {
      if (isOccupied(gx, gy, buildings, center, size)) continue;
      if (rng() < 0.6) {
        const kind = pick<BuildingKind>(["house", "tower", "barracks", "mageGuild", "market", "smithy"], rng);
        buildings.push({ gx, gy, kind, level: 1 + Math.floor(rng() * 2), style });
      }
    }
  }

  return buildings;
}

// ─── Pattern: Clustered ─────────────────────────────────────────────────────

function generateClustered(config: GenerationConfig, rng: () => number): BuildingDef[] {
  const { size, style, townHallAt } = config;
  const buildings: BuildingDef[] = [];
  const center = townHallAt;

  buildings.push({ gx: center.gx, gy: center.gy, kind: "townHall", level: 2, style });

  const numClusters = 2 + Math.floor(rng() * 3);
  for (let c = 0; c < numClusters; c++) {
    const clusterGx = Math.floor(rng() * size);
    const clusterGy = Math.floor(rng() * size);
    const clusterSize = 2 + Math.floor(rng() * 3);

    for (let dx = -clusterSize; dx <= clusterSize; dx++) {
      for (let dy = -clusterSize; dy <= clusterSize; dy++) {
        const gx = clusterGx + dx;
        const gy = clusterGy + dy;
        if (isOccupied(gx, gy, buildings, center, size)) continue;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > clusterSize || rng() > 1 - dist * 0.15) continue;
        const kind = pick<BuildingKind>(["house", "mine", "smithy", "tower", "barracks"], rng);
        buildings.push({ gx, gy, kind, level: 1 + Math.floor(rng() * 2), style });
      }
    }
  }

  return buildings;
}

// ─── Pattern: Sampler ───────────────────────────────────────────────────────

function generateSampler(config: GenerationConfig, _rng: () => number): BuildingDef[] {
  const { size, style, townHallAt } = config;
  const buildings: BuildingDef[] = [];
  const center = townHallAt;

  for (let s = 0; s < ALL_STYLES.length; s++) {
    const buildStyle = ALL_STYLES[s];
    const gx = 1 + s * Math.floor(size / ALL_STYLES.length);
    const gy = 1 + s;
    if (gx < size && gy < size && !isOccupied(gx, gy, buildings, center, size)) {
      const kind = ALL_KINDS[s % ALL_KINDS.length];
      buildings.push({ gx, gy, kind, level: 2, style: buildStyle });
    }
  }

  buildings.push({ gx: center.gx, gy: center.gy, kind: "townHall", level: 3, style });

  return buildings;
}

function fillRemaining(
  buildings: BuildingDef[],
  size: CityViewSize,
  center: { gx: number; gy: number },
  rng: () => number,
  style: GenerationStyle,
): void {
  for (let gx = 0; gx < size; gx++) {
    for (let gy = 0; gy < size; gy++) {
      if (isOccupied(gx, gy, buildings, center, size)) continue;
      if (rng() < 0.15) {
        buildings.push({ gx, gy, kind: "house", level: 1, style });
      }
    }
  }
}
