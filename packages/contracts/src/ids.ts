export type PlayerId = number;
export type Faction = "player" | "ai";
export type HeroId = string;
export type SettlementId = string;
export type CharterId = string;

// The player seat that issued a command. Currently identical to PlayerId --
// seats and player identity haven't diverged in this codebase (see
// LobbyState.claimed's seat-index keying in server/routes.ts). Kept as a
// distinct name (not just reusing PlayerId) so a command's `actor` field
// reads as "who issued this" rather than "who owns this entity", and so it
// can grow its own shape later without touching every entity's ownerId.
export type PlayerSeat = PlayerId;

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
