// Maps unit-type ids to bundled PNG icon busts. Every unit-catalog id has
// dedicated art under src/resources/units/icons/; anything not in the KNOWN
// map below falls back to placeholder.png. When a real asset is added for a
// new unit, import it here and add it to the KNOWN map.
//
// PNGs live in src/resources/units/ and are imported via Vite's ?url suffix so
// they hash-cache and ship in the build. The legacy placeholder art
// src/resources/units/{swordsman,archer,cavalry}.png is no longer referenced
// (kept on disk; retirement is a separate decision).

import placeholder from "../resources/units/placeholder.png?url";
import peasant from "../resources/units/icons/peasant.png?url";
import archer from "../resources/units/icons/archer.png?url";
import crossbowman from "../resources/units/icons/crossbowman.png?url";
import swordsman from "../resources/units/icons/swordsman.png?url";
import pikeman from "../resources/units/icons/pikeman.png?url";
import cavalry from "../resources/units/icons/cavalry.png?url";
import monk from "../resources/units/icons/monk.png?url";
import crusader from "../resources/units/icons/crusader.png?url";
import griffin from "../resources/units/icons/griffin.png?url";
import hydra from "../resources/units/icons/hydra.png?url";
import wisp from "../resources/units/icons/wisp.png?url";
import blackDragon from "../resources/units/icons/black_dragon.png?url";
import warhound from "../resources/units/icons/warhound.png?url";
import giantEagle from "../resources/units/icons/giant_eagle.png?url";
import eaglePrince from "../resources/units/icons/eagle_prince.png?url";
import ghoul from "../resources/units/icons/ghoul.png?url";
import bonePikeman from "../resources/units/icons/bone_pikeman.png?url";
import boneArcher from "../resources/units/icons/bone_archer.png?url";
import wraith from "../resources/units/icons/wraith.png?url";
import bloodKnight from "../resources/units/icons/blood_knight.png?url";
import vampireLord from "../resources/units/icons/vampire_lord.png?url";
import lich from "../resources/units/icons/lich.png?url";
import dwarfAxeman from "../resources/units/icons/dwarf_axeman.png?url";
import shieldBearer from "../resources/units/icons/shield_bearer.png?url";
import handGunner from "../resources/units/icons/hand_gunner.png?url";
import ironsworn from "../resources/units/icons/ironsworn.png?url";
import ironGolem from "../resources/units/icons/iron_golem.png?url";
import runesmith from "../resources/units/icons/runesmith.png?url";
import forgeLord from "../resources/units/icons/forge_lord.png?url";

const KNOWN: Record<string, string> = {
  peasant,
  archer,
  crossbowman,
  swordsman,
  pikeman,
  cavalry,
  monk,
  crusader,
  griffin,
  hydra,
  wisp,
  black_dragon: blackDragon,
  warhound,
  giant_eagle: giantEagle,
  eagle_prince: eaglePrince,
  ghoul,
  bone_pikeman: bonePikeman,
  bone_archer: boneArcher,
  wraith,
  blood_knight: bloodKnight,
  vampire_lord: vampireLord,
  lich,
  dwarf_axeman: dwarfAxeman,
  shield_bearer: shieldBearer,
  hand_gunner: handGunner,
  ironsworn,
  iron_golem: ironGolem,
  runesmith,
  forge_lord: forgeLord,
};

export const PLACEHOLDER_UNIT_IMAGE = placeholder;

// Returns the best available image URL for a unit type. Falls back to the shared
// placeholder when no dedicated art exists yet.
export function getUnitImageUrl(unitTypeId: string | null): string {
  if (!unitTypeId) return PLACEHOLDER_UNIT_IMAGE;
  return KNOWN[unitTypeId] ?? PLACEHOLDER_UNIT_IMAGE;
}