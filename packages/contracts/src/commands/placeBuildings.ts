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
   * Set when this commit is the auto-generated starter layout of a
   * previously-empty settlement (city view's generateBuildingsArray). The
   * server accepts it free of charge iff the settlement's stored buildings
   * array is still empty, preserving the historical free-generation
   * behavior that predates this command.
   */
  initialLayout?: boolean;
}
