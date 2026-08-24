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

// Sign-in is optional -- this never rejects the request, and a missing or
// nonexistent game is left for the route handler's own lookup to 404 on (it
// needs to re-load the row anyway). If the caller is authenticated
// (attachAuth already ran and set req.authEmail) and has claimed a seat in
// this game, sets req.playerSeat so the commands route's actor-vs-seat check
// can bind to a real identity; anonymous or unclaimed callers just proceed
// with req.playerSeat left unset, falling back to the client-trusted
// `actor` field the same way the app worked before #179.
export async function attachPlayerSeat(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.authEmail) {
    next();
    return;
  }
  const claimed = await loadClaimed(String(req.params.name));
  if (claimed) {
    const entry = Object.entries(claimed).find(([, seat]) => seat.email === req.authEmail);
    if (entry) req.playerSeat = Number(entry[0]);
  }
  next();
}
