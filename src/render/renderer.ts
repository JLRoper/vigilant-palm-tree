import { Axial, axialToPixel, hexCorners, pixelToAxial, HEX_SIZE } from "../core/hex";
import { Camera } from "./camera";
import { Hero } from "../entities/hero";
import { drawHeroSprite, drawHorseSprite, drawCastleSprite } from "./sprites";
import { Castle } from "../entities/settlement";
import { GameMap } from "../map/gameMap";
import { TERRAIN_COLORS, Terrain } from "../map/terrain";
import { drawResourceIcons } from "./overlays/resourceIcon";
import { drawTerritoryOutlines } from "./overlays/territoryOutline";
import { drawPathOverlay, drawMinimapPath } from "./overlays/pathOverlay";
import { SpriteProvider } from "./assets";
import { computeVision, isVisible } from "./fog";
import { settings } from "../state/settings";
import type { CharterState } from "../state/gameState";

export interface RenderOptions {
  selectedHeroId: string | null;
  selectedSettlementId: string | null;
  colorForOwner: (ownerId: number | null) => string;
  viewPlayerId: number;
  /** If provided, overrides the reachable split computed from movementRemaining. Use this to keep the proposed yellow route stable while a hero animates a committed move. */
  pathReachableIdx?: number;
  /** If provided, anchors the yellow proposed route to this tile instead of the hero's current (moving) tile. */
  pathOrigin?: Axial;
  /** Fallback origin when pathOrigin is not set. Use the selected hero's tile from game state. */
  selectedHeroTile?: Axial;
  /** Charter targets for overlay rendering. */
  activeCharters?: readonly CharterState[];
  /** Valid hexes for charter placement mode. */
  validCharterHexes?: Set<string> | null;
}

const FOG_FILL = "rgba(8, 10, 16, 0.78)";
const FOG_EDGE = "rgba(8, 10, 16, 0.55)";

export class Renderer {
  constructor(
    private ctx: CanvasRenderingContext2D,
    public map: GameMap,
    private camera: Camera,
    private sprites: SpriteProvider
  ) {}

  draw(
    hover: Axial | null,
    heroes: Hero[],
    path: Axial[],
    castles: readonly Castle[],
    opts: RenderOptions,
  ) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    const visible = computeVision(heroes, castles, opts.viewPlayerId);

    ctx.save();
    this.camera.apply(ctx);

    for (let r = 0; r < this.map.height; r++) {
      for (let q = 0; q < this.map.width; q++) {
        const t = this.map.get(q, r);
        if (!t) continue;
        const { x, y } = axialToPixel(q, r);
        this.drawHex(x, y, t);
        this.drawDecoration(q, r, x, y, t);
        if (!isVisible(visible, q, r)) {
          this.drawFogHex(x, y);
        }
      }
    }

    drawResourceIcons(ctx, this.sprites, this.map, visible);

    if (opts.activeCharters && opts.activeCharters.length > 0) {
      this.drawCharterOverlays(ctx, opts.activeCharters, visible);
    }

    if (opts.validCharterHexes && opts.validCharterHexes.size > 0) {
      this.drawValidCharterHexes(ctx, opts.validCharterHexes, visible);
    }

    for (const c of castles) {
      const canSee =
        c.ownerId === opts.viewPlayerId || isVisible(visible, c.tile.q, c.tile.r);
      if (!canSee) continue;
      const { x, y } = axialToPixel(c.tile.q, c.tile.r);
      drawCastleSprite(ctx, this.sprites, c.level, x, y, HEX_SIZE);
      this.drawCastleBorder(x, y, c, opts);
    }

    drawTerritoryOutlines(ctx, castles, opts.colorForOwner, this.map.width, this.map.height, visible);

    drawPathOverlay(ctx, heroes, path, this.map, opts);

    if (hover && isVisible(visible, hover.q, hover.r)) {
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

    const horseVariant = settings().horseVariant;

    for (const hero of heroes) {
      const canSee =
        hero.ownerId === opts.viewPlayerId || isVisible(visible, hero.tile.q, hero.tile.r);
      if (!canSee) continue;
      const { x, y } = axialToPixel(hero.tile.q, hero.tile.r);
      const bobAmplitude = 6;
      const phase = hero.moveProgress * Math.PI * 2;
      const bobY = hero.moving ? -Math.sin(phase) * bobAmplitude : 0;
      const scaleY = hero.moving ? 1.0 + 0.06 * Math.sin(phase) : 1.0;

      if (horseVariant === "hero") {
        // Draw detailed knight-on-horse hero sprite with scale animation
        drawHeroSprite(
          ctx,
          this.sprites,
          hero.faction,
          x + hero.pixelOffset.x,
          y + hero.pixelOffset.y + bobY,
          hero.facingDirection,
          HEX_SIZE,
          scaleY
        );
      } else {
        // Draw image-based horse sprite (bubbly, shadow, paladin, ranger, arcane)
        drawHorseSprite(
          ctx,
          this.sprites,
          horseVariant,
          x + hero.pixelOffset.x,
          y + hero.pixelOffset.y + bobY,
          hero.facingDirection,
          HEX_SIZE
        );
      }

      const color = opts.colorForOwner(hero.ownerId);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + hero.pixelOffset.x, y + hero.pixelOffset.y + 22, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (opts.selectedHeroId === hero.id) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x + hero.pixelOffset.x, y + hero.pixelOffset.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();

    this.drawMinimap(heroes, path, opts, visible);
  }

  private drawFogHex(cx: number, cy: number): void {
    const ctx = this.ctx;
    const corners = hexCorners(cx, cy);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fillStyle = FOG_FILL;
    ctx.fill();
    ctx.strokeStyle = FOG_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawCastleBorder(
    cx: number,
    cy: number,
    castle: Castle,
    opts: RenderOptions,
  ): void {
    const ctx = this.ctx;
    const color = opts.colorForOwner(castle.ownerId);
    const isSelected = opts.selectedSettlementId === castle.id;
    const radius = isSelected ? HEX_SIZE * 1.05 : HEX_SIZE * 0.95;
    ctx.beginPath();
    ctx.arc(cx, cy + HEX_SIZE * 0.55, radius, 0, Math.PI * 2);
    if (castle.ownerId === null) {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.setLineDash([4, 4]);
    } else {
      ctx.strokeStyle = color;
      ctx.setLineDash([]);
    }
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();
    ctx.setLineDash([]);
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
    } else if (t === "desert") {
      ctx.strokeStyle = "rgba(80,60,30,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + ox - 7, cy + oy - 2);
      ctx.lineTo(cx + ox - 3, cy + oy - 5);
      ctx.moveTo(cx + ox + 2, cy + oy + 3);
      ctx.lineTo(cx + ox + 6, cy + oy + 1);
      ctx.moveTo(cx + ox - 5, cy + oy + 5);
      ctx.lineTo(cx + ox - 1, cy + oy + 3);
      ctx.stroke();
      ctx.fillStyle = "rgba(120,90,50,0.6)";
      ctx.beginPath();
      ctx.arc(cx + ox + 9, cy + oy + 4, 1, 0, Math.PI * 2);
      ctx.arc(cx + ox - 10, cy + oy - 6, 1, 0, Math.PI * 2);
      ctx.arc(cx + ox + 3, cy + oy - 9, 1, 0, Math.PI * 2);
      ctx.fill();
    } else if (t === "mountain") {
      ctx.fillStyle = "#5a5a64";
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy - 14);
      ctx.lineTo(cx + ox - 14, cy + oy + 8);
      ctx.lineTo(cx + ox + 14, cy + oy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f4f4f8";
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy - 14);
      ctx.lineTo(cx + ox - 4, cy + oy - 6);
      ctx.lineTo(cx + ox + 4, cy + oy - 6);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawCharterOverlays(
    ctx: CanvasRenderingContext2D,
    charters: readonly CharterState[],
    visible: Set<string>,
  ): void {
    for (const charter of charters) {
      if (!isVisible(visible, charter.targetQ, charter.targetR)) continue;
      const { x, y } = axialToPixel(charter.targetQ, charter.targetR);
      const corners = hexCorners(x, y);

      if (charter.phase === "traveling") {
        ctx.strokeStyle = "rgba(200, 180, 140, 0.5)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = "rgba(200, 160, 80, 0.7)";
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
      }

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      if (charter.phase === "traveling") {
        ctx.fillStyle = "rgba(200, 180, 140, 0.15)";
      } else {
        ctx.fillStyle = "rgba(200, 160, 80, 0.2)";
      }
      ctx.fill();

      if (charter.phase === "constructing") {
        const innerSize = HEX_SIZE * 0.5;
        ctx.strokeStyle = "rgba(160, 120, 60, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - innerSize * 0.5, y - innerSize * 0.3);
        ctx.lineTo(x + innerSize * 0.5, y - innerSize * 0.3);
        ctx.lineTo(x, y - innerSize);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - innerSize * 0.5, y - innerSize * 0.3);
        ctx.lineTo(x + innerSize * 0.5, y - innerSize * 0.3);
        ctx.lineTo(x, y + innerSize * 0.2);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  private drawValidCharterHexes(
    ctx: CanvasRenderingContext2D,
    hexes: Set<string>,
    visible: Set<string>,
  ): void {
    for (const key of hexes) {
      const [qs, rs] = key.split(",");
      const q = Number(qs);
      const r = Number(rs);
      if (isNaN(q) || isNaN(r)) continue;
      if (!isVisible(visible, q, r)) continue;
      const { x, y } = axialToPixel(q, r);
      const corners = hexCorners(x, y);
      ctx.strokeStyle = "rgba(100, 220, 100, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(100, 220, 100, 0.08)";
      ctx.fill();
    }
  }

  private drawMinimap(
    heroes: Hero[],
    path: Axial[],
    opts: RenderOptions,
    visible: Set<string>,
  ) {
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
        if (isVisible(visible, q, r)) {
          ctx.fillStyle = TERRAIN_COLORS[t].fill;
        } else {
          ctx.fillStyle = "rgba(0,0,0,0.85)";
        }
        ctx.fillRect(x0 + q * cellW, y0 + r * cellH, cellW + 0.5, cellH + 0.5);
      }
    }

    ctx.fillStyle = "#ffa500";
    for (let r = 0; r < this.map.height; r++) {
      for (let q = 0; q < this.map.width; q++) {
        const t = this.map.resourceTileAt(q, r);
        if (!t) continue;
        if (!isVisible(visible, q, r)) continue;
        ctx.beginPath();
        ctx.arc(
          x0 + (q + 0.78) * cellW,
          y0 + (r + 0.22) * cellH,
          Math.min(cellW, cellH) * 0.22,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    drawMinimapPath(ctx, path, x0, y0, cellW, cellH);

    for (const hero of heroes) {
      if (hero.ownerId !== opts.viewPlayerId && !isVisible(visible, hero.tile.q, hero.tile.r)) continue;
      ctx.fillStyle = opts.colorForOwner(hero.ownerId);
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
