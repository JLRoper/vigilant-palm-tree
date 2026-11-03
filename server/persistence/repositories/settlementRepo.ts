import type {
  BuildingDef,
  CastleVariant,
  DistrictState,
  Platoon,
  ResourceType,
  SettlementId,
  SettlementState,
  UpgradeState,
  WarehouseResource,
} from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { normalizeDistricts, normalizePlatoons, resolvedPersistedStyle, settlementStacks } from "@heroes/engine";
import { toNumericColumn } from "../integerColumns";
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
  // replacing each settlement's resources/buildings/platoons rowset
  // alongside it. When `previous` is supplied, settlements whose object
  // reference is unchanged (`previous[id] === settlement`) skip SQL writes.
  upsertMany(
    gameName: string,
    settlements: Record<SettlementId, SettlementState>,
    previous?: Record<SettlementId, SettlementState>,
  ): Promise<void>;
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
  garrison_unpaid_since_day: number | null;
  garrison_unpaid_troops: number;
  garrison_unpaid_gold: number;
  auto_trade: boolean;
  castle_variant: CastleVariant;
  city_spots: SettlementState["citySpots"];
  city_mines: SettlementState["cityMines"];
  upgrade: UpgradeState | null;
  districts: Record<string, DistrictState> | null;
}

interface ResourceRow {
  settlement_id: string;
  resource: WarehouseResource;
  amount: number;
  rate: string | null;
}

interface BuildingRow {
  settlement_id: string;
  /** District hex this building stands in; NULL means the main city (migration 035). */
  district_q: number | null;
  district_r: number | null;
  gx: number;
  gy: number;
  kind: string;
  level: number;
  style: string;
  w: number | null;
  h: number | null;
  construction: { daysRemaining: number } | null;
  bank: BuildingDef["bank"] | null;
  workers: number | null;
  draft: BuildingDef["draft"] | null;
}

interface PlatoonRow {
  settlement_id: string;
  stack_index: number;
  unit_type_id: string;
  count: number;
}

const SETTLEMENT_COLUMNS =
  "id, name, owner_id, q, r, level, population, gold_tax, founded_on_resource, gold, gold_rate, morale, garrison_unpaid_since_day, garrison_unpaid_troops, garrison_unpaid_gold, auto_trade, castle_variant, city_spots, city_mines, upgrade, districts";

/** One settlement_buildings row as the BuildingDef the engine reads. */
function toBuildingDef(b: BuildingRow): BuildingDef {
  return {
    gx: b.gx,
    gy: b.gy,
    kind: b.kind as BuildingDef["kind"],
    level: b.level,
    style: b.style as BuildingDef["style"],
    ...(b.w !== null ? { w: b.w } : {}),
    ...(b.h !== null ? { h: b.h } : {}),
    ...(b.construction != null ? { construction: b.construction as BuildingDef["construction"] } : {}),
    // Bank pots (migration 022) follow the `construction` rule verbatim: a
    // NULL column means no pot, and the key must be absent rather than
    // undefined for the same deepStrictEqual reason documented below.
    ...(b.bank != null ? { bank: b.bank as BuildingDef["bank"] } : {}),
    // Workforce columns (migration 030) follow the same rule: NULL means
    // the key is absent (legacy auto-staffing / full pool), never an
    // explicit undefined.
    ...(b.workers != null ? { workers: b.workers } : {}),
    ...(b.draft != null ? { draft: b.draft } : {}),
  };
}

/**
 * A settlement's districts, assembled from the ledger's own rows plus the
 * per-district metadata the `districts` column carries (q, r, citySpots).
 *
 * Building rows are attributed to a district through district_q/district_r
 * (migration 035): the main city's rows are the ones with both NULL, and every
 * other row belongs to the district whose hex those columns name -- the same
 * "q,r" key districtKey() gives a district. Before 035 a district building had
 * no row at all (finding E8), so any reader of this table saw a settlement
 * missing every district building and a production sum short by exactly the
 * districts' output.
 *
 * A district with NO rows at all keeps the buildings the JSONB column carries.
 * That is the same granular-first / JSONB-fallback rule hydrate.ts applies one
 * level up, and it is what keeps a game whose rows were written before 035 (or
 * whose district the 035 backfill's own guards skipped as malformed) producing
 * what it produced before this cutover, rather than losing every district
 * building to an empty ledger.
 */
function assembleDistricts(
  raw: SettlementRow["districts"],
  rowsByDistrict: Map<string, BuildingRow[]>,
): Record<string, DistrictState> | undefined {
  const out: Record<string, DistrictState> = {};
  for (const [key, d] of Object.entries(normalizeDistricts(raw) ?? {})) {
    const rows = rowsByDistrict.get(key);
    out[key] = {
      q: d.q,
      r: d.r,
      citySpots: d.citySpots,
      buildings: rows ? rows.map(toBuildingDef) : d.buildings,
    };
    rowsByDistrict.delete(key);
  }
  // Rows for a district the settlement row no longer lists: the ledger says
  // those buildings exist, so they are kept rather than dropped. Only reachable
  // on hand-edited data -- the writer writes both representations from one
  // settlement object -- which is why the metadata is empty rather than guessed.
  for (const [key, rows] of rowsByDistrict) {
    const [q, r] = key.split(",").map(Number);
    out[key] = { q, r, citySpots: [], buildings: rows.map(toBuildingDef) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Every building a settlement owns, each tagged with the district it stands in
 * (null = the main city). The one list the ledger's writer walks, so a district
 * building can never be written without its district attribution -- or, as E8
 * found, not written at all.
 */
function settlementBuildingRows(
  settlement: Pick<SettlementState, "buildings" | "districts">,
): Array<{ district: { q: number; r: number } | null; building: BuildingDef }> {
  const out: Array<{ district: { q: number; r: number } | null; building: BuildingDef }> =
    settlement.buildings.map((building) => ({ district: null, building }));
  for (const d of Object.values(settlement.districts ?? {})) {
    for (const building of d.buildings) out.push({ district: { q: d.q, r: d.r }, building });
  }
  return out;
}

function toSettlementState(
  row: SettlementRow,
  resourceRows: ResourceRow[],
  buildingRows: BuildingRow[],
  platoonRows: PlatoonRow[],
): SettlementState {
  const warehouse: SettlementState["warehouse"] = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
  const resourceRates: Partial<Record<ResourceType, number>> = {};
  for (const r of resourceRows) {
    warehouse[r.resource] = r.amount;
    if (r.rate !== null) resourceRates[r.resource] = Number(r.rate);
  }
  if (row.gold_rate !== null) resourceRates.gold = Number(row.gold_rate);

  // Main city (district_q IS NULL) into `buildings`, everything else grouped by
  // its district hex for assembleDistricts below. Grouping preserves the row
  // order the query returned (ORDER BY id), so the district's building array
  // comes back in the order it was persisted, same as the city's.
  const buildings: BuildingDef[] = [];
  const rowsByDistrict = new Map<string, BuildingRow[]>();
  for (const b of buildingRows) {
    if (b.district_q === null) {
      buildings.push(toBuildingDef(b));
      continue;
    }
    const key = `${b.district_q},${b.district_r}`;
    const rows = rowsByDistrict.get(key) ?? [];
    rows.push(b);
    rowsByDistrict.set(key, rows);
  }

  // Shape-guarded through the same helper the JSONB fallback uses: a partial
  // districts row (missing `buildings`) must not reach the End Turn loop, which
  // iterates district.buildings unconditionally and would 500 every turn.
  const districts = assembleDistricts(row.districts, rowsByDistrict);

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
    // Garrison upkeep shortfall (weekly upkeep pass); `?? ` defends a granular
    // row written by a pre-021 server, same spirit as above.
    garrisonUnpaidSinceDay: row.garrison_unpaid_since_day ?? null,
    garrisonUnpaidTroops: row.garrison_unpaid_troops ?? 0,
    garrisonUnpaidGold: row.garrison_unpaid_gold ?? 0,
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
    // Garrison assembly (unit-recruitment/garrison plan task 7), same
    // conditional-spread rule as `upgrade`: a settlement with no platoon
    // rows round-trips without the optional `stacks` key at all (readers
    // go through settlementStacks(), which treats absent as 8 empty
    // platoons); one with rows gets the normalized 8-slot Platoon[] back.
    ...(platoonRows.length > 0
      ? { stacks: normalizePlatoons(assemblePlatoons(platoonRows)) }
      : {}),
    ...(districts ? { districts } : {}),
  };
}

// Reassembles Platoon[] from settlement_platoons' flattened rows -- the
// inverse of upsertMany's flattening below, mirroring heroRepo's identical
// helper. Sparse stack_index values leave a hole with an empty-entries
// Platoon rather than shifting later stacks into the gap, since stack
// position is meaningful.
function assemblePlatoons(rows: PlatoonRow[]): Platoon[] {
  const stacks: Platoon[] = [];
  for (const row of rows) {
    for (let i = stacks.length; i <= row.stack_index; i++) stacks[i] = { entries: [] };
    stacks[row.stack_index].entries.push({ unitTypeId: row.unit_type_id, count: row.count });
  }
  return stacks;
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
      const [resourcesResult, buildingsResult, platoonsResult] = await Promise.all([
        db.query<ResourceRow>(
          `SELECT settlement_id, resource, amount, rate FROM settlement_resources
           WHERE game_id = $1 AND settlement_id = ANY($2::text[])`,
          [gameId, settlementIds],
        ),
        db.query<BuildingRow>(
          // ORDER BY id, not left to the planner: the UNIQUE
          // (game_id, settlement_id, district_q, district_r, gx, gy) index is
          // what this predicate actually scans, so without it Postgres returns
          // buildings in (gx, gy) order while the JSONB read path returns them
          // in the order they were persisted. Two read paths disagreeing on the
          // same row is exactly what hydrate.test.ts's read-path parity case
          // exists to catch, and a starter set's 6-10 buildings is enough to
          // make the divergence visible. upsertMany re-inserts in array order,
          // so the BIGSERIAL id IS the persisted order.
          `SELECT settlement_id, district_q, district_r, gx, gy, kind, level, style, w, h, construction, bank, workers, draft FROM settlement_buildings
             WHERE game_id = $1 AND settlement_id = ANY($2::text[])
             ORDER BY settlement_id, id`,
          [gameId, settlementIds],
        ),
        db.query<PlatoonRow>(
          `SELECT settlement_id, stack_index, unit_type_id, count FROM settlement_platoons
           WHERE game_id = $1 AND settlement_id = ANY($2::text[]) ORDER BY settlement_id, stack_index, unit_type_id`,
          [gameId, settlementIds],
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
      const platoonsBySettlement = new Map<string, PlatoonRow[]>();
      for (const row of platoonsResult.rows) {
        const rows = platoonsBySettlement.get(row.settlement_id) ?? [];
        rows.push(row);
        platoonsBySettlement.set(row.settlement_id, rows);
      }

      return settlementsResult.rows.map((row) =>
        toSettlementState(
          row,
          resourcesBySettlement.get(row.id) ?? [],
          buildingsBySettlement.get(row.id) ?? [],
          platoonsBySettlement.get(row.id) ?? [],
        ),
      );
    },

    async upsertMany(gameName, settlements, previous) {
      const gameId = await resolveGameId(db, gameName);
      const shouldDeleteMissing =
        !previous || Object.keys(previous).some((id) => !(id in settlements));
      if (shouldDeleteMissing) {
        const ids = Object.values(settlements).map((s) => s.id);
        await db.query(`DELETE FROM settlements WHERE game_id = $1 AND NOT (id = ANY($2::text[]))`, [
          gameId,
          ids,
        ]);
      }

      for (const settlement of Object.values(settlements)) {
        if (previous && previous[settlement.id] === settlement) continue;
        await db.query(
          `INSERT INTO settlements (id, game_id, name, owner_id, q, r, level, population, gold_tax,
                                     founded_on_resource, gold, gold_rate, morale,
                                     garrison_unpaid_since_day, garrison_unpaid_troops, garrison_unpaid_gold,
                                     auto_trade, castle_variant, city_spots, city_mines, upgrade, districts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb)
           ON CONFLICT (game_id, id) DO UPDATE SET
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
             garrison_unpaid_since_day = EXCLUDED.garrison_unpaid_since_day,
             garrison_unpaid_troops = EXCLUDED.garrison_unpaid_troops,
             garrison_unpaid_gold = EXCLUDED.garrison_unpaid_gold,
             auto_trade = EXCLUDED.auto_trade,
             castle_variant = EXCLUDED.castle_variant,
             city_spots = EXCLUDED.city_spots,
             city_mines = EXCLUDED.city_mines,
             upgrade = EXCLUDED.upgrade,
             districts = EXCLUDED.districts`,
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
            // settlements.gold and settlements.morale are NUMERIC (migration
            // 027); both are 2-dp floats in the engine (round2'd gold
            // production, and a continuous foodDeficitRatio driving morale)
            // and persist at full precision now. See ../integerColumns.ts.
            toNumericColumn(settlement.gold),
            settlement.resourceRates.gold ?? null,
            toNumericColumn(settlement.morale),
            settlement.garrisonUnpaidSinceDay,
            settlement.garrisonUnpaidTroops,
            settlement.garrisonUnpaidGold,
            settlement.autoTrade,
            settlement.castleVariant,
            JSON.stringify(settlement.citySpots),
            JSON.stringify(settlement.cityMines),
            settlement.upgrade ? JSON.stringify(settlement.upgrade) : null,
            settlement.districts && Object.keys(settlement.districts).length > 0
              ? JSON.stringify(settlement.districts)
              : null,
          ],
        );

        // Resources, buildings, and garrison platoons are always replaced
        // wholesale alongside their parent settlement -- same full-sync
        // rule as the settlements table itself.
        await db.query(`DELETE FROM settlement_resources WHERE game_id = $1 AND settlement_id = $2`, [
          gameId,
          settlement.id,
        ]);
        for (const resource of WAREHOUSE_RESOURCES) {
          const rate = settlement.resourceRates[resource];
          await db.query(
            `INSERT INTO settlement_resources (game_id, settlement_id, resource, amount, rate)
             VALUES ($1, $2, $3, $4, $5)`,
            // amount is NUMERIC (migration 027), and a food producer's
            // per-turn output is a 2-dp float (producers.ts rounds to 100ths),
            // so the warehouse total is fractional too -- it round-trips at
            // full precision now. `rate` is NUMERIC and stays exact. See
            // ../integerColumns.ts.
            [gameId, settlement.id, resource, toNumericColumn(settlement.warehouse[resource]), rate ?? null],
          );
        }

        await db.query(`DELETE FROM settlement_buildings WHERE game_id = $1 AND settlement_id = $2`, [
          gameId,
          settlement.id,
        ]);
        // Every building the settlement owns -- main city AND every district --
        // as one row each. A district's buildings are attributed to their own
        // hex through district_q/district_r (migration 035), which is what keeps
        // a district's local (gx, gy) from colliding with the city's: both grids
        // start at (0, 0). Before 035 a district building had no row at all, so
        // the ledger's own sum was short by the districts' whole output (E8).
        // The DELETE above is the full sync: a district that lost a building
        // loses its row here, with no separate delete path to keep in sync.
        for (const { district, building } of settlementBuildingRows(settlement)) {
          await db.query(
            `INSERT INTO settlement_buildings (game_id, settlement_id, district_q, district_r, gx, gy, kind, level, style, w, h, construction, bank, workers, draft)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              gameId,
              settlement.id,
              district ? district.q : null,
              district ? district.r : null,
              building.gx,
              building.gy,
              building.kind,
              building.level,
              // style is NOT NULL and BuildingDef.style is optional, so an
              // absent key is resolved through the engine here rather than
              // written NULL. `??` only: a persisted value is never
              // rewritten, or the round-trip parity pins would diverge.
              building.style ?? resolvedPersistedStyle(settlement.name, building),
              building.w ?? null,
              building.h ?? null,
              building.construction ? JSON.stringify(building.construction) : null,
              // Absent pot writes NULL, never the string "undefined".
              building.bank ? JSON.stringify(building.bank) : null,
              // Workforce columns (migration 030), same conditional style:
              // absent state writes NULL (undefined -> NULL, 0 preserved).
              building.workers ?? null,
              building.draft ? JSON.stringify(building.draft) : null,
            ],
          );
        }

        // Garrison platoons (unit-recruitment/garrison plan task 2), the
        // settlement-side mirror of heroRepo's hero_platoons flattening.
        // settlementStacks() normalizes absent stacks to 8 empty platoons,
        // so a legacy settlement without a `stacks` field writes zero rows.
        await db.query(`DELETE FROM settlement_platoons WHERE game_id = $1 AND settlement_id = $2`, [
          gameId,
          settlement.id,
        ]);
        const stacks = settlementStacks(settlement);
        for (let stackIndex = 0; stackIndex < stacks.length; stackIndex++) {
          for (const entry of stacks[stackIndex].entries) {
            await db.query(
              `INSERT INTO settlement_platoons (game_id, settlement_id, stack_index, unit_type_id, count)
               VALUES ($1, $2, $3, $4, $5)`,
              [gameId, settlement.id, stackIndex, entry.unitTypeId, entry.count],
            );
          }
        }
      }
    },
  };
}
