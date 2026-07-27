import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __dirname = fileURLToPath(new URL(".", import.meta.url));

interface AssetMapping {
  fileName: string;
  key: string;
}

function buildKeyMappings(): AssetMapping[] {
  const resourceDir = join(__dirname, "..", "src", "resources");
  const mappings: AssetMapping[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === ".bak" || entry === ".recycled") continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith(".png")) continue;

      const rel = relative(resourceDir, full).replace(/\\/g, "/");
      const stem = basename(entry, ".png");
      let key = stem;

      // Castle sprites
      if (stem === "castle-l1") key = "castle.1";
      else if (stem === "castle-l1-alt") key = "castle-alt.1";
      else if (stem === "castle-l2") key = "castle.2";
      else if (stem === "castle-l2-alt") key = "castle-alt.2";
      else if (stem === "castle-l3") key = "castle.3";
      else if (stem === "castle-l3-alt") key = "castle-alt.3";
      // Banners
      else if (stem === "settlement-banner") key = "banner.settlement.1";
      else if (stem === "city-banner") key = "banner.settlement.2";
      else if (stem === "castle-banner") key = "banner.settlement.3";
      else if (stem.startsWith("hero-banner-")) {
        key = `banner.hero.${stem.replace("hero-banner-", "")}`;
      }
      // Resources
      else if (stem.startsWith("resource-")) {
        key = `resource.${stem.replace("resource-", "")}`;
      }
      // Buildings
      else if (stem.startsWith("building-")) {
        key = `building.${stem.replace("building-", "")}`;
      }
      // Unit sprites
      else if (stem.startsWith("hero-player-")) {
        key = `hero.player.${stem.replace("hero-player-", "")}`;
      }
      // Horse variants in commander dirs
      else if (rel.startsWith("units/horse/")) {
        key = `horse.${rel.replace(/^units\/horse\//, "").replace(/\//g, ".").replace(/\.png$/i, "")}`;
      }
      // Unit images
      else if (rel.startsWith("units/")) {
        key = `unit.${rel.replace(/^units\//, "").replace(/\//g, ".").replace(/\.png$/i, "")}`;
      }
      // Skybox
      else if (rel.startsWith("skybox/")) {
        key = `skybox.${stem}`;
      }

      mappings.push({ fileName: full, key });
    }
  }

  walk(resourceDir);
  return mappings;
}

async function seed() {
  const pool = new Pool({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "gameuser",
    password: process.env.PGPASSWORD ?? "gamepass",
    database: process.env.PGDATABASE ?? "game_poc",
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_assets (
        key       TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL DEFAULT 'image/png',
        data      BYTEA NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS game_assets_mime_idx ON game_assets (mime_type);
    `);

    const mappings = buildKeyMappings();
    console.log(`Found ${mappings.length} PNG files to seed`);

    let inserted = 0;
    let skipped = 0;

    for (const { fileName, key } of mappings) {
      const existing = await pool.query("SELECT 1 FROM game_assets WHERE key = $1", [key]);
      if (existing.rowCount! > 0) {
        skipped++;
        continue;
      }

      const data = readFileSync(fileName);
      await pool.query(
        "INSERT INTO game_assets (key, mime_type, data, byte_size) VALUES ($1, $2, $3, $4)",
        [key, "image/png", data, data.length]
      );
      inserted++;
      console.log(`  [${inserted + skipped}/${mappings.length}] ${key}`);
    }

    console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`);
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
