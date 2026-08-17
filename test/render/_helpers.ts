import { GameMap, type TileRow } from "../../src/map/gameMap";
import type { Terrain } from "../../src/map/terrain";
import type { ResourceType } from "../../src/map/resourceTiles";
import type { RenderOptions } from "../../src/render/renderTypes";

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
