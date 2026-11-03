/**
 * The ONE rule that renders a movement cost to the player.
 *
 * `GameMap.cost` prices a hex EXACTLY -- a roaded forest is `1.2 * 0.75`, which
 * in IEEE-754 is 0.8999999999999999 -- and that exact value is what the game
 * USES (findPath's A* relax, computePathCost, the reachable split, the AI's step
 * price). Only the RENDERING is rounded, and only here: a bare `${cost}` prints
 * twenty characters of float noise, overflows whatever panel it lands in, and
 * reflows every row beneath it.
 *
 * One decimal place, trailing `.0` trimmed: the granularity the HUD has always
 * shown movement at (`Movement 6/7`, `Path 5.8/7`) and the coarsest grid that
 * still separates every price the terrain table can produce (1, 1.2, 1.4, 2 and
 * their 0.75 road prices). Whole numbers stay whole, so `move cost 1` and
 * `move cost 2` read exactly as they always did.
 */
export function formatMoveCost(cost: number): string {
  if (!Number.isFinite(cost)) return "\u221e";
  const text = cost.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}
