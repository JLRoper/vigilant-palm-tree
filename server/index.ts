import express from "express";
import cors from "cors";
import { initSchema, pool } from "./db";
import { router } from "./routes";

const PORT = Number(process.env.API_PORT ?? 3001);

async function main() {
  await initSchema();
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", router);

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`>> api listening on http://127.0.0.1:${PORT}`);
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
