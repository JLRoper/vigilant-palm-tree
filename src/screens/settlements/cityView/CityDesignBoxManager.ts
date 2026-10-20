import { FloatingPanel, styleButton, createPanel } from "@screens/shared/panel";
import { loadPanelGeometry } from "@screens/shared/panelLayout";
import { toolbarHeight } from "@screens/shared/panelRail";
import {
  DESIGN_BOX_INSET,
  collectPanelRects,
  resolveDesignBoxPlacement,
  type FloatingPanelRectProvider,
} from "./panelRects";

const PANEL_GEOMETRY_KEY = "cityDesign";
const PANEL_WIDTH = 150;

export interface CityDesignBoxCallbacks {
  onBuild: () => void;
  onWorkforce: () => void;
  onRecruit: () => void;
  onBack: () => void;
}

/**
 * The city view's "City Design" panel: Build / Workforce / Recruit / Back.
 *
 * It is a normal floating menu (`FloatingPanel`) like the workforce and recruitment
 * panels -- draggable, click-to-front, resizeable, and its position is
 * remembered per panel. It has no close button on purpose: the city view owns
 * its lifetime, and closing it would leave the player without the Build or Back
 * controls (there is no toolbar entry that reopens it).
 */
export class CityDesignBoxManager {
  private menu: FloatingPanel | null = null;
  private buildBtn: HTMLButtonElement | null = null;

  show(callbacks: CityDesignBoxCallbacks, panelRects?: FloatingPanelRectProvider): void {
    this.hide();

    const stored = loadPanelGeometry(PANEL_GEOMETRY_KEY);
    const menu = createPanel({
      parent: document.body,
      title: "City Design",
      key: PANEL_GEOMETRY_KEY,
      width: PANEL_WIDTH,
      defaultPosition: { x: DESIGN_BOX_INSET, y: toolbarHeight() + 16 },
      minTop: toolbarHeight,
      zIndex: 76,
      closeable: false,
      draggable: true,
      // The city view owns this panel's lifetime and nothing else reopens it:
      // closing it on Escape would strand the player without Build/Back, so
      // Escape falls through to the city view (which closes the whole city,
      // box included).
      escapeClosable: false,
    });
    this.menu = menu;

    this.buildBtn = this.addButton(menu, "⚒ Build", "Open the building palette (b)", callbacks.onBuild);
    this.addButton(menu, "♟ Workforce", "Open the worker assignment panel (w)", callbacks.onWorkforce);
    this.addButton(menu, "⚔ Recruit", "Open the recruitment panel (r)", callbacks.onRecruit);
    this.addButton(menu, "← Back", "Leave the city view", callbacks.onBack);

    // First open lands bottom-left, clear of whatever floating panels are up
    // (the City Design box is the one panel that exists on every city open, so
    // its default must never bury the others). A remembered position wins.
    if (!stored) this.placeFirstOpen(menu, panelRects);
  }

  private addButton(
    menu: FloatingPanel,
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = title;
    styleButton(btn);
    btn.style.width = "100%";
    btn.addEventListener("click", () => onClick());
    menu.appendContent(btn);
    return btn;
  }

  private placeFirstOpen(menu: FloatingPanel, panelRects?: FloatingPanelRectProvider): void {
    const measured = menu.root.getBoundingClientRect();
    if (measured.width <= 0 || measured.height <= 0) return;
    const resolved = resolveDesignBoxPlacement(
      measured.width,
      measured.height,
      collectPanelRects(panelRects),
      { width: window.innerWidth, height: window.innerHeight },
      toolbarHeight(),
    );
    menu.setPosition(resolved.x, resolved.y);
  }

  setBuildPaletteOpen(isOpen: boolean): void {
    if (!this.buildBtn) return;
    this.buildBtn.textContent = isOpen ? "✖ Close" : "⚒ Build";
    this.buildBtn.style.background = isOpen ? "rgba(120,40,40,0.7)" : "rgba(0,0,0,0.6)";
  }

  hide(): void {
    this.menu?.close();
    this.menu = null;
    this.buildBtn = null;
  }

  isOpen(): boolean {
    return this.menu !== null;
  }

  /** The panel element, for collision-aware placement of other floating panels; null while hidden. */
  getElement(): HTMLDivElement | null {
    return this.menu?.root ?? null;
  }
}
