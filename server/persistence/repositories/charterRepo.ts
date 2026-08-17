import type { CharterState, ResourceType } from "@heroes/contracts";
import { resolveGameId } from "./gameRepo";
import type { Queryable } from "./gameRepo";

// Phase 4 (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md). Closes the
// activeCharters persistence gap found while designing this phase:
// packages/engine/src/hydrate.ts:159 hard-defaults activeCharters to []
// because no table existed for it before this migration -- this is why
// StartCharter/AdvanceCharter have stayed unported (Phase 3's PR #91 scope
// note; Phase 3 itself explicitly ruled out schema changes). Nothing reads
// from this repo yet -- server/persistence/hydrate.ts (Track A) is the
// first real consumer.
export interface CharterRepo {
  loadAllForGame(gameName: string): Promise<CharterState[]>;
  // Full sync, same rule as heroRepo/settlementRepo.upsertMany: GameState.
  // activeCharters is always passed in full (never a delta), so this deletes
  // any row for the game not present in `charters`, then upserts the rest.
  // A charter completing (founding its settlement, leaving activeCharters)
  // falls out of this for free -- no separate delete call needed.
  upsertMany(gameName: string, charters: CharterState[]): Promise<void>;
}

interface CharterRow {
  id: string;
  hero_id: string;
  owner_id: number;
  target_q: number;
  target_r: number;
  settlement_name: string;
  phase: CharterState["phase"];
  days_remaining: number;
  settlement_id: string;
  resource_rates: Partial<Record<ResourceType, number>>;
  founded_on_resource: string | null;
  city_spots: CharterState["citySpots"];
}

const CHARTER_COLUMNS =
  "id, hero_id, owner_id, target_q, target_r, settlement_name, phase, days_remaining, settlement_id, resource_rates, founded_on_resource, city_spots";

function toCharterState(row: CharterRow): CharterState {
  return {
    id: row.id,
    heroId: row.hero_id,
    ownerId: row.owner_id,
    targetQ: row.target_q,
    targetR: row.target_r,
    settlementName: row.settlement_name,
    phase: row.phase,
    daysRemaining: row.days_remaining,
    settlementId: row.settlement_id,
    resourceRates: row.resource_rates,
    foundedOnResource: (row.founded_on_resource as ResourceType | null) ?? null,
    citySpots: row.city_spots,
  };
}

export function createCharterRepo(db: Queryable): CharterRepo {
  return {
    async loadAllForGame(gameName) {
      const gameId = await resolveGameId(db, gameName);
      const r = await db.query<CharterRow>(
        `SELECT ${CHARTER_COLUMNS} FROM charters WHERE game_id = $1`,
        [gameId],
      );
      return r.rows.map(toCharterState);
    },

    async upsertMany(gameName, charters) {
      const gameId = await resolveGameId(db, gameName);
      const ids = charters.map((c) => c.id);
      await db.query(`DELETE FROM charters WHERE game_id = $1 AND NOT (id = ANY($2::text[]))`, [
        gameId,
        ids,
      ]);

      for (const charter of charters) {
        await db.query(
          `INSERT INTO charters (id, game_id, hero_id, owner_id, target_q, target_r, settlement_name,
                                  phase, days_remaining, settlement_id, resource_rates,
                                  founded_on_resource, city_spots)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             game_id = EXCLUDED.game_id,
             hero_id = EXCLUDED.hero_id,
             owner_id = EXCLUDED.owner_id,
             target_q = EXCLUDED.target_q,
             target_r = EXCLUDED.target_r,
             settlement_name = EXCLUDED.settlement_name,
             phase = EXCLUDED.phase,
             days_remaining = EXCLUDED.days_remaining,
             settlement_id = EXCLUDED.settlement_id,
             resource_rates = EXCLUDED.resource_rates,
             founded_on_resource = EXCLUDED.founded_on_resource,
             city_spots = EXCLUDED.city_spots`,
          [
            charter.id,
            gameId,
            charter.heroId,
            charter.ownerId,
            charter.targetQ,
            charter.targetR,
            charter.settlementName,
            charter.phase,
            charter.daysRemaining,
            charter.settlementId,
            JSON.stringify(charter.resourceRates),
            charter.foundedOnResource,
            JSON.stringify(charter.citySpots),
          ],
        );
      }
    },
  };
}
