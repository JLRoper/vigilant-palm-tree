import { Router, type Request } from "express";
import type { ClientTelemetryReport } from "@heroes/contracts";
import { getSnapshot, recordSample } from "../../telemetry/presenceRegistry";
import { getPresence, touchSeat } from "../../app/dropPolicy";

// POST/GET /api/games/:name/telemetry -- the dev Network Map's data plane
// (issue #51, plan/2026-08-17-issue-51-network-map.md §2).
//
// { mergeParams: true } is required for :name to reach this router at all,
// same as commandsRouter -- an Express child router mounted via
// router.use(path, child) does not otherwise inherit the parent's matched
// params. See server/http/routes/commands.ts's header for the full story.
//
// This router deliberately never touches the DB *schema's tables for game
// state*: presence is in-memory and ephemeral by design, so a report for
// an unknown game name is simply recorded rather than 404'd against
// `games`. (The drop-policy presence module does write transition-driven
// lobby.presence updates to the games row -- see server/app/dropPolicy.ts
// -- but only for transitions, never per report.)
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
  // Drop-policy heartbeat (docs/multiplayer.md, shipped 2026-09-27): the
  // per-poll telemetry report doubles as the enforcement-grade seat
  // heartbeat. touchSeat is in-memory plus transition-driven row writes, so
  // this stays as cheap as the dev-registry recordSample beside it.
  touchSeat(req.params.name, report.playerId);
  // 200 + body (was 204): the response now carries the seat-presence view
  // (drop policy's disconnected-seat signal) so the client's per-poll
  // telemetry call -- which it already makes every cycle -- doubles as the
  // lightweight per-poll presence read. Old clients that ignore the body
  // are unaffected; a 204 from an older API process just parses as null.
  res.json({ presence: getPresence(req.params.name) });
});

telemetryRouter.get("/", (req: Request<{ name: string }>, res) => {
  res.json(getSnapshot(req.params.name));
});
