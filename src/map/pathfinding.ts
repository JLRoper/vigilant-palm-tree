// Re-export shim: findPath moved into @heroes/engine (packages/engine/src/
// map/pathfinding.ts) so server-side trade-route caravans can path on the
// deterministic rebuilt GameMap. Keep all imports pointing here.
export { findPath, computePathCost, NEIGHBOR_DIRS, hexDistance } from "@heroes/engine";
