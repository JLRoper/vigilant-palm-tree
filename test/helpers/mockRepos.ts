import type { HeroId, HeroState, Player, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import type { EventRepo, GameRepo } from "../../server/app/commandHandler";
import type { SettlementSnapshotInput, ResourceTransactionInput } from "../../server/persistence/repositories/gameRepo";

// In-memory doubles implementing commandHandler.ts's pre-agreed repo
// interface (plan/2026-08-16-phase-3-parallel-dev-plan.md, "Pre-agreed
// repo interface" section). server/persistence/repositories/ owns the
// real Postgres-backed implementation; this file lets Track 3.A's own
// tests run without needing a live DB connection.

// HydratableGameRow (packages/engine/src/hydrate.ts) has no `gold` field --
// it's a structural subset for hydrateGameState(), and legacy `gold` isn't
// something hydration reads. The real GameRow (server/persistence/
// repositories/gameRepo.ts) does carry it, though, and saveHeroesAndSettlements's
// `extra.gold` needs somewhere to land here too, or the mock silently drops
// it while the real repo persists it -- widen the stored row type by one
// optional field rather than diverge from GameRepo's actual contract.
type MockGameRow = HydratableGameRow & { gold?: number };

export function createMockGameRepo(
  seed: Record<string, HydratableGameRow>,
): GameRepo & { rows: Record<string, MockGameRow> } {
  const rows: Record<string, MockGameRow> = { ...seed };
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
        ...(extra?.gold !== undefined ? { gold: extra.gold } : {}),
      };
    },
    async insertSettlementSnapshots(
      _gameName: string,
      _snapshots: SettlementSnapshotInput[],
    ): Promise<void> {},
    async insertResourceTransactions(
      _gameName: string,
      _transactions: ResourceTransactionInput[],
    ): Promise<void> {},
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
