import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { pool } from "./persistence/db";

export const authRouter = Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_DIGITS = 6;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RequestCodeBody = { email?: unknown };
type VerifyCodeBody = { email?: unknown; code?: unknown };

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_REGEX.test(trimmed) || trimmed.length > 254) return null;
  return trimmed;
}

function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${email}:${code}`).digest("hex");
}

function generateCode(): string {
  const max = 10 ** CODE_DIGITS;
  return String(randomInt(0, max)).padStart(CODE_DIGITS, "0");
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

declare module "express-serve-static-core" {
  interface Request {
    authEmail?: string;
  }
}

export async function loadSession(
  token: string | undefined,
): Promise<{ email: string } | null> {
  if (!token) return null;
  const r = await pool.query<{ email: string; last_seen_at: Date }>(
    `SELECT email, last_seen_at FROM user_sessions WHERE token = $1`,
    [token],
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  if (Date.now() - new Date(row.last_seen_at).getTime() > SESSION_TTL_MS) {
    await pool.query(`DELETE FROM user_sessions WHERE token = $1`, [token]).catch(() => {});
    return null;
  }
  void pool
    .query(`UPDATE user_sessions SET last_seen_at = now() WHERE token = $1`, [token])
    .catch(() => {});
  return { email: row.email };
}

function readBearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() || undefined;
  }
  return undefined;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readBearerToken(req);
  const session = await loadSession(token);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.authEmail = session.email;
  next();
}

authRouter.post("/request-code", async (req, res) => {
  const body = req.body as RequestCodeBody;
  const email = normalizeEmail(body?.email);
  if (!email) {
    res.status(400).json({ error: "invalid email" });
    return;
  }
  const code = generateCode();
  const codeHash = hashCode(email, code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  try {
    await pool.query(
      `INSERT INTO auth_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)`,
      [email, codeHash, expiresAt],
    );
    console.log(`[auth] login code for ${email}: ${code} (expires ${expiresAt.toISOString()})`);
    res.json({
      ok: true,
      email,
      expiresAt: expiresAt.toISOString(),
      ...(process.env.NODE_ENV === "production" ? {} : { devCode: code }),
    });
  } catch (err) {
    console.error("[auth] request-code failed:", err);
    res.status(500).json({ error: "internal" });
  }
});

authRouter.post("/verify-code", async (req, res) => {
  const body = req.body as VerifyCodeBody;
  const email = normalizeEmail(body?.email);
  if (!email) {
    res.status(400).json({ error: "invalid email" });
    return;
  }
  if (typeof body?.code !== "string" || body.code.length !== CODE_DIGITS) {
    res.status(400).json({ error: "invalid code" });
    return;
  }
  const codeHash = hashCode(email, body.code);
  try {
    const result = await pool.query<{ id: number; expires_at: Date; consumed_at: Date | null }>(
      `SELECT id, expires_at, consumed_at FROM auth_codes
         WHERE email = $1 AND code_hash = $2
         ORDER BY id DESC LIMIT 1`,
      [email, codeHash],
    );
    if (result.rowCount === 0) {
      res.status(401).json({ error: "invalid code" });
      return;
    }
    const row = result.rows[0];
    if (row.consumed_at) {
      res.status(401).json({ error: "code already used" });
      return;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      res.status(401).json({ error: "code expired" });
      return;
    }
    const token = generateToken();
    await pool.query(
      `UPDATE auth_codes SET consumed_at = now() WHERE id = $1`,
      [row.id],
    );
    await pool.query(
      `INSERT INTO user_sessions (token, email) VALUES ($1, $2)
         ON CONFLICT (token) DO UPDATE SET last_seen_at = now()`,
      [token, email],
    );
    res.json({ ok: true, email, token, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  } catch (err) {
    console.error("[auth] verify-code failed:", err);
    res.status(500).json({ error: "internal" });
  }
});

authRouter.get("/session", async (req, res) => {
  const token = readBearerToken(req);
  const session = await loadSession(token);
  if (!session) {
    res.status(401).json({ ok: false });
    return;
  }
  res.json({ ok: true, email: session.email });
});

authRouter.post("/logout", async (req, res) => {
  const token = readBearerToken(req);
  if (token) {
    await pool.query(`DELETE FROM user_sessions WHERE token = $1`, [token]).catch(() => {});
  }
  res.json({ ok: true });
});
