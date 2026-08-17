import type { HeroId, HeroState, HorseVariantId, Platoon } from "@heroes/contracts";
import { resolveGameId } from "./gameRepo";
import type { Queryable } from "./gameRepo";

// Phase 4 (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md). Granular
// mirror of games.heroes' JSONB shape. Nothing reads from this repo yet --
// server/persistence/hydrate.ts (Track A) is the first real consumer, with a
// JSONB fallback for games that haven't been backfilled. Until then this
// repo's writes are additive/inert.
export interface HeroRepo {
  loadAllForGame(gameName: string): Promise<HeroState[]>;
  // Full sync, not a merge: commandHandler.ts always calls
  // gameRepo.saveHeroesAndSettlements with the *entire* heroes record (every
  // @heroes/engine reducer returns the whole GameState, not a delta) --
  // upsertMany mirrors that by deleting any row for this game whose id isn't
  // in `heroes`, then upserting everything that is. This is what makes hero
  // death (or any other removal) fall out for free, with no separate delete
  // method to keep in sync with the JSONB write.
  upsertMany(gameName: string, heroes: Record<HeroId, HeroState>): Promise<void>;
}

interface HeroRow {
  id: string;
  name: string;
  owner_id: number;
  q: number;
  r: number;
  movement_remaining: number;
  previous_q: number | null;
  previous_r: number | null;
  previous_movement_remaining: number | null;
  trail: { q: number; r: number }[];
  gold: number;
  troops: number;
  is_chartering: boolean;
  charter_id: string | null;
  horse_variant: string;
}

interface PlatoonRow {
  hero_id: string;
  stack_index: number;
  unit_type_id: string;
  count: number;
}

const HERO_COLUMNS =
  "id, name, owner_id, q, r, movement_remaining, previous_q, previous_r, previous_movement_remaining, trail, gold, troops, is_chartering, charter_id, horse_variant";

function toHeroState(row: HeroRow, stacks: Platoon[]): HeroState {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    q: row.q,
    r: row.r,
    movementRemaining: row.movement_remaining,
    previousQ: row.previous_q,
    previousR: row.previous_r,
    previousMovementRemaining: row.previous_movement_remaining,
    trail: row.trail,
    gold: row.gold,
    troops: row.troops,
    stacks,
    isChartering: row.is_chartering,
    charterId: row.charter_id,
    horseVariant: row.horse_variant as HorseVariantId,
  };
}

// Reassembles Platoon[] from hero_platoons' flattened (hero_id, stack_index,
// unit_type_id, count) rows -- the inverse of upsertMany's flattening below.
// Sparse stack_index values (shouldn't happen from this repo's own writes,
// but defends against hand-edited rows) leave a hole with an empty-entries
// Platoon rather than shifting later stacks into the gap, since stack
// position is meaningful (it's army organization the player controls, see
// packages/engine/src/hero/stacks.ts's reorderStack).
function assemblePlatoons(rows: PlatoonRow[]): Platoon[] {
  const stacks: Platoon[] = [];
  for (const row of rows) {
    for (let i = stacks.length; i <= row.stack_index; i++) stacks[i] = { entries: [] };
    stacks[row.stack_index].entries.push({ unitTypeId: row.unit_type_id, count: row.count });
  }
  return stacks;
}

export function createHeroRepo(db: Queryable): HeroRepo {
  return {
    async loadAllForGame(gameName) {
      const gameId = await resolveGameId(db, gameName);
      const heroesResult = await db.query<HeroRow>(
        `SELECT ${HERO_COLUMNS} FROM heroes WHERE game_id = $1`,
        [gameId],
      );
      if (heroesResult.rowCount === 0) return [];

      const heroIds = heroesResult.rows.map((h) => h.id);
      const platoonsResult = await db.query<PlatoonRow>(
        `SELECT hero_id, stack_index, unit_type_id, count FROM hero_platoons
         WHERE hero_id = ANY($1::text[]) ORDER BY hero_id, stack_index, unit_type_id`,
        [heroIds],
      );
      const platoonsByHero = new Map<string, PlatoonRow[]>();
      for (const row of platoonsResult.rows) {
        const rows = platoonsByHero.get(row.hero_id) ?? [];
        rows.push(row);
        platoonsByHero.set(row.hero_id, rows);
      }

      return heroesResult.rows.map((row) =>
        toHeroState(row, assemblePlatoons(platoonsByHero.get(row.id) ?? [])),
      );
    },

    async upsertMany(gameName, heroes) {
      const gameId = await resolveGameId(db, gameName);
      const ids = Object.values(heroes).map((h) => h.id);
      await db.query(`DELETE FROM heroes WHERE game_id = $1 AND NOT (id = ANY($2::text[]))`, [
        gameId,
        ids,
      ]);

      for (const hero of Object.values(heroes)) {
        await db.query(
          `INSERT INTO heroes (id, game_id, name, owner_id, q, r, movement_remaining, previous_q,
                                previous_r, previous_movement_remaining, trail, gold, troops,
                                is_chartering, charter_id, horse_variant)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)
           ON CONFLICT (id) DO UPDATE SET
             game_id = EXCLUDED.game_id,
             name = EXCLUDED.name,
             owner_id = EXCLUDED.owner_id,
             q = EXCLUDED.q,
             r = EXCLUDED.r,
             movement_remaining = EXCLUDED.movement_remaining,
             previous_q = EXCLUDED.previous_q,
             previous_r = EXCLUDED.previous_r,
             previous_movement_remaining = EXCLUDED.previous_movement_remaining,
             trail = EXCLUDED.trail,
             gold = EXCLUDED.gold,
             troops = EXCLUDED.troops,
             is_chartering = EXCLUDED.is_chartering,
             charter_id = EXCLUDED.charter_id,
             horse_variant = EXCLUDED.horse_variant`,
          [
            hero.id,
            gameId,
            hero.name,
            hero.ownerId,
            hero.q,
            hero.r,
            hero.movementRemaining,
            hero.previousQ,
            hero.previousR,
            hero.previousMovementRemaining,
            JSON.stringify(hero.trail),
            hero.gold,
            hero.troops,
            hero.isChartering,
            hero.charterId,
            hero.horseVariant,
          ],
        );

        // Stacks are always replaced wholesale along with their parent hero
        // (never diffed entry-by-entry) -- same full-sync rule as the
        // heroes table itself, and simpler than reconciling stack reorders.
        await db.query(`DELETE FROM hero_platoons WHERE hero_id = $1`, [hero.id]);
        for (let stackIndex = 0; stackIndex < hero.stacks.length; stackIndex++) {
          for (const entry of hero.stacks[stackIndex].entries) {
            await db.query(
              `INSERT INTO hero_platoons (hero_id, stack_index, unit_type_id, count)
               VALUES ($1, $2, $3, $4)`,
              [hero.id, stackIndex, entry.unitTypeId, entry.count],
            );
          }
        }
      }
    },
  };
}
