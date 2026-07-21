// Maps unit-type ids to bundled PNG icons. Only a few unit types have dedicated
// art today; everything else falls back to placeholder.png. When a real asset is
// added for a unit, import it here and add it to the KNOWN map below.
//
// PNGs live in src/resources/units/ and are imported via Vite's ?url suffix so
// they hash-cache and ship in the build.

import placeholder from "../resources/units/placeholder.png?url";
import swordsman from "../resources/units/swordsman.png?url";
import archer from "../resources/units/archer.png?url";
import cavalry from "../resources/units/cavalry.png?url";

const KNOWN: Record<string, string> = {
  swordsman,
  archer,
  cavalry,
};

export const PLACEHOLDER_UNIT_IMAGE = placeholder;

// Returns the best available image URL for a unit type. Falls back to the shared
// placeholder when no dedicated art exists yet.
export function getUnitImageUrl(unitTypeId: string | null): string {
  if (!unitTypeId) return PLACEHOLDER_UNIT_IMAGE;
  return KNOWN[unitTypeId] ?? PLACEHOLDER_UNIT_IMAGE;
}