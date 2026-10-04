import type { BuildingDef } from "../buildings";
import type { PlayerSeat, SettlementId } from "../ids";

// Discriminated-union command for committing the city view's building
// changes (palette placements + destroy-mode removals) server-side. Closes
// the F4 gap -- the "BuildStructure reserved for real new-construction"
// note this closes (commands/index.ts + upgradeBuilding.ts's header). Named
// PlaceBuildings because it carries the FULL resulting building array (the
// city view's working cart), not just additions; the server re-derives the
// net cost against its own row (placement costs minus the 50% destroy
// refund) and revalidates affordability.
export interface PlaceBuildingsCommand {
  kind: "PlaceBuildings";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  buildings: BuildingDef[];
  /**
   * Set when this commit is the starter set of a previously-empty settlement
   * (the engine's buildStarterLayout: town hall + farm field + 2 houses + two
   * wood producers, a stone producer, and the farmhouse troop producer). The
   * server accepts it free of charge
   * and already constructed iff the settlement's stored buildings array is
   * still empty.
   *
   * Every settlement is seeded at game creation, so this only fires for one
   * created later -- by a charter, or as a test fixture. It is deliberately NOT
   * a way to re-obtain a free city: the empty-array check is what stops it.
   */
  initialLayout?: boolean;
}
