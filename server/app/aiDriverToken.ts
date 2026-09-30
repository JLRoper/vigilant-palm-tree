import { randomUUID } from "node:crypto";

// Boot-token scoping for the server-side AI driver (cross-server race fix,
// 2026-09-30): every process generates one random token at boot, POST /games
// stamps it into lobby.aiDriverToken beside lobby.aiDriver = "server", and
// the scanner only drives games carrying ITS token (or no token at all --
// the legacy adoption path, where the advisory lock makes first-claimed-
// wins per scan). Effect: dev worktrees sharing one game_db never drive
// each other's AI games; each server drives the games it created.
//
// Leaf module on purpose: both server/app/aiDriver.ts (scanner default) and
// server/routes.ts (stamping) import it without pulling in the driver's
// whole command/hydrate graph.

let bootToken: string | null = null;

/** This process's AI-driver token; generated once, stable for the process lifetime. */
export function aiDriverBootToken(): string {
  if (bootToken === null) bootToken = randomUUID();
  return bootToken;
}

/** Test seam: forget the memoized token so the next call generates a fresh one. */
export function resetAiDriverBootToken(): void {
  bootToken = null;
}
