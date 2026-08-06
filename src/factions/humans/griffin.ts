// No dedicated art yet — falls back to the shared placeholder, same as
// src/data/unitImages.ts does for unit types without bundled icons.
import image from "../../resources/units/placeholder.png?url";
import type { FactionUnit } from "../types";

export const griffin: FactionUnit = {
  id: "griffin",
  name: "Griffin",
  description: "Lion-eagle mounts that swoop over shieldwalls to strike the rear.",
  hp: 18,
  attack: 8,
  defence: 6,
  speed: 6,
  walkDistance: 5,
  image,
};
