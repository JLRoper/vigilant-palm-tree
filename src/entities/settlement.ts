import type {
  Axial,
  BuildingDef,
  CastleLevel,
  CastleVariant,
  DistrictState,
  PlayerId,
  ResourceType,
  SettlementState,
  UpgradeState,
  Warehouse,
} from "@heroes/contracts";

function emptyWarehouse(): Warehouse {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
}

export class Castle {
  tile: Axial;
  level: CastleLevel;
  ownerId: PlayerId | null;
  id: string;
  name: string;
  population: number;
  goldTax: number;
  resourceRates: Partial<Record<ResourceType, number>>;
  foundedOnResource: ResourceType | null;
  gold: number;
  warehouse: Warehouse;
  citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>;
  cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>;
  morale: number;
  autoTrade: boolean;
  castleVariant: CastleVariant;
  buildings: BuildingDef[];
  upgrade?: UpgradeState;
  districts?: Record<string, DistrictState>;

  constructor(
    id: string,
    tile: Axial,
    level: CastleLevel,
    ownerId: PlayerId | null,
    name: string,
    population: number,
    goldTax: number,
    resourceRates: Partial<Record<ResourceType, number>>,
    foundedOnResource: ResourceType | null,
    gold = 0,
    warehouse?: Warehouse,
    citySpots?: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>,
    cityMines?: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>,
    morale = 100,
    autoTrade = true,
    castleVariant: CastleVariant = 0,
    buildings: BuildingDef[] = [],
    upgrade?: UpgradeState,
    districts?: Record<string, DistrictState>,
  ) {
    this.id = id;
    this.tile = tile;
    this.level = level;
    this.ownerId = ownerId;
    this.name = name;
    this.population = population;
    this.goldTax = goldTax;
    this.resourceRates = resourceRates;
    this.foundedOnResource = foundedOnResource;
    this.gold = gold;
    this.warehouse = warehouse ?? emptyWarehouse();
    this.citySpots = citySpots ?? [];
    this.cityMines = cityMines ?? [];
    this.morale = morale;
    this.autoTrade = autoTrade;
    this.castleVariant = castleVariant;
    this.buildings = buildings;
    this.upgrade = upgrade;
    this.districts = districts;
  }

  toGameState(): SettlementState {
    return {
      id: this.id,
      name: this.name,
      ownerId: this.ownerId,
      q: this.tile.q,
      r: this.tile.r,
      level: this.level,
      population: this.population,
      goldTax: this.goldTax,
      resourceRates: { ...this.resourceRates },
      foundedOnResource: this.foundedOnResource,
      gold: this.gold,
      warehouse: { ...this.warehouse },
      citySpots: this.citySpots,
      cityMines: this.cityMines,
      morale: this.morale,
      // Garrison upkeep shortfall is authoritative live state, not a visual
      // property: the mirror carries no such field, so it round-trips paid up.
      garrisonUnpaidSinceDay: null,
      garrisonUnpaidTroops: 0,
      garrisonUnpaidGold: 0,
      autoTrade: this.autoTrade,
      castleVariant: this.castleVariant,
      buildings: this.buildings,
      upgrade: this.upgrade,
      ...(this.districts && Object.keys(this.districts).length > 0 ? { districts: this.districts } : {}),
    };
  }

  /**
   * Push a freshly-read SettlementState into this wrapper *in place*.
   *
   * Every field `fromGameState` reads, copied onto the same instance. The
   * wrapper is a projection that long-lived holders alias -- `EntityMirror`
   * stores these exact objects (`syncWith`), and the render/UI paths read
   * them for the owner colour, the territory outline, the control range and
   * the district door -- so a refresh must never allocate a replacement: the
   * aliases would keep pointing at the retired object. `Hero.syncFromState`
   * exists for the same reason; the settlement side had no equivalent, which
   * is how a captured castle kept its pre-capture owner for the rest of the
   * session (playthrough round 2, F4).
   */
  syncFromState(s: SettlementState): void {
    this.id = s.id;
    this.tile = { q: s.q, r: s.r };
    this.level = s.level;
    this.ownerId = s.ownerId ?? null;
    this.name = s.name ?? s.id;
    this.population = s.population ?? 0;
    this.goldTax = s.goldTax ?? 0;
    this.resourceRates = s.resourceRates ?? {};
    this.foundedOnResource = s.foundedOnResource ?? null;
    this.gold = s.gold ?? 0;
    this.warehouse = s.warehouse ?? emptyWarehouse();
    this.citySpots = s.citySpots ?? [];
    this.cityMines = s.cityMines ?? [];
    this.morale = s.morale ?? 100;
    this.autoTrade = s.autoTrade ?? true;
    this.castleVariant = s.castleVariant ?? 0;
    this.buildings = s.buildings ?? [];
    this.upgrade = s.upgrade ?? undefined;
    this.districts = s.districts && Object.keys(s.districts).length > 0 ? s.districts : undefined;
  }

  static fromGameState(s: SettlementState): Castle {
    // Construct with placeholder values, then run the one field-copy routine:
    // a second hand-written mapping here is exactly the kind of parallel writer
    // that drifts from the reconcile path.
    const castle = new Castle(s.id, { q: s.q, r: s.r }, s.level, s.ownerId ?? null, s.name ?? s.id, 0, 0, {}, null);
    castle.syncFromState(s);
    return castle;
  }
}

export const CASTLE_LEVELS: readonly CastleLevel[] = [1, 2, 3] as const;

export function castleAt(q: number, r: number, castles: readonly Castle[]): Castle | undefined {
  return castles.find((c) => c.tile.q === q && c.tile.r === r);
}

export function castlesFromGameState(settlements: Record<string, SettlementState>): Castle[] {
  return Object.values(settlements).map(Castle.fromGameState);
}
