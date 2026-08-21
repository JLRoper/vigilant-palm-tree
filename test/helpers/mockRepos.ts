import type { CharterState, HeroId, HeroState, Player, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import type { CharterRepo, EventRepo, GameRepo, HeroRepo, SettlementRepo } from "../../server/app/commandHandler";
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
        next_charter_id?: number;
        next_settlement_id?: number;
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
        ...(extra?.next_charter_id !== undefined ? { next_charter_id: extra.next_charter_id } : {}),
        ...(extra?.next_settlement_id !== undefined ? { next_settlement_id: extra.next_settlement_id } : {}),
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
  actorSeat: number | null;
}

export function createMockEventRepo(): EventRepo & { events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  return {
    events,
    async append(gameName: string, kind: string, payload: unknown, actorSeat: number | null): Promise<number> {
      events.push({ gameName, kind, payload, actorSeat });
      return events.length;
    },
  };
}

// Phase 4 Track A (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md).
// In-memory doubles for commandHandler.ts's HeroRepo/SettlementRepo/
// CharterRepo, same rationale as createMockGameRepo/createMockEventRepo
// above. Unseeded (the default in every existing commandHandler.test.ts
// call site) means loadAllForGame returns [] for every game -- that's
// exactly the "granular tables empty" signal server/persistence/hydrate.ts's
// hydrateFromRepos() treats as "fall back to the legacy JSONB row," so
// every pre-Phase-4 test keeps exercising the JSONB path unchanged without
// needing to know these repos exist. Tests that DO want to exercise the
// granular-read path seed `rows` up front; tests that want to assert on the
// dual-write step inspect `calls`.
export interface RecordedUpsert<T> {
  gameName: string;
  value: T;
}

export function createMockHeroRepo(
  seed: Record<string, Record<HeroId, HeroState>> = {},
): HeroRepo & { rows: Record<string, Record<HeroId, HeroState>>; calls: RecordedUpsert<Record<HeroId, HeroState>>[] } {
  const rows: Record<string, Record<HeroId, HeroState>> = { ...seed };
  const calls: RecordedUpsert<Record<HeroId, HeroState>>[] = [];
  return {
    rows,
    calls,
    async loadAllForGame(gameName: string): Promise<HeroState[]> {
      return Object.values(rows[gameName] ?? {});
    },
    async upsertMany(gameName: string, heroes: Record<HeroId, HeroState>): Promise<void> {
      calls.push({ gameName, value: heroes });
      rows[gameName] = heroes;
    },
  };
}

export function createMockSettlementRepo(
  seed: Record<string, Record<SettlementId, SettlementState>> = {},
): SettlementRepo & {
  rows: Record<string, Record<SettlementId, SettlementState>>;
  calls: RecordedUpsert<Record<SettlementId, SettlementState>>[];
} {
  const rows: Record<string, Record<SettlementId, SettlementState>> = { ...seed };
  const calls: RecordedUpsert<Record<SettlementId, SettlementState>>[] = [];
  return {
    rows,
    calls,
    async loadAllForGame(gameName: string): Promise<SettlementState[]> {
      return Object.values(rows[gameName] ?? {});
    },
    async upsertMany(gameName: string, settlements: Record<SettlementId, SettlementState>): Promise<void> {
      calls.push({ gameName, value: settlements });
      rows[gameName] = settlements;
    },
  };
}

export function createMockCharterRepo(
  seed: Record<string, CharterState[]> = {},
): CharterRepo & { rows: Record<string, CharterState[]>; calls: RecordedUpsert<CharterState[]>[] } {
  const rows: Record<string, CharterState[]> = { ...seed };
  const calls: RecordedUpsert<CharterState[]>[] = [];
  return {
    rows,
    calls,
    async loadAllForGame(gameName: string): Promise<CharterState[]> {
      return rows[gameName] ?? [];
    },
    async upsertMany(gameName: string, charters: CharterState[]): Promise<void> {
      calls.push({ gameName, value: charters });
      rows[gameName] = charters;
    },
  };
}
