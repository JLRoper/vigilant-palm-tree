import assert from "node:assert/strict";
import { generateCitySpots, type CitySpot, type CityMine } from "../src/core/citySpots.js";
import type { CityViewSize } from "../src/core/cityGrid.js";

let n = 0;
function check(cond: unknown, msg: string) {
  assert.ok(cond, msg);
  n++;
}

function makeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

// 5x5 grid generates 3 spots
{
  const rng = makeRng([0.1, 0.5, 0.2, 0.3, 0.7, 0.4, 0.6, 0.8, 0.9]);
  const { spots, mines } = generateCitySpots(5, rng);
  check(spots.length === 3, "5x5 grid generates 3 spots");
  check(mines.length === 0, "5x5 grid generates 0 mines initially");
  for (const spot of spots) {
    check(spot.cell.x >= 0 && spot.cell.x < 5, `spot x in range: ${spot.cell.x}`);
    check(spot.cell.y >= 0 && spot.cell.y < 5, `spot y in range: ${spot.cell.y}`);
    check(typeof spot.resource === "string", `spot has resource string`);
    check(typeof spot.vein === "string", `spot has vein string`);
    check(spot.cell.x !== 2 || spot.cell.y !== 2, "center cell is not a spot");
  }
}

// 10x10 grid generates 6 spots
{
  const rng = makeRng([0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 0.02, 0.12]);
  const { spots } = generateCitySpots(10, rng);
  check(spots.length === 6, "10x10 grid generates 6 spots");
}

// 15x15 grid generates 9 spots
{
  const rng = makeRng([0.01, 0.08, 0.15, 0.22, 0.29, 0.36, 0.43, 0.50, 0.57, 0.64, 0.71, 0.78, 0.85, 0.92, 0.04, 0.11, 0.18, 0.25]);
  const { spots } = generateCitySpots(15, rng);
  check(spots.length === 9, "15x15 grid generates 9 spots");
}

// No duplicate cells
{
  const rng = makeRng([0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.11, 0.12]);
  const { spots } = generateCitySpots(5, rng);
  const seen = new Set<string>();
  for (const spot of spots) {
    const key = `${spot.cell.x},${spot.cell.y}`;
    check(!seen.has(key), `no duplicate cell: ${key}`);
    seen.add(key);
  }
}

// Center cell is never a spot
for (const size of [5, 10, 15] as CityViewSize[]) {
  const rng = makeRng([0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009, 0.010, 0.011, 0.012, 0.013, 0.014, 0.015]);
  const { spots } = generateCitySpots(size, rng);
  const center = Math.floor((size - 1) / 2);
  for (const spot of spots) {
    check(spot.cell.x !== center || spot.cell.y !== center, `center (${center},${center}) is not a spot in ${size}x${size}`);
  }
}

console.log(">> citySpots tests passed:", n);
