import { FloatingPanel, anchorPanelToBottom, clampPanelIntoView } from "./panel";
import { toolbarHeight } from "./panelRail";
import type { PanelGeometry } from "./panelLayout";

// Shared positioning policy for the docked info panels (hero / settlement):
// a panel starts anchored below the toolbar on the left edge; once the player
// drags it, their position wins and reposition() only clamps it back into
// view instead of re-anchoring.
export class DockedPanel {
  private userMoved = false;

  constructor(private menu: FloatingPanel, private panelX: number, restore?: PanelGeometry | null) {
    if (restore) {
      this.userMoved = true;
      this.menu.setPosition(restore.x, restore.y);
    }
  }

  markUserMoved(): void {
    this.userMoved = true;
  }

  reposition(visible: boolean): void {
    if (!visible) return;
    const minTop = toolbarHeight();
    if (this.userMoved) clampPanelIntoView(this.menu, minTop);
    else anchorPanelToBottom(this.menu, this.panelX, minTop);
  }
}
