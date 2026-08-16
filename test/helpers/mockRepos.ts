import type {
  EventRepo,
  GameRepo,
  GameRow,
} from "../../server/persistence/repositories/gameRepo";

// In-memory GameRepo double -- same interface as the real Postgres-backed
// repo (server/persistence/repositories/gameRepo.ts), so a test can swap
// one for the other without touching call-site code.
export function makeMockGameRepo(rows: GameRow[]): GameRepo {
  const byName = new Map(rows.map((r) => [r.name, r]));
  return {
    async load(name) {
      const row = byName.get(name);
      if (!row) throw new Error(`game not found: ${name}`);
      return row;
    },
    async saveHeroesAndSettlements(name, heroes, settlements) {
      const row = byName.get(name);
      if (!row) throw new Error(`game not found: ${name}`);
      row.heroes = heroes;
      row.settlements = settlements;
    },
  };
}

export interface RecordedEvent {
  gameId: number;
  kind: string;
  payload: unknown;
}

export function makeMockEventRepo(): EventRepo & { events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  return {
    events,
    async append(gameId, kind, payload) {
      events.push({ gameId, kind, payload });
    },
  };
}
