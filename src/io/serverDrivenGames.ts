import type { PlayerId } from "@heroes/contracts";

// Server-side AI actor (plan/2026-09-30-server-side-ai-actor.md Phase 1,
// "Client flip — THREE gates + one policy"): a per-game registry answering
// whether the ACTIVE game's AI seats are driven by the server's aiDriver
// (lobby.aiDriver === "server", persisted at creation when enemySlots > 0,
// D1/D8). Flagged games make every browser a spectator for AI turns: the
// primary-actor source, the garrison bridge's safe-phase gates, and
// multiplayerSync's driven-AI-seat skip all read this module.
//
// Registry semantics: default FALSE. Unknown metadata never disables
// browser driving -- and can never cause a correctness break either, since
// the SERVER rejects AI-seat commands on flagged games regardless of what
// the browser believes (D10); a late discovery only wastes a few rejected
// commands. Entries are fed from every game-bearing response path (creation
// + load via GameSessionManager.loadGame, and multiplayerSync.resync(), D8)
// and cleared on game switch (loadGame) and delete (api.deleteGame).

const serverDrivenGames = new Set<string>();

export type ServerDrivenFlagSource = {
  name: string;
  lobby?: { aiDriver?: "server" };
};

export function isServerDriven(gameName: string | null | undefined): boolean {
  return gameName != null && serverDrivenGames.has(gameName);
}

export function registerServerDriven(gameName: string): void {
  serverDrivenGames.add(gameName);
}

export function clearServerDriven(gameName: string): void {
  serverDrivenGames.delete(gameName);
}

// D8 read-point for any full game-bearing response (creation, load, resync).
// Registers a flagged game AND clears a previously-registered one whose
// fresh response lost the flag, so the server-controlled rollback (quiesce
// driver -> flip lobby.aiDriver -> clients refetch) propagates on the next
// poll without a browser restart.
export function syncServerDrivenFromGame(game: ServerDrivenFlagSource): void {
  if (game.lobby?.aiDriver === "server") {
    serverDrivenGames.add(game.name);
  } else {
    serverDrivenGames.delete(game.name);
  }
}

// The effective primary-actor answer for a flagged game: seat 0 AND not
// server-driven. Null seat (solo/no-server games, unclaimed embeds) keeps
// the legacy default-to-primary behavior. multiplayerSync's driven-seat
// gate deliberately does NOT use this helper: there an UNKNOWN seat must
// keep applying AI rows (the non-primary client's only source of AI state),
// so it checks `localSeat === 0 && !isServerDriven(...)` explicitly.
export function shouldDriveAi(gameName: string | null | undefined, localSeat: PlayerId | null): boolean {
  return !isServerDriven(gameName) && (localSeat ?? 0) === 0;
}
