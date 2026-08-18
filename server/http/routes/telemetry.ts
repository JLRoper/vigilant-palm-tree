import { Router, type Request } from "express";
import type { ClientTelemetryReport } from "@heroes/contracts";
import { getSnapshot, recordSample } from "../../telemetry/presenceRegistry";

// POST/GET /api/games/:name/telemetry -- the dev Network Map's data plane
// (issue #51, plan/2026-08-17-issue-51-network-map.md §2).
//
// { mergeParams: true } is required for :name to reach this router at all,
// same as commandsRouter -- an Express child router mounted via
// router.use(path, child) does not otherwise inherit the parent's matched
// params. See server/http/routes/commands.ts's header for the full story.
//
// This router deliberately never touches the DB: presence is in-memory and
// ephemeral by design, so a report for an unknown game name is simply
// recorded rather than 404'd against `games`.
export const telemetryRouter = Router({ mergeParams: true });

function parseReport(body: unknown): ClientTelemetryReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  // playerId is a seat number (PlayerId), not a string -- a client that
  // hasn't claimed a seat has no identity to report and simply doesn't post.
  if (typeof b.playerId !== "number" || !Number.isInteger(b.playerId) || b.playerId < 0) {
    return null;
  }
  if (typeof b.label !== "string") return null;
  if (typeof b.rttMs !== "number" || !Number.isFinite(b.rttMs) || b.rttMs < 0) return null;
  if (
    typeof b.responseBytes !== "number" ||
    !Number.isFinite(b.responseBytes) ||
    b.responseBytes < 0
  ) {
    return null;
  }
  if (typeof b.ok !== "boolean") return null;
  return {
    playerId: b.playerId,
    label: b.label.slice(0, 64),
    rttMs: b.rttMs,
    responseBytes: b.responseBytes,
    ok: b.ok,
  };
}

telemetryRouter.post("/", (req: Request<{ name: string }>, res) => {
  const report = parseReport(req.body);
  if (!report) {
    res.status(400).json({ error: "invalid telemetry report" });
    return;
  }
  // receivedAt is stamped server-side rather than trusted from the client, so
  // staleness expiry can't be skewed by a wrong clock on a player's machine.
  recordSample(req.params.name, { ...report, receivedAt: Date.now() });
  res.status(204).end();
});

telemetryRouter.get("/", (req: Request<{ name: string }>, res) => {
  res.json(getSnapshot(req.params.name));
});
