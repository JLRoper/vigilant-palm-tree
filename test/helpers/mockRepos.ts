import type { HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import type { EventRepo, GameRepo } from "../../server/app/commandHandler";

// In-memory doubles implementing commandHandler.ts's pre-agreed repo
// interface (plan/2026-08-16-phase-3-parallel-dev-plan.md, "Pre-agreed
// repo interface" section). Track 3.B owns the real Postgres-backed
// implementation in server/persistence/repositories/; this file lets
// Track 3.A's own tests run without blocking on that landing, per the
// plan's own stated fallback ("Track 3.A still has mockRepos.ts to develop
// and test against"). Track 3.B should take over/expand this file once its
// real repos exist.

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
    ): Promise<void> {
      const row = rows[name];
      if (!row) throw new Error(`mock game not found: ${name}`);
      rows[name] = { ...row, heroes, settlements };
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
