import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { pool } from "./db";

export const authRouter = Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_DIGITS = 6;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RequestCodeBody = { email?: unknown };
type VerifyCodeBody = { email?: unknown; code?: unknown; account_name?: unknown };
type RegisterBody = { account_name?: unknown; email?: unknown };
type UpdateAccountNameBody = { account_name?: unknown };

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

// Sign-in is optional (see src/screens/home/homeView.ts's footer message) --
// this never rejects the request. If a valid bearer token is present it sets
// req.authEmail so downstream middleware/handlers can offer signed-in-only
// benefits (see attachPlayerSeat.ts); an anonymous or invalid-token caller
// just proceeds with req.authEmail unset.
export async function attachAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readBearerToken(req);
  const session = await loadSession(token);
  if (session) {
    req.authEmail = session.email;
  }
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
    // Account upsert: the `users` row is created on the account's very first
    // login. `account_name` uses the supplied value when present, otherwise a
    // readable default derived from the email local-part (rename later via
    // PATCH /auth/me -- a later login never overwrites the existing name).
    const supplied = typeof body?.account_name === "string" ? body.account_name.trim() : "";
    const derived = (email.split("@")[0] ?? "").replace(/[^A-Za-z0-9_. -]/g, "").trim();
    const account_name = (supplied || derived || "player").slice(0, 64);
    await pool.query(
      `INSERT INTO users (account_name, email)
       VALUES ($1, $2)
       ON CONFLICT (lower(email)) DO NOTHING`,
      [account_name, email],
    );
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
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "duplicate account name or email" });
      return;
    }
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

// ---------------------------------------------------------
// Registration + profile
// ---------------------------------------------------------

authRouter.post("/register", async (req, res) => {
  const body = req.body as RegisterBody;
  const account_name = typeof body?.account_name === "string" ? body.account_name.trim() : "";
  const email = normalizeEmail(body?.email);
  if (!account_name || account_name.length > 64) {
    res.status(400).json({ error: "invalid account name" });
    return;
  }
  if (!email) {
    res.status(400).json({ error: "invalid email" });
    return;
  }
  try {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO users (account_name, email) VALUES ($1, $2) RETURNING id`,
      [account_name, email],
    );
    res.json({ ok: true, id: r.rows[0].id, account_name, email, email_verified_at: null });
  } catch (err) {
    console.error("[auth] register failed:", err);
    res.status(409).json({ error: "duplicate account name or email" });
  }
});

authRouter.get("/me", async (req, res) => {
  const token = readBearerToken(req);
  const session = await loadSession(token);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const email = session.email;
  try {
    const userResult = await pool.query<{ id: number; account_name: string; email: string; email_verified_at: Date | null }>(
      `SELECT id, account_name, email, email_verified_at FROM users WHERE email = $1`,
      [email],
    );
    if (userResult.rowCount === 0) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    const user = userResult.rows[0];
    const statsResult = await pool.query<{ games_started: number; last_played_at: Date | null }>(
      `SELECT games_started, last_played_at FROM user_stats WHERE user_id = $1`,
      [user.id],
    );
    const stats = statsResult.rows[0] ?? { games_started: 0, last_played_at: null };
    res.json({
      ok: true,
      id: user.id,
      account_name: user.account_name,
      email: user.email,
      email_verified_at: user.email_verified_at,
      stats: { games_started: stats.games_started, last_played_at: stats.last_played_at },
    });
  } catch (err) {
    console.error("[auth] me failed:", err);
    res.status(500).json({ error: "internal" });
  }
});

authRouter.patch("/me", async (req, res) => {
  const token = readBearerToken(req);
  const session = await loadSession(token);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = req.body as UpdateAccountNameBody;
  const account_name = typeof body?.account_name === "string" ? body.account_name.trim() : "";
  if (!account_name || account_name.length > 64) {
    res.status(400).json({ error: "invalid account name" });
    return;
  }
  try {
    const updateResult = await pool.query(
      `UPDATE users SET account_name = $1 WHERE email = $2`,
      [account_name, session.email],
    );
    if (updateResult.rowCount === 0) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    const userResult = await pool.query<{ id: number; account_name: string; email: string; email_verified_at: Date | null }>(
      `SELECT id, account_name, email, email_verified_at FROM users WHERE email = $1`,
      [session.email],
    );
    const user = userResult.rows[0];
    res.json({ ok: true, id: user.id, account_name: user.account_name, email: user.email, email_verified_at: user.email_verified_at });
  } catch (err) {
    console.error("[auth] patch-me failed:", err);
    res.status(409).json({ error: "duplicate account name" });
  }
});
