import express from "express";
import cors from "cors";
import { initSchema, pool } from "./db";
import { router } from "./routes";

const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  await initSchema();
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", router);

  app.listen(PORT, () => {
    console.log(`>> api listening on http://localhost:${PORT}`);
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
