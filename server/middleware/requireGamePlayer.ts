import type { Request, Response, NextFunction } from "express";
import { pool } from "../persistence/db";

declare module "express-serve-static-core" {
  interface Request {
    playerSeat?: number;
  }
}

interface ClaimedSeat {
  handle: string;
  email?: string;
  claimedAt: string;
}

const CACHE_TTL_MS = 5_000;

interface CacheEntry {
  claimed: Record<string, ClaimedSeat>;
  loadedAt: number;
}

const membershipCache = new Map<string, CacheEntry>();

async function loadClaimed(gameName: string): Promise<Record<string, ClaimedSeat> | null> {
  const cached = membershipCache.get(gameName);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.claimed;
  }
  const r = await pool.query<{ claimed: Record<string, ClaimedSeat> | null }>(
    `SELECT lobby->'claimed' AS claimed FROM games WHERE name = $1`,
    [gameName],
  );
  if (r.rowCount === 0) return null;
  const claimed = r.rows[0].claimed ?? {};
  membershipCache.set(gameName, { claimed, loadedAt: Date.now() });
  return claimed;
}

export function invalidateMembershipCache(gameName: string): void {
  membershipCache.delete(gameName);
}

// Resolves req.playerSeat from the caller's authenticated email against the
// target game's lobby.claimed[seat].email -- must run after requireAuth,
// which sets req.authEmail. Throws (rather than 500ing gracefully) if
// req.authEmail is unset, since that only happens if middleware order is
// silently broken -- the kind of bug that should fail loud in dev, not
// surface as a confusing 403 in prod.
export async function requireGamePlayer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.authEmail) {
    throw new Error("requireGamePlayer: req.authEmail is unset -- requireAuth must run first");
  }
  const gameName = String(req.params.name);
  const claimed = await loadClaimed(gameName);
  if (claimed === null) {
    res.status(404).json({ error: "game_not_found" });
    return;
  }
  const entry = Object.entries(claimed).find(([, seat]) => seat.email === req.authEmail);
  if (!entry) {
    res.status(403).json({ error: "not_a_player" });
    return;
  }
  req.playerSeat = Number(entry[0]);
  next();
}
