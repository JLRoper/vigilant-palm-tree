import express from "express";
import cors from "cors";
import { initSchema } from "./db";
import { pool } from "./persistence/db";
import { router } from "./routes";

const PORT = Number(process.env.API_PORT ?? 3001);
const BIND_HOST = process.env.LAN_HOST === "1" ? "0.0.0.0" : "127.0.0.1";

async function main() {
  await initSchema();
  const app = express();
  app.use(cors());
  app.use(express.raw({ type: ["image/*", "application/octet-stream"], limit: "10mb" }));
  app.use(express.json());
  app.use("/api", router);

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
