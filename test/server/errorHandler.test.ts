import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, NextFunction } from "express";
import { errorHandler } from "../../server/errorHandler";

// Minimal Response double: just enough of the surface errorHandler actually
// calls (status/json, plus a readable headersSent flag) -- no need to spin
// up a real Express app/server to exercise this middleware directly.
function makeRes(headersSent = false) {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const res = {
    headersSent,
    status(code: number) {
      calls.status = code;
      return res;
    },
    json(body: unknown) {
      calls.body = body;
      return res;
    },
  };
  return { res: res as unknown as Parameters<typeof errorHandler>[2], calls };
}

function makeReq(method: string, originalUrl: string): Request {
  return { method, originalUrl } as unknown as Request;
}

test("errorHandler normalizes a thrown Error to the { error, message } JSON shape", () => {
  const { res, calls } = makeRes();
  const req = makeReq("POST", "/api/games/test-game/events");
  let nextArg: unknown = "not-called";
  const next: NextFunction = ((err?: unknown) => { nextArg = err; }) as NextFunction;

  errorHandler(new Error("relation \"game_events\" does not exist"), req, res, next);

  assert.equal(calls.status, 500);
  assert.deepEqual(calls.body, {
    error: "internal",
    message: "relation \"game_events\" does not exist",
  });
  assert.equal(nextArg, "not-called", "next() should not be called when a response was sent");
});

test("errorHandler stringifies a non-Error thrown value instead of leaking [object Object]", () => {
  const { res, calls } = makeRes();
  const req = makeReq("GET", "/api/games/test-game/tiles");
  const next: NextFunction = (() => {}) as NextFunction;

  errorHandler("plain string rejection", req, res, next);

  assert.equal(calls.status, 500);
  assert.deepEqual(calls.body, { error: "internal", message: "plain string rejection" });
});

test("errorHandler defers to next(err) instead of double-sending once headers are already sent", () => {
  const { res, calls } = makeRes(true);
  const req = makeReq("GET", "/api/health");
  let nextArg: unknown;
  const next: NextFunction = ((err?: unknown) => { nextArg = err; }) as NextFunction;
  const err = new Error("failed mid-stream");

  errorHandler(err, req, res, next);

  assert.equal(calls.status, null, "must not attempt to set a status once headers are sent");
  assert.equal(nextArg, err);
});
