import { test } from "node:test";
import assert from "node:assert/strict";
import { farmFieldStyleAt, pickStyleForBuilding, randomFarmFieldStyle } from "@heroes/engine";

function isFarmStyle(style: unknown): style is "pixel" | "pixel-alt" {
  return style === "pixel" || style === "pixel-alt";
}

test("farmField resolves to the pixel style now that the classic farm art is unwired", () => {
  assert.equal(pickStyleForBuilding("farmField", 1, "classic"), "pixel");
  assert.equal(pickStyleForBuilding("farmField", 2, "classic"), "pixel");
  assert.equal(pickStyleForBuilding("farmField", 3, "classic"), "pixel");
});

test("pixel-alt stays out of the style fall-through: only an explicit carrier yields it", () => {
  assert.notEqual(pickStyleForBuilding("farmField", 1, "classic"), "pixel-alt");
  assert.equal(pickStyleForBuilding("granary", 1, "classic"), "pixel");
});

test("farmFieldStyleAt is deterministic per settlement+cell and only returns the two farm styles", () => {
  for (const [seed, gx, gy] of [["Home", 0, 2], ["Home", 3, 0], ["Keep-1", 1, 3], ["Keep-1", 0, 2]] as const) {
    const style = farmFieldStyleAt(seed, gx, gy);
    assert.ok(isFarmStyle(style), `${style} is a farm sprite style`);
    assert.equal(farmFieldStyleAt(seed, gx, gy), style);
  }
});

test("farmFieldStyleAt varies across a starter-farm-sized ring", () => {
  const styles = new Set<string>();
  for (let gx = 0; gx < 10; gx++) {
    for (let gy = 0; gy < 10; gy++) {
      styles.add(farmFieldStyleAt("Keep-1", gx, gy));
    }
  }
  assert.ok(styles.has("pixel") && styles.has("pixel-alt"), "both farm styles appear over a 10x10 spread");
});

test("randomFarmFieldStyle only returns the two farm styles", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const style = randomFarmFieldStyle();
    assert.ok(isFarmStyle(style));
    seen.add(style);
  }
  assert.ok(seen.size === 2, "both styles appear over 100 rolls");
});
