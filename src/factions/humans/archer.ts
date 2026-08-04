import image from "../../resources/units/archer.png?url";
import type { FactionUnit } from "../types";

export const archer: FactionUnit = {
  id: "archer",
  name: "Archer",
  description: "Rangers from the lowland woods; deadly at range, fragile in melee.",
  hp: 5,
  attack: 4,
  defence: 2,
  speed: 4,
  walkDistance: 3,
  image,
};
