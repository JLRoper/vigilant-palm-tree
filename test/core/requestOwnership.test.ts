import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUEST_TOKEN_ENV,
  getApiPort,
  getClientPort,
  loadRequest,
  requestIsOurs,
  type TestRequest,
} from "../_request";

// Pins for the request file's OWNERSHIP rule (2026-11-03), the reader half of
// the "a suite that goes red for an environmental reason" card.
//
// tools/run-test.mjs leaves nothing behind now (see
// test/core/runTestHarness.test.ts), but the file is read by suites that were
// NOT spawned by it: `npm run test:cityview` / test:settlements /
// test:resourcePickup are direct runs, and they used to inherit whatever
// request file was fresh within a 30s window -- measured 2026-11-03, a direct
// run started 13.7s after a wrapper entry exited reported
// `loadRequest -> HONOURED` and resolved api=57305/client=57306 while the
// environment said 56776/56777, so `npm run test:settlements` brought its API
// up on the dead run's port while vite proxied .env's and every page fetch died
// with ECONNREFUSED. A file is now honoured only when it carries the token the
// writing wrapper handed THIS process through HEROES_TEST_REQUEST_TOKEN.
//
// Both halves are checked here because either one alone re-opens the hole: the
// token match (a leftover that is not ours is ignored however fresh), and the
// grace window (a file with a valid token that predates this run is ignored).

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REQUEST_PATH = join(ROOT, "local", ".test-request.json");

function requestFor(apiPort: number, clientPort: number, token?: string): TestRequest {
  return {
    runId: new Date().toISOString(),
    entry: "settlements",
    apiPort,
    clientPort,
    autoClose: true,
    shutdownAfterMs: null,
    extra: { updateBaselines: false },
    ...(token === undefined ? {} : { token }),
  };
}

/** Writes a request file for the duration of `fn`, then restores what was there. */
async function withRequestFile(payload: TestRequest | null, fn: () => Promise<void> | void): Promise<void> {
  const previous = existsSync(REQUEST_PATH) ? readFileSync(REQUEST_PATH, "utf8") : null;
  mkdirSync(join(ROOT, "local"), { recursive: true });
  try {
    if (payload === null) {
      if (existsSync(REQUEST_PATH)) unlinkSync(REQUEST_PATH);
    } else {
      writeFileSync(REQUEST_PATH, JSON.stringify(payload, null, 2));
    }
    await fn();
  } finally {
    if (previous === null) {
      if (existsSync(REQUEST_PATH)) unlinkSync(REQUEST_PATH);
    } else {
      writeFileSync(REQUEST_PATH, previous);
    }
  }
}

/** Runs `fn` with HEROES_TEST_REQUEST_TOKEN set (or removed when null). */
async function withToken(token: string | null, fn: () => Promise<void> | void): Promise<void> {
  const previous = process.env[REQUEST_TOKEN_ENV];
  try {
    if (token === null) delete process.env[REQUEST_TOKEN_ENV];
    else process.env[REQUEST_TOKEN_ENV] = token;
    await fn();
  } finally {
    if (previous === undefined) delete process.env[REQUEST_TOKEN_ENV];
    else process.env[REQUEST_TOKEN_ENV] = previous;
  }
}

test("a fresh request file written for ANOTHER run is ignored, not honoured", async () => {
  await withRequestFile(requestFor(57305, 57306, "some-previous-run"), async () => {
    await withToken(null, () => {
      assert.equal(loadRequest(), null, "a direct run has no token, so no file is its own");
    });
    await withToken("this-run", () => {
      assert.equal(loadRequest(), null, "a token that is not the file's token is not ownership");
    });
  });
});

test("the ports come from the request only when the file is this run's", async () => {
  const previousApi = process.env.API_PORT;
  const previousClient = process.env.CLIENT_PORT;
  try {
    process.env.API_PORT = "56776";
    process.env.CLIENT_PORT = "56777";
    await withRequestFile(requestFor(57305, 57306, "other-run"), async () => {
      await withToken(null, () => {
        assert.equal(getApiPort(4000), 56776, "a foreign file must not outrank this run's own port");
        assert.equal(getClientPort(5173), 56777, "…for the client port either");
      });
      await withToken("other-run", () => {
        assert.equal(getApiPort(4000), 57305, "the run the file was written for takes its ports from it");
        assert.equal(getClientPort(5173), 57306, "…including the client port");
      });
    });
  } finally {
    if (previousApi === undefined) delete process.env.API_PORT;
    else process.env.API_PORT = previousApi;
    if (previousClient === undefined) delete process.env.CLIENT_PORT;
    else process.env.CLIENT_PORT = previousClient;
  }
});

test("our own request file is ignored once it is older than the grace window", async () => {
  await withRequestFile(requestFor(57305, 57306, "this-run"), async () => {
    await withToken("this-run", () => {
      assert.notEqual(loadRequest(), null, "fresh and ours: honoured");
      const stale = new Date(Date.now() - 60_000);
      utimesSync(REQUEST_PATH, stale, stale);
      assert.equal(loadRequest(), null, "…but not once it predates this run by more than the window");
    });
  });
});

test("a file with no token at all is never ours", async () => {
  await withRequestFile(requestFor(57305, 57306), async () => {
    await withToken("this-run", () => {
      assert.equal(loadRequest(), null, "a legacy file (no token) is not honoured by a token-holding run");
    });
  });
  assert.equal(requestIsOurs(null), false);
  assert.equal(requestIsOurs(requestFor(1, 2, "t"), {}), false, "no token in the environment: nothing is ours");
  assert.equal(requestIsOurs(requestFor(1, 2, "t"), { [REQUEST_TOKEN_ENV]: "t" }), true);
});
