import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { authRouter } from "../../server/auth";

let server: Server;
let baseUrl: string;

const STAMP = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL_PREFIX = "test-auth-";

function testEmail(tag: string): string {
  return `${EMAIL_PREFIX}${tag}-${STAMP}@example.com`;
}

// Account names are globally unique across the whole users table, so they must
// embed the stamp too -- a static name would collide with leftovers from any
// earlier run of this suite. Only [A-Za-z0-9_ .-] allowed (CHECK constraint).
function uname(tag: string): string {
  return `TA ${tag} ${STAMP}`;
}

async function deleteByEmailPrefix(pattern: string): Promise<void> {
  await pool.query(
    `DELETE FROM user_sessions WHERE email LIKE $1 AND last_seen_at < now() - interval '1 hour'`,
    [pattern],
  );
  await pool.query(
    `DELETE FROM auth_codes WHERE email LIKE $1 AND created_at < now() - interval '1 hour'`,
    [pattern],
  );
  await pool.query(
    `DELETE FROM user_stats WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [pattern],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1 AND created_at < now() - interval '1 hour'`, [pattern]);
}

before(async () => {
  const migrationSql = readFileSync(
    new URL("../../server/migrations/029_users_and_stats.sql", import.meta.url),
    "utf8",
  );
  await pool.query(migrationSql);

  // Sweep fixtures from earlier runs of THIS suite (any stamp).
  await deleteByEmailPrefix(`${EMAIL_PREFIX}%@example.com`);

  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/auth`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function cleanup(tag: string): Promise<void> {
  await deleteByEmailPrefix(`${EMAIL_PREFIX}${tag}-%@example.com`);
}

interface JsonRes {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<JsonRes> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} };
}

async function requestCode(email: string): Promise<string> {
  const res = await call("POST", "/request-code", { email });
  assert.equal(res.status, 200);
  const devCode = res.body.devCode;
  assert.equal(typeof devCode, "string", "test DB runs non-production so devCode must be present");
  return devCode as string;
}

test("register creates an unverified user row and returns no token", async () => {
  const tag = "reg";
  try {
    const email = testEmail(tag);
    const name = uname(tag);
    const res = await call("POST", "/register", { account_name: name, email });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.account_name, name);
    assert.equal(res.body.email, email);
    assert.equal(res.body.email_verified_at, null);
    assert.equal("token" in res.body, false, "register must not mint a session token");

    const row = await pool.query<{ account_name: string }>(`SELECT account_name FROM users WHERE email = $1`, [
      email,
    ]);
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].account_name, name);
  } finally {
    await cleanup(tag);
  }
});

test("register rejects duplicate email case-insensitively with 409", async () => {
  const tag = "dup-email";
  try {
    const email = testEmail(tag);
    const first = await call("POST", "/register", { account_name: uname(`${tag}-a`), email });
    assert.equal(first.status, 200);
    const second = await call("POST", "/register", {
      account_name: uname(`${tag}-b`),
      email: email.toUpperCase(),
    });
    assert.equal(second.status, 409);
  } finally {
    await cleanup(tag);
  }
});

test("register rejects case-insensitive duplicate account name with 409", async () => {
  const tag = "dup-name";
  try {
    const name = uname(tag);
    const first = await call("POST", "/register", { account_name: name, email: testEmail(tag) });
    assert.equal(first.status, 200);
    const second = await call("POST", "/register", {
      account_name: `  ${name}  `.toLowerCase(),
      email: testEmail(`${tag}-other`),
    });
    assert.equal(second.status, 409);
  } finally {
    await cleanup(tag);
    await cleanup(`${tag}-other`);
  }
});

test("verify-code upserts the account with the supplied name and returns a token", async () => {
  const tag = "verify";
  try {
    const email = testEmail(tag);
    const code = await requestCode(email);
    const name = uname(tag);
    const res = await call("POST", "/verify-code", { email, code, account_name: name });
    assert.equal(res.status, 200);
    const token = res.body.token;
    assert.equal(typeof token, "string");

    const me = await call("GET", "/me", undefined, token as string);
    assert.equal(me.status, 200);
    assert.equal(me.body.account_name, name);
    assert.equal(me.body.email, email);
    assert.notEqual(me.body.email_verified_at, null, "verify-code must stamp email_verified_at");
    assert.equal(me.body.games_started, 0, "fresh account has no games");
  } finally {
    await cleanup(tag);
  }
});

test("a second login never overwrites the account name", async () => {
  const tag = "no-overwrite";
  try {
    const email = testEmail(tag);
    const original = uname(tag);
    const code1 = await requestCode(email);
    const first = await call("POST", "/verify-code", { email, code: code1, account_name: original });
    assert.equal(first.status, 200);

    const code2 = await requestCode(email);
    const second = await call("POST", "/verify-code", {
      email,
      code: code2,
      account_name: uname(`${tag}-impostor`),
    });
    assert.equal(second.status, 200);

    const me = await call("GET", "/me", undefined, second.body.token as string);
    assert.equal(me.body.account_name, original);
    assert.notEqual(me.body.email_verified_at, null);
  } finally {
    await cleanup(tag);
  }
});

test("PATCH /me renames the account and enforces uniqueness", async () => {
  const tag = "patch";
  try {
    const emailA = testEmail(tag);
    const code = await requestCode(emailA);
    const login = await call("POST", "/verify-code", {
      email: emailA,
      code,
      account_name: uname(tag),
    });
    const token = login.body.token as string;

    const renamedTo = uname(`${tag}-renamed`);
    const renamed = await call("PATCH", "/me", { account_name: renamedTo }, token);
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.account_name, renamedTo);
    assert.equal(typeof renamed.body.games_started, "number", "PATCH returns the full flat profile shape");
    assert.ok("last_played_at" in renamed.body, "PATCH response carries last_played_at");

    const me = await call("GET", "/me", undefined, token);
    assert.equal(me.body.account_name, renamedTo);

    // Another user exists under its own distinct name; user A must not be
    // able to rename INTO it (unique index on lower(trim(account_name))).
    const otherName = uname(`${tag}-other`);
    const other = await call("POST", "/register", {
      account_name: otherName,
      email: testEmail(`${tag}-other`),
    });
    assert.equal(other.status, 200);
    const collide = await call("PATCH", "/me", { account_name: otherName.toUpperCase() }, token);
    assert.equal(collide.status, 409);
  } finally {
    await cleanup(tag);
    await cleanup(`${tag}-other`);
  }
});

test("verify-code without account_name derives a default name from the email", async () => {
  const tag = "derive";
  try {
    const email = testEmail(tag);
    const code = await requestCode(email);
    // No account_name in the body -- this is exactly what the login modal sends.
    const res = await call("POST", "/verify-code", { email, code });
    assert.equal(res.status, 200);
    const token = res.body.token as string;

    const me = await call("GET", "/me", undefined, token);
    assert.equal(me.status, 200);
    const expected = email.split("@")[0];
    assert.equal(me.body.account_name, expected);
  } finally {
    await cleanup(tag);
  }
});

test("GET /me without a token is 401 and logout invalidates the session", async () => {
  const anon = await call("GET", "/me");
  assert.equal(anon.status, 401);

  const tag = "logout";
  try {
    const email = testEmail(tag);
    const code = await requestCode(email);
    const login = await call("POST", "/verify-code", {
      email,
      code,
      account_name: uname(tag),
    });
    const token = login.body.token as string;

    const out = await call("POST", "/logout", undefined, token);
    assert.equal(out.status, 200);
    const after = await call("GET", "/me", undefined, token);
    assert.equal(after.status, 401);
  } finally {
    await cleanup(tag);
  }
});

test("verify-code rejects a bad code with 401", async () => {
  const tag = "bad-code";
  try {
    const email = testEmail(tag);
    const code = await requestCode(email);
    const bad = code === "000000" ? "111111" : "000000";
    const res = await call("POST", "/verify-code", { email, code: bad, account_name: uname(tag) });
    assert.equal(res.status, 401);
  } finally {
    await cleanup(tag);
  }
});

test("register rejects an account name outside the allowed charset with 400", async () => {
  const tag = "bad-name";
  try {
    const res = await call("POST", "/register", { account_name: "bad/name", email: testEmail(tag) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid account name");
  } finally {
    await cleanup(tag);
  }
});
