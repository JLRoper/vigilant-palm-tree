export {
  GameMap,
  MAP_SIZES,
  MAP_SIZE_ORDER,
  GAME_MAP_CACHE_CAPACITY,
  isMapSize,
  mapSizeLabel,
  resolveMapSize,
  resolveMapGenVersion,
  resolveSavedMapGenVersion,
  getOrCreateGameMap,
  clearGameMapCache,
  getGameMapCacheSize,
} from "@heroes/engine";
export type { MapSize, MapGenVersion, TileRow } from "@heroes/engine";
