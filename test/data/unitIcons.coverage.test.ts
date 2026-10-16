// Coverage guard: every unit-catalog id must have a dedicated icon PNG under
// src/resources/units/icons/ and must be wired in src/data/unitImages.ts's
// KNOWN map, so a future catalog/wiring change can't ship icon-less tiles.
//
// This test deliberately does NOT import src/data/unitImages.ts: that module
// uses Vite's ?url PNG imports, which crash under bare node:test/tsx (Node has
// no loader for .png specifiers outside Vite's bundler). Coverage is asserted
// from the filesystem plus a source scan instead, mirroring the source-scan
// coverage-guard style used in test/state/turnController.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UNIT_CATALOG_IDS } from "../helpers/unitIds";

// No deliberate gaps: every unit-catalog id must ship its dedicated icon bust.
const EXPECTED_ICON_GAPS: readonly string[] = [];

const UNIT_ICON_IDS = UNIT_CATALOG_IDS.filter(
  (id) => !EXPECTED_ICON_GAPS.includes(id),
);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function iconPath(id: string): string {
  return fileURLToPath(new URL(`../../src/resources/units/icons/${id}.png`, import.meta.url));
}

test("every unit id has a non-empty icon PNG on disk", () => {
  for (const id of UNIT_ICON_IDS) {
    const path = iconPath(id);
    assert.ok(statSync(path).isFile(), `${id}.png is missing from src/resources/units/icons/`);
    assert.ok(statSync(path).size > 0, `${id}.png is empty`);
  }
});

test("every unit icon file is a valid PNG (signature header)", () => {
  for (const id of UNIT_ICON_IDS) {
    const head = readFileSync(iconPath(id)).subarray(0, PNG_SIGNATURE.length);
    assert.ok(head.equals(PNG_SIGNATURE), `${id}.png does not start with a PNG signature`);
  }
});

test("unitImages.ts wires every unit id to its icons-folder PNG", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../src/data/unitImages.ts", import.meta.url)),
    "utf8",
  );
  for (const id of UNIT_ICON_IDS) {
    assert.ok(
      source.includes(`../resources/units/icons/${id}.png?url`),
      `src/data/unitImages.ts does not import ../resources/units/icons/${id}.png?url`,
    );
  }
});
