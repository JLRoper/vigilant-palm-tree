// The shared test-port helper REFUSES to guess this box's deployed stack.
//
// Playthrough finding 22: `getClientPort(5173)`'s fallback is not "the dev
// server" -- it is `game_web`, the DEPLOYED Docker web (published
// 0.0.0.0:5173->80), which answers /src/*.ts with text/html (the SPA
// fallback). A browser suite that fell back to it while its own
// `vite --strictPort` lost the bind race drove a built bundle from an earlier
// deploy and reported the injected module error as a product failure. The
// precedence is unchanged (fresh request file, then the environment, then the
// default); what changed is that the default can no longer BE the deployed
// stack -- it refuses, the way test/_envGuard.ts already refuses for the
// by-hand entries.
//
// Pure by construction (no filesystem, no process.env): the sources are passed
// in, so every branch is pinned without touching this box's real environment.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPLOYED_TEST_PORTS, resolveTestPort } from "../_request";

const NO_SOURCES = { request: null, env: {} };

test("the deployed stack's ports are named in one place, and they are this box's Docker publishes", () => {
  assert.equal(DEPLOYED_TEST_PORTS.CLIENT_PORT, 5173, "game_web: 0.0.0.0:5173->80");
  assert.equal(DEPLOYED_TEST_PORTS.API_PORT, 3001, "game_api: 0.0.0.0:3001->3001");
});

test("a fresh request file wins over the environment (the wrapper's ports are the run's ports)", () => {
  const resolved = resolveTestPort("CLIENT_PORT", 5173, {
    request: { apiPort: 12345, clientPort: 12346 },
    env: { CLIENT_PORT: "55555" },
  });
  assert.deepEqual(resolved, { port: 12346, source: "request" });
  assert.deepEqual(
    resolveTestPort("API_PORT", 3001, { request: { apiPort: 12345, clientPort: 12346 }, env: {} }),
    { port: 12345, source: "request" },
    "the same request file answers for the api port",
  );
});

test("an explicit environment port wins over the fallback", () => {
  assert.deepEqual(
    resolveTestPort("CLIENT_PORT", 5173, { request: null, env: { CLIENT_PORT: "5199" } }),
    { port: 5199, source: "env" },
  );
});

test("a fallback that is NOT the deployed stack is still honoured (0 means the kernel picks)", () => {
  assert.deepEqual(resolveTestPort("CLIENT_PORT", 0, NO_SOURCES), { port: 0, source: "fallback" });
  assert.deepEqual(resolveTestPort("API_PORT", 4000, NO_SOURCES), { port: 4000, source: "fallback" });
});

test("the deployed-stack fallback refuses instead of silently measuring an older bundle", () => {
  const cases = [
    { variable: "CLIENT_PORT" as const, port: 5173, what: "web", per: "text/html" },
    { variable: "API_PORT" as const, port: 3001, what: "api", per: "Docker" },
  ];
  for (const { variable, port, per } of cases) {
    assert.throws(
      () => resolveTestPort(variable, port, NO_SOURCES),
      (err: Error) => {
        assert.match(err.message, new RegExp(`${variable} is unset and this run would fall back to ${port}`));
        assert.match(err.message, new RegExp(per), "the refusal names what the fallback actually is");
        assert.match(err.message, new RegExp(`Pass ${variable} explicitly`), "and how to run it on purpose");
        return true;
      },
      `${variable}'s deployed fallback (${port}) must refuse`,
    );
  }
});

test("asking for a deployed port OUT LOUD stays allowed -- the guess is what was refused", () => {
  assert.deepEqual(
    resolveTestPort("CLIENT_PORT", 5173, { request: null, env: { CLIENT_PORT: "5173" } }),
    { port: 5173, source: "env" },
  );
});

test("a malformed environment port refuses rather than falling back to anything", () => {
  assert.throws(() => resolveTestPort("API_PORT", 4000, { request: null, env: { API_PORT: "yes" } }), /is not a TCP port/);
  assert.throws(() => resolveTestPort("CLIENT_PORT", 0, { request: null, env: { CLIENT_PORT: "70000" } }), /is not a TCP port/);
});
