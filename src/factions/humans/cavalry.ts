import image from "../../resources/units/cavalry.png?url";
import type { FactionUnit } from "../types";

export const cavalry: FactionUnit = {
  id: "cavalry",
  name: "Cavalry",
  description: "Hammering lancers that strike first and overrun scattered foes.",
  hp: 15,
  attack: 7,
  defence: 5,
  speed: 7,
  walkDistance: 6,
  image,
};
