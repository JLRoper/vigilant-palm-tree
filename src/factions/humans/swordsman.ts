import image from "../../resources/units/swordsman.png?url";
import type { FactionUnit } from "../types";

export const swordsman: FactionUnit = {
  id: "swordsman",
  name: "Swordsman",
  description: "Steady line infantry clad in mail and armed with longswords.",
  hp: 10,
  attack: 5,
  defence: 6,
  speed: 4,
  walkDistance: 3,
  image,
};
