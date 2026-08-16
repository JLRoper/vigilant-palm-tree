import { Router } from "express";
import { pool } from "./persistence/db";

export const assetRouter = Router();

interface AssetRow {
  key: string;
  mime_type: string;
  data: Buffer;
  byte_size: number;
  created_at: string;
  updated_at: string;
}

interface AssetSummary {
  key: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
  updated_at: string;
}

assetRouter.get("/", async (_req, res) => {
  try {
    const r = await pool.query<AssetRow>(
      "SELECT key, mime_type, byte_size, created_at, updated_at FROM game_assets ORDER BY key"
    );
    const items: AssetSummary[] = r.rows.map((row) => ({
      key: row.key,
      mime_type: row.mime_type,
      byte_size: row.byte_size,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
    res.json(items);
  } catch (err) {
    console.error("[api] GET /assets threw:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

assetRouter.get("/:key", async (req, res) => {
  try {
    const r = await pool.query<AssetRow>(
      "SELECT key, mime_type, data, byte_size FROM game_assets WHERE key = $1",
      [req.params.key]
    );
    if (r.rowCount === 0) {
      res.status(404).json({ error: "asset not found" });
      return;
    }
    const row = r.rows[0];
    res.set("Content-Type", row.mime_type);
    res.set("Content-Length", String(row.byte_size));
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.send(row.data);
  } catch (err) {
    console.error("[api] GET /assets/:key threw:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

assetRouter.put("/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      res.status(400).json({ error: "body must be raw binary (image/png etc)" });
      return;
    }
    const mime = req.headers["content-type"] ?? "image/png";
    const r = await pool.query<AssetRow>(
      `INSERT INTO game_assets (key, mime_type, data, byte_size)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET
         mime_type = EXCLUDED.mime_type,
         data = EXCLUDED.data,
         byte_size = EXCLUDED.byte_size,
         updated_at = now()
       RETURNING key, mime_type, byte_size, created_at, updated_at`,
      [key, mime, buffer, buffer.length]
    );
    res.json({
      key: r.rows[0].key,
      mime_type: r.rows[0].mime_type,
      byte_size: r.rows[0].byte_size,
      updated_at: r.rows[0].updated_at,
    });
  } catch (err) {
    console.error("[api] PUT /assets/:key threw:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

assetRouter.delete("/:key", async (req, res) => {
  try {
    const r = await pool.query(
      "DELETE FROM game_assets WHERE key = $1",
      [req.params.key]
    );
    if (r.rowCount === 0) {
      res.status(404).json({ error: "asset not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    console.error("[api] DELETE /assets/:key threw:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});

assetRouter.post("/batch-upload", async (req, res) => {
  try {
    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "files array required: [{key, mime_type, data_base64}]" });
      return;
    }
    const results: AssetSummary[] = [];
    for (const f of files) {
      if (!f.key || !f.data_base64) continue;
      const buf = Buffer.from(f.data_base64, "base64");
      const mime = f.mime_type ?? "image/png";
      const r = await pool.query<AssetRow>(
        `INSERT INTO game_assets (key, mime_type, data, byte_size)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET
           mime_type = EXCLUDED.mime_type,
           data = EXCLUDED.data,
           byte_size = EXCLUDED.byte_size,
           updated_at = now()
         RETURNING key, mime_type, byte_size, created_at, updated_at`,
        [f.key, mime, buf, buf.length]
      );
      results.push({
        key: r.rows[0].key,
        mime_type: r.rows[0].mime_type,
        byte_size: r.rows[0].byte_size,
        created_at: r.rows[0].created_at,
        updated_at: r.rows[0].updated_at,
      });
    }
    res.status(201).json(results);
  } catch (err) {
    console.error("[api] POST /assets/batch-upload threw:", err);
    res.status(500).json({ error: "internal", message: String(err) });
  }
});
