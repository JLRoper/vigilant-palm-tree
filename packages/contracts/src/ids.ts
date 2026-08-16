export type PlayerId = number;
export type Faction = "player" | "ai";
export type HeroId = string;
export type SettlementId = string;
export type CharterId = string;

// Mirrors shared/horseVariants.ts's HORSE_VARIANT_REGISTRY ids as an
// independent literal union (not derived from the registry) so contracts
// stays a zero-dependency leaf. The registry itself (labels, commander
// sprite direction) is presentation/catalog data — it belongs alongside the
// rest of shared/ once that moves to packages/engine, not on the wire.
export type HorseVariantId =
  | "bubbly"
  | "shadow"
  | "paladin"
  | "ranger"
  | "arcane"
  | "unicorn"
  | "samurai"
  | "hero";
