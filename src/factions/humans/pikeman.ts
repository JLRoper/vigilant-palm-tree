// No dedicated art yet — falls back to the shared placeholder, same as
// src/data/unitImages.ts does for unit types without bundled icons.
import image from "../../resources/units/placeholder.png?url";
import type { FactionUnit } from "../types";

export const pikeman: FactionUnit = {
  id: "pikeman",
  name: "Pikeman",
  description: "A wall of iron against cavalry; slow but nigh-impregnable from the front.",
  hp: 12,
  attack: 3,
  defence: 8,
  speed: 3,
  walkDistance: 2,
  image,
};
