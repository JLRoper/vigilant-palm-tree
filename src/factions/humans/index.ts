// Humans faction roster. Mirrors the unit set used by the "Test Battle"
// player preset (src/combat/testArmies.ts PLAYER_PRESET) so this can serve
// as a template for other factions.
import type { FactionUnit } from "../types";
import { swordsman } from "./swordsman";
import { archer } from "./archer";
import { cavalry } from "./cavalry";
import { pikeman } from "./pikeman";
import { crossbowman } from "./crossbowman";
import { griffin } from "./griffin";

export { swordsman, archer, cavalry, pikeman, crossbowman, griffin };

export const humanUnits: FactionUnit[] = [swordsman, archer, cavalry, pikeman, crossbowman, griffin];
