import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./server/persistence/db";

test("DIAG: connected DB + faction counts", async () => {
  const db = await pool.query("SELECT current_database() AS db").then((r) => r.rows[0].db);
  console.log("[DIAG] CONNECTED_DB:", db);
  const factions = await pool.query(
    "SELECT faction_id, count(*) AS n FROM unit_types GROUP BY faction_id ORDER BY faction_id"
  );
  console.log("[DIAG] FACTIONS:", JSON.stringify(factions.rows));
  await pool.end();
});
