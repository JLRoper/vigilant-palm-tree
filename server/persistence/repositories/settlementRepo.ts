import type {
  BuildingDef,
  CastleVariant,
  ResourceType,
  SettlementId,
  SettlementState,
  UpgradeState,
  WarehouseResource,
} from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { resolveGameId } from "./gameRepo";
import type { Queryable } from "./gameRepo";

// Phase 4 (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md). Granular
// mirror of games.settlements' JSONB shape. Nothing reads from this repo yet
// -- server/persistence/hydrate.ts (Track A) is the first real consumer,
// with a JSONB fallback for games that haven't been backfilled.
export interface SettlementRepo {
  loadAllForGame(gameName: string): Promise<SettlementState[]>;
  // Full sync, same rule as heroRepo.upsertMany: commandHandler.ts always
  // passes the *entire* settlements record, so this deletes any row for the
  // game not present in `settlements`, then upserts everything that is,
  // replacing each settlement's resources/buildings rowset alongside it.
  upsertMany(gameName: string, settlements: Record<SettlementId, SettlementState>): Promise<void>;
}

interface SettlementRow {
  id: string;
  name: string;
  owner_id: number | null;
  q: number;
  r: number;
  level: 1 | 2 | 3;
  population: number;
  gold_tax: number;
  founded_on_resource: string | null;
  gold: number;
  gold_rate: string | null;
  morale: number;
  auto_trade: boolean;
  castle_variant: CastleVariant;
  city_spots: SettlementState["citySpots"];
  city_mines: SettlementState["cityMines"];
  upgrade: UpgradeState | null;
}

interface ResourceRow {
  settlement_id: string;
  resource: WarehouseResource;
  amount: number;
  rate: string | null;
}

interface BuildingRow {
  settlement_id: string;
  gx: number;
  gy: number;
  kind: string;
  level: number;
  style: string;
  w: number | null;
  h: number | null;
}

const SETTLEMENT_COLUMNS =
  "id, name, owner_id, q, r, level, population, gold_tax, founded_on_resource, gold, gold_rate, morale, auto_trade, castle_variant, city_spots, city_mines, upgrade";

function toSettlementState(
  row: SettlementRow,
  resourceRows: ResourceRow[],
  buildingRows: BuildingRow[],
): SettlementState {
  const warehouse: SettlementState["warehouse"] = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
  const resourceRates: Partial<Record<ResourceType, number>> = {};
  for (const r of resourceRows) {
    warehouse[r.resource] = r.amount;
    if (r.rate !== null) resourceRates[r.resource] = Number(r.rate);
  }
  if (row.gold_rate !== null) resourceRates.gold = Number(row.gold_rate);

  const buildings: BuildingDef[] = buildingRows.map((b) => ({
    gx: b.gx,
    gy: b.gy,
    kind: b.kind as BuildingDef["kind"],
    level: b.level,
    style: b.style as BuildingDef["style"],
    ...(b.w !== null ? { w: b.w } : {}),
    ...(b.h !== null ? { h: b.h } : {}),
  }));

  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    q: row.q,
    r: row.r,
    level: row.level,
    population: row.population,
    goldTax: row.gold_tax,
    resourceRates,
    foundedOnResource: (row.founded_on_resource as ResourceType | null) ?? null,
    gold: row.gold,
    warehouse,
    citySpots: row.city_spots,
    cityMines: row.city_mines,
    morale: row.morale,
    autoTrade: row.auto_trade,
    castleVariant: row.castle_variant,
    buildings,
    // Conditional spread, not `?? undefined`: `upgrade` is an optional
    // property (`upgrade?: UpgradeState`), and an object literal with an
    // explicit `upgrade: undefined` key is NOT deepStrictEqual to one that
    // omits the key entirely -- would otherwise fail equality against any
    // settlement built without ever touching `upgrade` (every test fixture,
    // and every settlement that's never started an upgrade).
    ...(row.upgrade !== null ? { upgrade: row.upgrade } : {}),
  };
}

export function createSettlementRepo(db: Queryable): SettlementRepo {
  return {
    async loadAllForGame(gameName) {
      const gameId = await resolveGameId(db, gameName);
      const settlementsResult = await db.query<SettlementRow>(
        `SELECT ${SETTLEMENT_COLUMNS} FROM settlements WHERE game_id = $1`,
        [gameId],
      );
      if (settlementsResult.rowCount === 0) return [];

      const settlementIds = settlementsResult.rows.map((s) => s.id);
      const [resourcesResult, buildingsResult] = await Promise.all([
        db.query<ResourceRow>(
          `SELECT settlement_id, resource, amount, rate FROM settlement_resources
           WHERE settlement_id = ANY($1::text[])`,
          [settlementIds],
        ),
        db.query<BuildingRow>(
          `SELECT settlement_id, gx, gy, kind, level, style, w, h FROM settlement_buildings
           WHERE settlement_id = ANY($1::text[])`,
          [settlementIds],
        ),
      ]);

      const resourcesBySettlement = new Map<string, ResourceRow[]>();
      for (const row of resourcesResult.rows) {
        const rows = resourcesBySettlement.get(row.settlement_id) ?? [];
        rows.push(row);
        resourcesBySettlement.set(row.settlement_id, rows);
      }
      const buildingsBySettlement = new Map<string, BuildingRow[]>();
      for (const row of buildingsResult.rows) {
        const rows = buildingsBySettlement.get(row.settlement_id) ?? [];
        rows.push(row);
        buildingsBySettlement.set(row.settlement_id, rows);
      }

      return settlementsResult.rows.map((row) =>
        toSettlementState(
          row,
          resourcesBySettlement.get(row.id) ?? [],
          buildingsBySettlement.get(row.id) ?? [],
        ),
      );
    },

    async upsertMany(gameName, settlements) {
      const gameId = await resolveGameId(db, gameName);
      const ids = Object.values(settlements).map((s) => s.id);
      await db.query(`DELETE FROM settlements WHERE game_id = $1 AND NOT (id = ANY($2::text[]))`, [
        gameId,
        ids,
      ]);

      for (const settlement of Object.values(settlements)) {
        await db.query(
          `INSERT INTO settlements (id, game_id, name, owner_id, q, r, level, population, gold_tax,
                                     founded_on_resource, gold, gold_rate, morale, auto_trade,
                                     castle_variant, city_spots, city_mines, upgrade)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             game_id = EXCLUDED.game_id,
             name = EXCLUDED.name,
             owner_id = EXCLUDED.owner_id,
             q = EXCLUDED.q,
             r = EXCLUDED.r,
             level = EXCLUDED.level,
             population = EXCLUDED.population,
             gold_tax = EXCLUDED.gold_tax,
             founded_on_resource = EXCLUDED.founded_on_resource,
             gold = EXCLUDED.gold,
             gold_rate = EXCLUDED.gold_rate,
             morale = EXCLUDED.morale,
             auto_trade = EXCLUDED.auto_trade,
             castle_variant = EXCLUDED.castle_variant,
             city_spots = EXCLUDED.city_spots,
             city_mines = EXCLUDED.city_mines,
             upgrade = EXCLUDED.upgrade`,
          [
            settlement.id,
            gameId,
            settlement.name,
            settlement.ownerId,
            settlement.q,
            settlement.r,
            settlement.level,
            settlement.population,
            settlement.goldTax,
            settlement.foundedOnResource,
            settlement.gold,
            settlement.resourceRates.gold ?? null,
            settlement.morale,
            settlement.autoTrade,
            settlement.castleVariant,
            JSON.stringify(settlement.citySpots),
            JSON.stringify(settlement.cityMines),
            settlement.upgrade ? JSON.stringify(settlement.upgrade) : null,
          ],
        );

        // Resources and buildings are always replaced wholesale alongside
        // their parent settlement -- same full-sync rule as the settlements
        // table itself.
        await db.query(`DELETE FROM settlement_resources WHERE settlement_id = $1`, [settlement.id]);
        for (const resource of WAREHOUSE_RESOURCES) {
          const rate = settlement.resourceRates[resource];
          await db.query(
            `INSERT INTO settlement_resources (settlement_id, resource, amount, rate)
             VALUES ($1, $2, $3, $4)`,
            [settlement.id, resource, settlement.warehouse[resource], rate ?? null],
          );
        }

        await db.query(`DELETE FROM settlement_buildings WHERE settlement_id = $1`, [settlement.id]);
        for (const building of settlement.buildings) {
          await db.query(
            `INSERT INTO settlement_buildings (settlement_id, gx, gy, kind, level, style, w, h)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              settlement.id,
              building.gx,
              building.gy,
              building.kind,
              building.level,
              building.style,
              building.w ?? null,
              building.h ?? null,
            ],
          );
        }
      }
    },
  };
}
