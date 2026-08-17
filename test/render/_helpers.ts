import { GameMap, type TileRow } from "../../src/map/gameMap";
import type { Terrain } from "../../src/map/terrain";
import type { ResourceType } from "../../src/map/resourceTiles";
import type { RenderOptions } from "../../src/render/renderTypes";
import type { Paint2DDep } from "../../src/render/scene/paint2d/deps";

export function stubColorForOwner(ownerId: number | null): string {
  return ownerId === null ? "neutral" : `owner-${ownerId}`;
}

export function makeRenderOptions(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    selectedHeroId: null,
    selectedSettlementId: null,
    colorForOwner: stubColorForOwner,
    viewPlayerId: 0,
    ...overrides,
  };
}

/** All-grass width x height map, optionally with resource tiles at specific hexes. */
export function makeGrassMap(
  width: number,
  height: number,
  resources: Array<{ q: number; r: number; resource: ResourceType }> = [],
): GameMap {
  const resourceAt = new Map(resources.map((r) => [`${r.q},${r.r}`, r.resource]));
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const terrain: Terrain = "grass";
      rows.push({ q, r, terrain, resource: resourceAt.get(`${q},${r}`) ?? null });
    }
  }
  return GameMap.fromTiles(rows);
}

// Recorder for emitted Canvas calls. Used by paint2d.test.ts and any future
// painter tests. The shim is a Proxy that returns a no-op for every method
// (matching the surface area of CanvasRenderingContext2D that the painters
// use) while logging the call log. Tests assert on the log.

export interface CtxCall {
  name: string;
  args: unknown[];
}

export interface RecordingCtx {
  ctx: CanvasRenderingContext2D;
  calls: CtxCall[];
}

const CTX_METHODS = [
  "arc",
  "arcTo",
  "beginPath",
  "bezierCurveTo",
  "clearRect",
  "clip",
  "closePath",
  "createImageData",
  "createLinearGradient",
  "createPattern",
  "createRadialGradient",
  "drawFocusIfNeeded",
  "drawImage",
  "ellipse",
  "fill",
  "fillRect",
  "fillText",
  "getContextAttributes",
  "getImageData",
  "getLineDash",
  "getTransform",
  "lineTo",
  "measureText",
  "moveTo",
  "putImageData",
  "quadraticCurveTo",
  "rect",
  "resetTransform",
  "restore",
  "rotate",
  "save",
  "scale",
  "setLineDash",
  "setTransform",
  "stroke",
  "strokeRect",
  "strokeText",
  "transform",
  "translate",
] as const;

export function makeRecordingCtx(): RecordingCtx {
  const calls: CtxCall[] = [];
  const target: Record<string | symbol, unknown> = {};
  for (const name of CTX_METHODS) {
    target[name] = (...args: unknown[]) => {
      calls.push({ name, args });
    };
  }
  // Common property setters the painters use. Logged via a Reflect-based
  // setter so the recording captures things like `ctx.fillStyle = "#fff"`.
  const propertyNames = ["fillStyle", "strokeStyle", "lineWidth", "lineJoin", "lineCap", "font", "textAlign", "textBaseline", "globalAlpha", "globalCompositeOperation"];
  for (const name of propertyNames) {
    target[name] = undefined;
  }
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop) {
      if (typeof prop === "string" && prop in target) {
        return target[prop];
      }
      // Reading properties returns whatever was last assigned.
      return undefined;
    },
    set(_t, prop, value) {
      if (typeof prop === "string" && propertyNames.includes(prop)) {
        target[prop] = value;
        calls.push({ name: `set:${prop}`, args: [value] });
        return true;
      }
      return true;
    },
  });
  return { ctx, calls };
}

// A stub Paint2DDep for painters that don't need anything more than no-op
// getters. Use this when you're testing the dispatcher wiring, not real
// rendering.
export function makeNoopPaint2DDep(): Paint2DDep {
  return {
    sprite: {
      resolveSpriteForResource: () => undefined,
      resolveSpriteForHero: () => undefined,
      resolveSpriteForBuilding: () => undefined,
      resolveSpriteForCastle: () => undefined,
      resolveSprite: () => undefined,
    },
    skybox: null,
    getResourceStyle: () => "rune-stone",
    getSpriteVariant: () => 1,
    getParallaxEnabled: () => false,
    getParallaxLayerCount: () => 4,
    getBgOffsetX: () => 0,
    getBgOffsetY: () => 0,
    getTerritoryBorderWidth: () => 1,
    colorForOwner: (ownerId) => (ownerId === null ? "rgba(255,255,255,0.18)" : `owner-${ownerId}`),
    battleAccent: () => "#fff",
    fontFamily: "system-ui, sans-serif",
    charterStyle: () => ({ stroke: "rgba(0,200,255,0.9)", fill: "rgba(0,200,255,0.18)", lineDash: [6, 4], lineWidth: 2 }),
    validCharterStyle: { stroke: "rgba(68,255,68,0.9)", fill: "rgba(68,255,68,0.18)", lineDash: [6, 4], lineWidth: 2 },
  };
}
