import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clampToolbarStyle,
  TOOLBAR_THEMES,
  toolbarStyleOptions,
} from "../../src/state/toolbarThemes";

test("toolbar style options and labels come from the theme registry", () => {
  assert.deepEqual(toolbarStyleOptions(), ["modern", "classic-blue"]);
  assert.equal(TOOLBAR_THEMES.modern.label, "Modern");
  assert.equal(TOOLBAR_THEMES["classic-blue"].label, "Classic Blue");
  assert.equal(clampToolbarStyle("unknown"), "modern");
});

test("every toolbar theme supplies the full CSS token set", () => {
  const expected = Object.keys(TOOLBAR_THEMES.modern.tokens).sort();
  assert.equal(TOOLBAR_THEMES["classic-blue"].tokens["--tb-bg-top"], "#1c2f57");
  assert.equal(TOOLBAR_THEMES["classic-blue"].tokens["--tb-bg-bottom"], "#142145");
  assert.equal(TOOLBAR_THEMES["classic-blue"].tokens["--tb-accent"], "#c9a227");
  assert.equal(TOOLBAR_THEMES["classic-blue"].tokens["--tb-accent-light"], "#e9cf7d");
  assert.equal(TOOLBAR_THEMES["classic-blue"].tokens["--tb-text"], "#f1e4c3");
  assert.match(TOOLBAR_THEMES["classic-blue"].tokens["--tb-font"], /Georgia.*Cambria.*Times New Roman.*serif/);

  for (const style of toolbarStyleOptions()) {
    assert.deepEqual(Object.keys(TOOLBAR_THEMES[style].tokens).sort(), expected);
  }
});

test("index.html :root fallback tokens match the modern theme registry", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const block = html.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(block, "index.html must declare a :root block with the toolbar fallback tokens");

  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const sortKeys = (tokens: Record<string, string>) =>
    Object.fromEntries(Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b)));

  const htmlTokens: Record<string, string> = {};
  for (const match of block[1].matchAll(/(--tb-[\w-]+)\s*:\s*([^;]+);/g)) {
    htmlTokens[match[1]] = normalize(match[2]);
  }

  const registryTokens = Object.fromEntries(
    Object.entries(TOOLBAR_THEMES.modern.tokens).map(([key, value]) => [key, normalize(value)] as const),
  );

  assert.deepEqual(sortKeys(htmlTokens), sortKeys(registryTokens));
});
