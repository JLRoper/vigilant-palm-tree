export * from "./moveHero";
export * from "./transferGold";

import type { MoveHeroCommand } from "./moveHero";
import type { TransferGoldCommand } from "./transferGold";

export type Command = MoveHeroCommand | TransferGoldCommand;
