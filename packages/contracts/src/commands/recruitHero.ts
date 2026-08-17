import type { HorseVariantId, PlayerSeat, SettlementId } from "../ids";

// Discriminated-union command for the port of server/routes.ts-adjacent
// recruiting flow (plan/2026-08-16-phase-3-parallel-dev-plan.md, Track
// 3.A Week 3+). Never had a dedicated route at all before this --
// src/state/turnController.ts's recruitHero() only ever ran
// @heroes/engine's recruitHero() against local client state, with zero
// server round-trip (see this port's PR description for the full
// cross-cutting finding on that).
//
// No client-allocated heroId on this command, unlike StartCharter's
// settlementId/charterId precedent: @heroes/engine's recruitHero() always
// self-allocates the new hero's id as "lowest unused h{N} among the
// player's own heroIds" (packages/engine/src/hero/recruit.ts), which is
// deterministic from state the server already has once its row is
// reasonably in sync. Matches this phase's established fire-and-forget
// philosophy (src/game/turnHooks.ts's onAiMove: client trusts its own
// local computation; the server call exists so the mutation eventually
// persists, not to reconcile a client-picked id in real time).
export interface RecruitHeroCommand {
  kind: "RecruitHero";
  gameName: string;
  actor: PlayerSeat;
  heroName: string;
  settlementId: SettlementId;
  horseVariant: HorseVariantId;
}
