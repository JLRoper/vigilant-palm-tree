import type { GenerationStyle } from "./castle";

export type BuildingKind =
  | "townHall"
  | "house"
  | "tower"
  | "mageGuild"
  | "mine"
  | "stoneMine"
  | "ironMine"
  | "market"
  | "barracks"
  | "smithy"
  | "apartment"
  | "farmField"
  | "farmhouse"
  | "archeryRange"
  | "granary"
  | "warehouse"
  | "bank"
  | "treasury"
  | "goldMine"
  | "woodcutterHut"
  | "arcaneFont"
  | "stables"
  | "huntingLodge"
  | "eyrie";

export interface BuildingDef {
  gx: number;
  gy: number;
  kind: BuildingKind;
  level: number;
  style: GenerationStyle;
  w?: number;
  h?: number;
  /** Present while the building is under construction (new placements); removed on completion. */
  construction?: { daysRemaining: number };
  /**
   * Present only on a bank that has a pot (per-building gold storage).
   * Absent means no pot -- mirrors `construction`, so a building written
   * before banks had pots round-trips without ever gaining the key.
   */
  bank?: BankPot;
}

export interface BankPot {
  /** Gold currently held in this bank's pot. */
  gold: number;
  /** Withdrawals requested but not yet matured. */
  pendingOut: { gold: number; maturesOnDay: number }[];
}

export interface BuildingRef {
  gx: number;
  gy: number;
  kind: BuildingKind;
}
