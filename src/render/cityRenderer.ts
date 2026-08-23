// City-view paint entry point. Since issue #148 this file no longer decides
// what a city frame contains -- src/render/scene/sceneBuilder/cityScene.ts
// does, emitting a SceneNode[] -- and no longer knows how to draw any of it:
// src/render/scene/paint2d/ owns every per-kind painter. What's left is the
// canvas-state framing the old drawCityView() wrapped its body in.
//
// The four Vite `?url` skybox PNG imports that used to live here (plus the
// module-scope skybox/layer caches) moved to src/render/skybox.ts, the only
// module in the painter project allowed to hold them.

import { computeCityScale } from "../core/cityGrid";
import { paintScene, type Paint2DFrame } from "./scene/paint2d";
import type { Paint2DDep } from "./scene/paint2d/deps";
import type { SceneNode } from "./scene/types";
import type { BuildingDef, GenerationStyle } from "./cityBuildingDraw";

export { computeCityScale };
export { type BuildingDef, type GenerationStyle };

export function drawCityView(
  ctx: CanvasRenderingContext2D,
  nodes: readonly SceneNode[],
  deps: Paint2DDep,
  frame: Paint2DFrame,
): void {
  ctx.save();
  // Set once for the whole frame, exactly where the pre-cutover drawCityView()
  // set it: the diamond cell outlines want mitred corners, and the adventure
  // painters leave lineJoin on "round".
  ctx.lineJoin = "miter";
  paintScene(ctx, nodes, deps, frame);
  ctx.restore();
}
