import type { HeroId, HeroState, Player, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import type { EventRepo, GameRepo } from "../../server/app/commandHandler";

// In-memory doubles implementing commandHandler.ts's pre-agreed repo
// interface (plan/2026-08-16-phase-3-parallel-dev-plan.md, "Pre-agreed
// repo interface" section). server/persistence/repositories/ owns the
// real Postgres-backed implementation; this file lets Track 3.A's own
// tests run without needing a live DB connection.

export function createMockGameRepo(
  seed: Record<string, HydratableGameRow>,
): GameRepo & { rows: Record<string, HydratableGameRow> } {
  const rows: Record<string, HydratableGameRow> = { ...seed };
  return {
    rows,
    async load(name: string): Promise<HydratableGameRow> {
      const row = rows[name];
      if (!row) throw new Error(`mock game not found: ${name}`);
      return row;
    },
    async saveHeroesAndSettlements(
      name: string,
      heroes: Record<HeroId, HeroState>,
      settlements: Record<SettlementId, SettlementState>,
      extra?: {
        players?: Player[];
        gold?: number;
        round?: number;
        day?: number;
        active_player_id?: number;
      },
    ): Promise<void> {
      const row = rows[name];
      if (!row) throw new Error(`mock game not found: ${name}`);
      rows[name] = {
        ...row,
        heroes,
        settlements,
        ...(extra?.players !== undefined ? { players: extra.players } : {}),
        ...(extra?.round !== undefined ? { round: extra.round } : {}),
        ...(extra?.day !== undefined ? { day: extra.day } : {}),
        ...(extra?.active_player_id !== undefined ? { active_player_id: extra.active_player_id } : {}),
      };
    },
  };
}

export interface RecordedEvent {
  gameName: string;
  kind: string;
  payload: unknown;
}

export function createMockEventRepo(): EventRepo & { events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  return {
    events,
    async append(gameName: string, kind: string, payload: unknown): Promise<void> {
      events.push({ gameName, kind, payload });
    },
  };
}
