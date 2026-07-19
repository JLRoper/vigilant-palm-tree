import { Axial, axialToPixel, hexCorners, pixelToAxial, HEX_SIZE } from "../core/hex";
import { Camera } from "./camera";
import { Hero } from "../entities/hero";
import { drawHeroSprite, drawCastleSprite } from "./sprites";
import { Castle, CASTLES } from "../entities/settlement";
import { GameMap } from "../map/gameMap";
import { TERRAIN_COLORS, Terrain } from "../map/terrain";

export class Renderer {
  constructor(
    private ctx: CanvasRenderingContext2D,
    public map: GameMap,
    private camera: Camera
  ) {}

  draw(hover: Axial | null, heroes: Hero[], path: Axial[], castles: Castle[] = CASTLES) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    this.camera.apply(ctx);

    for (let r = 0; r < this.map.height; r++) {
      for (let q = 0; q < this.map.width; q++) {
        const t = this.map.get(q, r);
        if (!t) continue;
        const { x, y } = axialToPixel(q, r);
        this.drawHex(x, y, t);
        this.drawDecoration(q, r, x, y, t);
      }
    }

    for (const c of castles) {
      const { x, y } = axialToPixel(c.tile.q, c.tile.r);
      drawCastleSprite(ctx, c.level, x, y, HEX_SIZE);
    }

    if (path.length > 0 && heroes.length > 0) {
      const player = heroes.find((h) => h.faction === "player");
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255, 204, 0, 0.7)";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      if (player) {
        const start = axialToPixel(player.tile.q, player.tile.r);
        ctx.moveTo(start.x, start.y);
      }
      for (const t of path) {
        const p = axialToPixel(t.q, t.r);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      for (const t of path) {
        const p = axialToPixel(t.q, t.r);
        ctx.fillStyle = "rgba(255, 204, 0, 0.5)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (hover) {
      const { x, y } = axialToPixel(hover.q, hover.r);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffcc00";
      const corners = hexCorners(x, y);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
    }

    for (const hero of heroes) {
      const { x, y } = axialToPixel(hero.tile.q, hero.tile.r);
      drawHeroSprite(ctx, x + hero.pixelOffset.x, y + hero.pixelOffset.y, 18, hero.faction);
      ctx.fillStyle = hero.faction === "player" ? "#ffcc00" : "#ff4444";
      ctx.beginPath();
      ctx.arc(x + hero.pixelOffset.x, y + hero.pixelOffset.y + 22, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    this.drawMinimap(heroes, path);
  }

  private drawHex(cx: number, cy: number, t: Terrain) {
    const ctx = this.ctx;
    const corners = hexCorners(cx, cy);
    const colors = TERRAIN_COLORS[t];
    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawDecoration(q: number, r: number, cx: number, cy: number, t: Terrain) {
    const ctx = this.ctx;
    const seed = decorationSeed(q, r) - Math.floor(decorationSeed(q, r));
    const ox = ((seed - 0.5) * 14);
    const oy = (((decorationSeed(q + 7, r - 3)) % 1) - 0.5) * 10;

    if (t === "forest") {
      ctx.fillStyle = "#0d2a14";
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy - 10);
      ctx.lineTo(cx + ox - 8, cy + oy + 6);
      ctx.lineTo(cx + ox + 8, cy + oy + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#5a3a1a";
      ctx.fillRect(cx + ox - 1.5, cy + oy + 5, 3, 4);
    } else if (t === "water") {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, 4, 0.2 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    }
  }

  private drawMinimap(heroes: Hero[], path: Axial[]) {
    const ctx = this.ctx;
    const mmW = 180;
    const mmH = (this.map.height / this.map.width) * mmW;
    const pad = 10;
    const x0 = window.innerWidth - mmW - pad;
    const y0 = window.innerHeight - mmH - pad;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x0 - 4, y0 - 4, mmW + 8, mmH + 8);

    const cellW = mmW / this.map.width;
    const cellH = mmH / this.map.height;

    for (let r = 0; r < this.map.height; r++) {
      for (let q = 0; q < this.map.width; q++) {
        const t = this.map.get(q, r);
        if (!t) continue;
        ctx.fillStyle = TERRAIN_COLORS[t].fill;
        ctx.fillRect(x0 + q * cellW, y0 + r * cellH, cellW + 0.5, cellH + 0.5);
      }
    }

    if (path.length > 0) {
      ctx.fillStyle = "rgba(255,204,0,0.5)";
      for (const t of path) {
        ctx.fillRect(x0 + t.q * cellW, y0 + t.r * cellH, cellW, cellH);
      }
    }

    for (const hero of heroes) {
      ctx.fillStyle = hero.faction === "player" ? "#ffcc00" : "#ff4444";
      ctx.fillRect(
        x0 + hero.tile.q * cellW - 1,
        y0 + hero.tile.r * cellH - 1,
        cellW + 2,
        cellH + 2
      );
    }

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 4, y0 - 4, mmW + 8, mmH + 8);
    ctx.restore();
  }

  hoverFromScreen(sx: number, sy: number): Axial | null {
    const wx = (sx - this.camera.x) / this.camera.zoom;
    const wy = (sy - this.camera.y) / this.camera.zoom;
    const { q, r } = pixelToAxial(wx, wy);
    if (q < 0 || q >= this.map.width || r < 0 || r >= this.map.height) return null;
    return { q, r };
  }
}

function decorationSeed(q: number, r: number): number {
  return Math.sin(q * 91.71 + r * 43.17) * 43758.5453;
}
