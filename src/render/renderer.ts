import { Axial, axialToPixel, hexCorners, pixelToAxial, HEX_SIZE } from "../core/hex";
import { Camera } from "./camera";
import { Hero } from "../entities/hero";
import { drawHeroSprite, drawHorseSprite, drawCastleSprite } from "./sprites";
import { Castle } from "../entities/settlement";
import { GameMap } from "../map/gameMap";
import { TERRAIN_COLORS, TERRAIN_COST, Terrain } from "../map/terrain";
import { drawResourceIcons } from "./overlays/resourceIcon";
import { SpriteProvider } from "./assets";
import { computeVision, isVisible } from "./fog";
import { settings } from "../state/settings";

export interface RenderOptions {
  selectedHeroId: string | null;
  selectedSettlementId: string | null;
  colorForOwner: (ownerId: number | null) => string;
  viewPlayerId: number;
  /** If provided, overrides the reachable split computed from movementRemaining. Use this to keep the proposed yellow route stable while a hero animates a committed move. */
  pathReachableIdx?: number;
  /** If provided, anchors the yellow proposed route to this tile instead of the hero's current (moving) tile. */
  pathOrigin?: Axial;
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

    for (const c of castles) {
      const canSee =
        c.ownerId === opts.viewPlayerId || isVisible(visible, c.tile.q, c.tile.r);
      if (!canSee) continue;
      const { x, y } = axialToPixel(c.tile.q, c.tile.r);
      drawCastleSprite(ctx, this.sprites, c.level, x, y, HEX_SIZE);
      this.drawCastleBorder(x, y, c, opts);
    }

    if (path.length > 0 && heroes.length > 0) {
      const player = heroes.find((h) => h.ownerId === opts.viewPlayerId);
      if (player) {
        const pathPx = path.map((t) => axialToPixel(t.q, t.r));
        const originPx = opts.pathOrigin
          ? axialToPixel(opts.pathOrigin.q, opts.pathOrigin.r)
          : axialToPixel(player.tile.q, player.tile.r);
        const fullPx = [originPx, ...pathPx];
        const splitIdx = Math.min(
          opts.pathReachableIdx ?? computeReachableSplit(path, this.map, player.movementRemaining),
          path.length
        );
        drawPathSegment(ctx, fullPx, 0, splitIdx + 1, "rgba(255, 204, 0, 0.85)", 4, 6);
        if (splitIdx < path.length) {
          drawPathSegment(ctx, fullPx, splitIdx, pathPx.length, "rgba(255, 204, 0, 0.30)", 3, 4);
        }
        drawTrail(ctx, player, opts);
      }
    }

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

    if (path.length > 0) {
      ctx.fillStyle = "rgba(255,204,0,0.5)";
      for (const t of path) {
        ctx.fillRect(x0 + t.q * cellW, y0 + t.r * cellH, cellW, cellH);
      }
    }

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

function computeReachableSplit(
  path: readonly Axial[],
  map: GameMap,
  movementRemaining: number,
): number {
  let cumulative = 0;
  for (let i = 0; i < path.length; i++) {
    const t = map.get(path[i].q, path[i].r);
    const stepCost = t ? TERRAIN_COST[t] : Infinity;
    if (!Number.isFinite(stepCost) || stepCost <= 0) return i;
    if (cumulative + stepCost > movementRemaining) return i;
    cumulative += stepCost;
  }
  return path.length;
}

function drawPathSegment(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  fromIdx: number,
  toIdx: number,
  strokeColor: string,
  lineWidth: number,
  dotRadius: number,
): void {
  if (toIdx <= fromIdx) return;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeColor;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = fromIdx; i < toIdx; i++) {
    const p = points[i];
    if (i === fromIdx) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  for (let i = fromIdx + 1; i < toIdx; i++) {
    const p = points[i];
    ctx.fillStyle = strokeColor.replace(/[\d.]+\)$/, "0.5)");
    ctx.beginPath();
    ctx.arc(p.x, p.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  hero: Hero,
  opts: RenderOptions,
): void {
  if (!hero.trail || hero.trail.length < 2) return;
  const color = opts.colorForOwner(hero.ownerId);
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  for (let i = 1; i < hero.trail.length; i++) {
    const p = axialToPixel(hero.trail[i].q, hero.trail[i].r);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < hero.trail.length; i++) {
    const p = axialToPixel(hero.trail[i].q, hero.trail[i].r);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}
