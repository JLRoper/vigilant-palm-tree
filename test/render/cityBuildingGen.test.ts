import { test } from "node:test";
import assert from "node:assert/strict";
import { buildingFootprintFromRegistry } from "@heroes/engine";
import type { BuildingDef } from "@heroes/contracts";
import { generateBuildings, type GenerationConfig } from "../../src/render/cityBuildingGen";

function covers(b: BuildingDef, gx: number, gy: number): boolean {
  const fp = buildingFootprintFromRegistry(b.kind, b.level);
  const w = b.w ?? fp.w;
  const h = b.h ?? fp.h;
  return gx >= b.gx && gx < b.gx + w && gy >= b.gy && gy < b.gy + h;
}

function hasClearNonCenter2x2(
  buildings: BuildingDef[],
  size: number,
  center: { gx: number; gy: number },
): boolean {
  for (let gx = 0; gx + 2 <= size; gx++) {
    for (let gy = 0; gy + 2 <= size; gy++) {
      if (gx <= center.gx && center.gx < gx + 2 && gy <= center.gy && center.gy < gy + 2) continue;
      let occupied = false;
      for (let dx = 0; dx < 2 && !occupied; dx++) {
        for (let dy = 0; dy < 2; dy++) {
          if (buildings.some((b) => covers(b, gx + dx, gy + dy))) {
            occupied = true;
            break;
          }
        }
      }
      if (!occupied) return true;
    }
  }
  return false;
}

function denseUrban(seed: number, style: GenerationConfig["style"], size: 5 | 10 = 5): BuildingDef[] {
  return generateBuildings({
    size,
    pattern: "denseUrban",
    style,
    seed,
    townHallAt: { gx: Math.floor(size / 2), gy: Math.floor(size / 2) },
  });
}

test("denseUrban always leaves at least one fully-clear non-center 2x2 block (seeds 1..50, F16c)", () => {
  for (const style of ["classic", "organic", "blocky"] as const) {
    for (let seed = 1; seed <= 50; seed++) {
      const buildings = denseUrban(seed, style);
      assert.ok(
        hasClearNonCenter2x2(buildings, 5, { gx: 2, gy: 2 }),
        `seed ${seed} style ${style} has no clear non-center 2x2 block`,
      );
    }
  }
});

test("the guarantee also holds at 10x10 (seeds 1..20)", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const buildings = denseUrban(seed, "classic", 10);
    assert.ok(
      hasClearNonCenter2x2(buildings, 10, { gx: 5, gy: 5 }),
      `seed ${seed} (10x10) has no clear non-center 2x2 block`,
    );
  }
});

test("same seed produces the identical layout (carve included)", () => {
  const a = denseUrban(7, "classic");
  const b = denseUrban(7, "classic");
  assert.deepEqual(a, b);
  assert.notDeepEqual(denseUrban(7, "classic"), denseUrban(8, "classic"), "different seeds should differ (sanity)");
});

test("the carve never demolishes the town hall", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const buildings = denseUrban(seed, "classic");
    assert.ok(
      buildings.some((b) => b.kind === "townHall"),
      `seed ${seed} lost its town hall`,
    );
  }
});

test("other patterns are untouched by the carve hook", () => {
  for (const pattern of ["sparseRural", "radial", "grid", "clustered", "sampler"] as const) {
    const a = generateBuildings({ size: 5, pattern, style: "classic", seed: 3, townHallAt: { gx: 2, gy: 2 } });
    const b = generateBuildings({ size: 5, pattern, style: "classic", seed: 3, townHallAt: { gx: 2, gy: 2 } });
    assert.ok(a.length > 0, `${pattern} should still generate buildings`);
    assert.deepEqual(a, b, `${pattern} must stay deterministic`);
  }
});
