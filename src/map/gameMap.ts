export {
  GameMap,
  MAP_SIZES,
  GAME_MAP_CACHE_CAPACITY,
  resolveMapSize,
  resolveMapGenVersion,
  resolveSavedMapGenVersion,
  getOrCreateGameMap,
  clearGameMapCache,
  getGameMapCacheSize,
} from "@heroes/engine";
export type { MapSize, MapGenVersion, TileRow } from "@heroes/engine";
