import { test } from "node:test";
import assert from "node:assert/strict";
import { settings, updateSettings } from "../../../src/state/settings";
import { TOOLBAR_THEMES } from "../../../src/state/toolbarThemes";
import { applyToolbarTheme, attachToolbarTheme } from "../../../src/screens/shared/toolbarTheme";

function makeTarget(): { target: { setProperty(property: string, value: string): void }; values: Map<string, string> } {
  const values = new Map<string, string>();
  return { target: { setProperty: (property, value) => values.set(property, value) }, values };
}

test("applyToolbarTheme writes the complete selected token set", () => {
  const { target, values } = makeTarget();
  applyToolbarTheme("classic-blue", target);
  assert.deepEqual([...values.keys()].sort(), Object.keys(TOOLBAR_THEMES["classic-blue"].tokens).sort());
  assert.equal(values.get("--tb-bg-top"), "#1c2f57");
  assert.equal(values.get("--tb-font"), "Georgia, Cambria, \"Times New Roman\", serif");
});

test("attachToolbarTheme applies the current style and reacts until detached", () => {
  const { target, values } = makeTarget();
  updateSettings({ toolbarStyle: "classic-blue" });
  const detach = attachToolbarTheme(target);
  try {
    assert.equal(settings().toolbarStyle, "classic-blue");
    assert.equal(values.get("--tb-bg-top"), "#1c2f57");

    updateSettings({ toolbarStyle: "modern" });
    assert.equal(values.get("--tb-bg-top"), TOOLBAR_THEMES.modern.tokens["--tb-bg-top"]);

    detach();
    updateSettings({ toolbarStyle: "classic-blue" });
    assert.equal(values.get("--tb-bg-top"), TOOLBAR_THEMES.modern.tokens["--tb-bg-top"]);
  } finally {
    detach();
    updateSettings({ toolbarStyle: "modern" });
  }
});
