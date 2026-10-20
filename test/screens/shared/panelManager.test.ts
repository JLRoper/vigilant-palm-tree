import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_Z_RAISE_BASE,
  closeTopPanelOnEscape,
  escapeTarget,
  panelManagerSizeForTest,
  raisePanel,
  registerPanel,
  resetPanelManagerForTest,
  unregisterPanel,
  type ManagedPanel,
} from "../../../src/screens/shared/panelManager";

// The manager is the one place Escape is handled: every FloatingPanel
// registers here, so "Escape closes the panel" is a property of the system
// rather than a keydown listener copy-pasted into each screen. These tests pin
// the stacking order and the four Escape rules:
//   topmost only, hidden panels skipped, opt-outs skipped, nested state wins.

class FakePanel implements ManagedPanel {
  z: number | null = null;
  visible = true;
  escapeClosable = true;
  dismissed = 0;
  closed = 0;
  consumeEscape = false;

  constructor(readonly name: string) {}

  dismiss(): void {
    this.dismissed += 1;
    this.visible = false;
  }

  close(): void {
    this.closed += 1;
  }

  setPanelZ(z: number): void {
    this.z = z;
  }

  isPanelVisible(): boolean {
    return this.visible;
  }

  handleEscape(): boolean {
    if (!this.consumeEscape) return false;
    // A nested state that owns the key (an active build placement) does not
    // dismiss the panel on the first Escape.
    this.consumeEscape = false;
    return true;
  }
}

function fresh(...names: string[]): FakePanel[] {
  return names.map((name) => new FakePanel(name));
}

test("raise assigns sequential z values starting at the raise base", () => {
  resetPanelManagerForTest();
  const [a, b] = fresh("a", "b");
  raisePanel(a);
  raisePanel(b);
  assert.equal(a.z, PANEL_Z_RAISE_BASE);
  assert.equal(b.z, PANEL_Z_RAISE_BASE + 1);
});

test("re-raising a panel moves it above every panel raised earlier", () => {
  resetPanelManagerForTest();
  const [a, b, c] = fresh("a", "b", "c");
  raisePanel(a);
  raisePanel(b);
  raisePanel(c);
  raisePanel(a);
  assert.ok(a.z! > b.z! && a.z! > c.z!, "the re-clicked panel must sit on top");
  assert.ok(c.z! > b.z!, "earlier click order is preserved below the raised panel");
});

test("raising the same panel twice does not grow the registry", () => {
  resetPanelManagerForTest();
  const [a] = fresh("a");
  raisePanel(a);
  raisePanel(a);
  assert.equal(panelManagerSizeForTest(), 1);
});

test("unregistering a closed panel drops it from the registry", () => {
  resetPanelManagerForTest();
  const [a, b] = fresh("a", "b");
  raisePanel(a);
  raisePanel(b);
  unregisterPanel(a);
  assert.equal(panelManagerSizeForTest(), 1);
});

test("renormalization keeps long sessions inside the raise band", () => {
  resetPanelManagerForTest();
  const panels = fresh("a", "b", "c");
  for (let round = 0; round < 20; round++) {
    for (const panel of panels) raisePanel(panel);
    for (const panel of panels) {
      assert.ok(
        panel.z !== null && panel.z >= PANEL_Z_RAISE_BASE && panel.z <= 88,
        `z ${panel.z} escaped the raise band [${PANEL_Z_RAISE_BASE}, 88]`,
      );
    }
    assert.ok(panels[2].z! >= panels[0].z! && panels[2].z! >= panels[1].z!);
  }
});

test("Escape dismisses exactly one panel: the topmost open one", () => {
  resetPanelManagerForTest();
  const [below, above] = fresh("below", "above");
  registerPanel(below);
  registerPanel(above);

  assert.equal(closeTopPanelOnEscape(), true, "the key was handled");
  assert.equal(above.dismissed, 1, "the topmost panel closes");
  assert.equal(below.dismissed, 0, "the one underneath is untouched");
});

test("Escape dismisses, it does not destroy: a re-shown panel survives", () => {
  resetPanelManagerForTest();
  const [panel] = fresh("panel");
  registerPanel(panel);
  closeTopPanelOnEscape();
  assert.equal(panel.dismissed, 1);
  assert.equal(panel.closed, 0, "hideOnDismiss panels must not be torn down");
});

test("a hidden long-lived panel never swallows Escape", () => {
  resetPanelManagerForTest();
  const [hidden, shown] = fresh("hidden", "shown");
  registerPanel(hidden);
  registerPanel(shown);
  hidden.visible = false;

  assert.equal(escapeTarget(), shown, "the hidden panel is not the target");
  assert.equal(closeTopPanelOnEscape(), true);
  assert.equal(hidden.dismissed, 0);
  assert.equal(shown.dismissed, 1);
});

test("a hidden panel alone lets the key fall through to the view", () => {
  resetPanelManagerForTest();
  const [hidden] = fresh("hidden");
  registerPanel(hidden);
  hidden.visible = false;

  assert.equal(closeTopPanelOnEscape(), false, "nothing handled it, so the view's own ladder runs");
  assert.equal(hidden.dismissed, 0);
});

test("a panel that must outlive Escape is skipped, exposing the one below", () => {
  resetPanelManagerForTest();
  const [sticky, normal] = fresh("sticky", "normal");
  registerPanel(sticky);
  registerPanel(normal);
  sticky.escapeClosable = false;

  assert.equal(escapeTarget(), normal);
  closeTopPanelOnEscape();
  assert.equal(sticky.dismissed, 0, "the city-owned panel is never closed by Escape");
  assert.equal(normal.dismissed, 1);
});

test("nested state consumes the first Escape without dismissing the panel", () => {
  resetPanelManagerForTest();
  const [palette] = fresh("palette");
  registerPanel(palette);
  palette.consumeEscape = true;

  assert.equal(closeTopPanelOnEscape(), true, "the key was handled");
  assert.equal(palette.dismissed, 0, "the palette stays open; only the placement cancelled");

  assert.equal(closeTopPanelOnEscape(), true);
  assert.equal(palette.dismissed, 1, "the next Escape closes the palette");
});

test("with no panels open Escape is not claimed", () => {
  resetPanelManagerForTest();
  assert.equal(closeTopPanelOnEscape(), false);
});
