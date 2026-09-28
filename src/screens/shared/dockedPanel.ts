import { PopupMenu, anchorMenuToBottom, clampMenuIntoView } from "./menu";
import { toolbarHeight } from "./panelRail";

// Shared positioning policy for the docked info panels (hero / settlement):
// a panel starts anchored below the toolbar on the left edge; once the player
// drags it, their position wins and reposition() only clamps it back into
// view instead of re-anchoring.
export class DockedPanel {
  private userMoved = false;

  constructor(private menu: PopupMenu, private panelX: number) {}

  markUserMoved(): void {
    this.userMoved = true;
  }

  reposition(visible: boolean): void {
    if (!visible) return;
    const minTop = toolbarHeight();
    if (this.userMoved) clampMenuIntoView(this.menu, minTop);
    else anchorMenuToBottom(this.menu, this.panelX, minTop);
  }
}
