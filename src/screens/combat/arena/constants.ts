export const HEX_SIZE_MAX = 44;
export const HEX_SIZE_MIN = 14;

export const CANVAS_MARGIN = 20;

export const RAIL_WIDTH = 230;

export const DEBUG_LOG = true;
export const LOG_PREFIX = "[manualBattle]";

export function debugLog(...args: unknown[]): void {
  if (!DEBUG_LOG) return;
  console.log(LOG_PREFIX, ...args);
}

export const SPECIALTY_VISIBILITY_THRESHOLD = 0.4;