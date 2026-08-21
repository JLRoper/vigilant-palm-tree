import { Axial } from "../../core/hex";
import { GameMap } from "../../map/gameMap";
import { TERRAIN_COST } from "../../map/terrain";
import type { MinimapGeometry } from "../renderTypes";
import type { MinimapCamera } from "../minimapCamera";

// What's left of this module after issue #148's cutover: the world-space path
// and trail drawing moved into src/render/scene/paint2d/ (paintPathSegment /
// paintHeroTrail), fed by adventureScene.ts's pathSegment/heroTrail nodes.
// computeReachableSplit stays because the scene builder calls it; the minimap
// path stays because the minimap is not part of the scene graph.
const MINIMAP_PATH_COLOR = "rgba(255,204,0,0.5)";

export function computeReachableSplit(
  path: readonly Axial[],
  map: GameMap,
  movementRemaining: number,
): number {
  let cumulative = 0;
  for (let i = 0; i < path.length; i++) {
    const t = map.get(path[i].q, path[i].r);
    const stepCost = t ? TERRAIN_COST[t] : Infinity;
    if (!Number.isFinite(stepCost) || stepCost <= 0) return i;
    if (cumulative >= movementRemaining) return i;
    cumulative += stepCost;
  }
  return path.length;
}

export function drawMinimapPath(
  ctx: CanvasRenderingContext2D,
  path: Axial[],
  minimapCamera: MinimapCamera,
  geo: MinimapGeometry,
): void {
  if (path.length === 0) return;
  ctx.fillStyle = MINIMAP_PATH_COLOR;
  const cellSize = geo.baseScale * minimapCamera.zoom;
  const half = cellSize / 2;
  for (const t of path) {
    const { x, y } = minimapCamera.worldToScreen(t.q, t.r, geo);
    ctx.fillRect(x - half, y - half, cellSize, cellSize);
  }
}
