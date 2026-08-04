// No dedicated art yet — falls back to the shared placeholder, same as
// src/data/unitImages.ts does for unit types without bundled icons.
import image from "../../resources/units/placeholder.png?url";
import type { FactionUnit } from "../types";

export const crossbowman: FactionUnit = {
  id: "crossbowman",
  name: "Crossbowman",
  description: "Steel-bolt skirmishers whose quarrels punch through light armour.",
  hp: 7,
  attack: 6,
  defence: 3,
  speed: 4,
  walkDistance: 3,
  image,
};
