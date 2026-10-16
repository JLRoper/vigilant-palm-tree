import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_Z_RAISE_BASE,
  panelStackSizeForTest,
  raisePanel,
  removePanel,
  resetPanelStackForTest,
  type StackablePanel,
} from "../../../src/screens/shared/panelStack";

class FakePanel implements StackablePanel {
  z: number | null = null;
  setPanelZ(z: number): void {
    this.z = z;
  }
}

function fresh(count: number): FakePanel[] {
  return Array.from({ length: count }, () => new FakePanel());
}

test("raise assigns sequential z values starting at the raise base", () => {
  resetPanelStackForTest();
  const [a, b] = fresh(2);
  raisePanel(a);
  raisePanel(b);
  assert.equal(a.z, PANEL_Z_RAISE_BASE);
  assert.equal(b.z, PANEL_Z_RAISE_BASE + 1);
});

test("re-raising a panel moves it above every panel raised earlier", () => {
  resetPanelStackForTest();
  const [a, b, c] = fresh(3);
  raisePanel(a);
  raisePanel(b);
  raisePanel(c);
  raisePanel(a);
  assert.ok(a.z! > b.z! && a.z! > c.z!, "the re-clicked panel must sit on top");
  assert.ok(c.z! > b.z!, "earlier click order is preserved below the raised panel");
});

test("raising the same panel twice does not grow the registry", () => {
  resetPanelStackForTest();
  const [a] = fresh(1);
  raisePanel(a);
  raisePanel(a);
  assert.equal(panelStackSizeForTest(), 1);
});

test("removing a closed panel drops it from the registry", () => {
  resetPanelStackForTest();
  const [a, b] = fresh(2);
  raisePanel(a);
  raisePanel(b);
  removePanel(a);
  assert.equal(panelStackSizeForTest(), 1);
});

test("renormalization keeps long sessions inside the raise band", () => {
  resetPanelStackForTest();
  const panels = fresh(3);
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
