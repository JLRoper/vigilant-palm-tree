export const DRAG_MOVE_THRESHOLD = 4;

export class DragTracker {
  private active = false;
  private startX = 0;
  private startY = 0;
  private lastX_ = 0;
  private lastY_ = 0;
  private movedFlag = false;

  begin(x: number, y: number): void {
    this.active = true;
    this.startX = x;
    this.startY = y;
    this.lastX_ = x;
    this.lastY_ = y;
    this.movedFlag = false;
  }

  moveTo(x: number, y: number): { dx: number; dy: number } {
    const dx = x - this.lastX_;
    const dy = y - this.lastY_;
    this.lastX_ = x;
    this.lastY_ = y;
    if (
      !this.movedFlag &&
      Math.abs(x - this.startX) + Math.abs(y - this.startY) > DRAG_MOVE_THRESHOLD
    ) {
      this.movedFlag = true;
    }
    return { dx, dy };
  }

  get moved(): boolean {
    return this.movedFlag;
  }

  consumeMoved(): boolean {
    const m = this.movedFlag;
    this.movedFlag = false;
    return m;
  }

  reset(): void {
    this.movedFlag = false;
  }

  get lastX(): number {
    return this.lastX_;
  }

  get lastY(): number {
    return this.lastY_;
  }

  isActive(): boolean {
    return this.active;
  }

  end(): void {
    this.active = false;
  }
}
