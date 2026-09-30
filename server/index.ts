import express from "express";
import cors from "cors";
import { initSchema, pool } from "./db";
import { router } from "./routes";
import { errorHandler } from "./errorHandler";
import { startDropPolicyScanner } from "./app/dropPolicy";
import { startAiDriver } from "./app/aiDriver";

const PORT = Number(process.env.API_PORT ?? 3001);
const BIND_HOST = process.env.LAN_HOST === "1" ? "0.0.0.0" : "127.0.0.1";

async function main() {
  await initSchema();
  // Drop policy (docs/multiplayer.md, shipped 2026-09-27): the in-process
  // scanner that marks silent seats disconnected and runs the grace-timed
  // server-side EndTurn skip. Heartbeats themselves arrive via the
  // telemetry/commands routes (touchSeat); this interval only re-examines.
  // Everything it owns is in-process by design -- an API restart restarts
  // any in-flight grace clock (accepted tradeoff, see the doc's locked
  // decisions), and the unref'd timer never holds the process open.
  startDropPolicyScanner();
  // Server-side AI actor (plan/2026-09-30-server-side-ai-actor.md Phase 1):
  // the scanner that drives AI seats end-to-end for games flagged
  // lobby.aiDriver === "server" (created with enemySlots > 0). Same
  // in-process, unref'd-interval shape as the drop policy scanner; its
  // commands dispatch through handleCommandTransactional, never HTTP.
  startAiDriver();
  const app = express();
  app.use(cors());
  app.use(express.raw({ type: ["image/*", "application/octet-stream"], limit: "10mb" }));
  app.use(express.json());
  app.use("/api", router);
  // Must be registered last -- Express only calls a 4-arg (err, req, res,
  // next) middleware when something upstream calls next(err) (or, in
  // Express 5, when an async handler's returned promise rejects). See #98.
  app.use(errorHandler);

  app.listen(PORT, BIND_HOST, () => {
    console.log(`>> api listening on http://${BIND_HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error("server failed to start:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});
