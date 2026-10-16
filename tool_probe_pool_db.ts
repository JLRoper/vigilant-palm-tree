import { pool } from "./server/persistence/db";
(async () => {
  const res = await pool.query("SELECT current_database() AS db");
  console.log("CONNECTED_DB:", res.rows[0].db);
  const factions = await pool.query(
    "SELECT faction_id, count(*) AS n FROM unit_types GROUP BY faction_id ORDER BY faction_id"
  );
  console.log("FACTIONS:", JSON.stringify(factions.rows));
  await pool.end();
})();
