import { TILE_W, TILE_D, cellOrigin, type CityViewSize } from "../core/cityGrid";
import { computeCityScale, drawCityView } from "../render/cityRenderer";

export class CityView {
  private backBtn: HTMLButtonElement | null = null;
  private openSettlementId: string | null = null;
  private settlementName = "";
  private size: CityViewSize = 5;
  private ownerColor = "#888888";
  private hover: { gx: number; gy: number } | null = null;
  private onClose: () => void;
  private onKeyDown: (e: KeyboardEvent) => void;

  constructor(opts: { onClose: () => void }) {
    this.onClose = opts.onClose;
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.handleClose();
    };
  }

  open(settlementId: string, name: string, size: CityViewSize, ownerColor: string): void {
    this.openSettlementId = settlementId;
    this.settlementName = name;
    this.size = size;
    this.ownerColor = ownerColor;
    this.hover = null;

    this.backBtn = document.createElement("button");
    this.backBtn.textContent = "\u2190 Back";
    Object.assign(this.backBtn.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "100",
      padding: "4px 12px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(0,0,0,0.7)",
      color: "#fff",
      fontSize: "12px",
      cursor: "pointer",
      borderRadius: "3px",
      fontFamily: "system-ui, sans-serif",
    });
    this.backBtn.addEventListener("click", () => this.handleClose());
    document.body.appendChild(this.backBtn);

    window.addEventListener("keydown", this.onKeyDown);
  }

  isOpen(): boolean {
    return this.openSettlementId !== null;
  }

  draw(ctx: CanvasRenderingContext2D, viewportW: number, viewportH: number): void {
    if (!this.isOpen()) return;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, viewportW, viewportH);
    ctx.restore();
    drawCityView(ctx, {
      viewportW,
      viewportH,
      settlementName: this.settlementName,
      size: this.size,
      hover: this.hover,
      ownerColor: this.ownerColor,
    });
  }

  updateMouse(canvasX: number, canvasY: number): void {
    if (!this.isOpen()) {
      this.hover = null;
      return;
    }
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const tileScale = computeCityScale(this.size, viewportW, viewportH);
    const tw = TILE_W * tileScale;
    const td = TILE_D * tileScale;
    const origin = cellOrigin(this.size);

    const wdx = canvasX - viewportW / 2 - origin.x * tileScale;
    const wdy = canvasY - viewportH / 2 - origin.y * tileScale;

    const gxf = wdx / tw + wdy / td;
    const gyf = wdy / td - wdx / tw;
    const gx = Math.floor(gxf);
    const gy = Math.floor(gyf);

    if (gx < 0 || gx >= this.size || gy < 0 || gy >= this.size) {
      this.hover = null;
    } else {
      this.hover = { gx, gy };
    }
  }

  close(): string | null {
    return this.handleClose();
  }

  private handleClose(): string | null {
    if (this.backBtn) {
      this.backBtn.remove();
      this.backBtn = null;
    }
    window.removeEventListener("keydown", this.onKeyDown);
    const id = this.openSettlementId;
    this.openSettlementId = null;
    this.hover = null;
    this.onClose();
    return id;
  }
}
