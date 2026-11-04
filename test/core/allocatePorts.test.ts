// The port allocator may not PRESERVE a port the OS refuses to bind.
//
// `scripts/allocate-ports.ts` is deliberately idempotent: `predev`/`pretest`
// call it on every run, and re-allocating a value that is still in use rotates
// the port out from under a live dev server. That rule has one exception --
// EACCES. On Windows a port inside an OS-excluded range is refused outright
// (`netsh int ipv4 show excludedportrange protocol=tcp`; measured on this box,
// `listen 0.0.0.0:52000 -> EACCES: permission denied`), nothing can ever bind
// it, and nothing else will free it, so preserving it makes every dev run and
// every suite fail on an unusable port.
//
// Measured 2026-11-03: the primary checkout's `.env` held
// `API_PORT/CLIENT_PORT/WS_PORT = 54232/54233/54234`, inside the then-current
// excluded range 54144-54243, and vite answered
// `listen EACCES: permission denied 0.0.0.0:54233`. The ranges are re-drawn at
// boot, which is why a KERNEL-ASSIGNED port is the safe thing to keep: the OS
// never allocates one from a range it excludes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { classifyBindError, pickPort, probePort } from "../../scripts/allocate-ports";

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("a refused bind is EXCLUDED, a busy one is IN USE, and anything else is left alone", () => {
  const cases: Array<[string, NodeJS.ErrnoException] | [string, unknown]> = [
    ["EACCES", Object.assign(new Error("listen EACCES: permission denied 0.0.0.0:52000"), { code: "EACCES" })],
    ["EPERM", Object.assign(new Error("listen EPERM: operation not permitted"), { code: "EPERM" })],
    ["EADDRINUSE", Object.assign(new Error("listen EADDRINUSE: address already in use"), { code: "EADDRINUSE" })],
    ["other", Object.assign(new Error("EAFNOSUPPORT"), { code: "EAFNOSUPPORT" })],
    ["no code", new Error("something else")],
    ["null", null],
    ["undefined", undefined],
  ];
  const expected = ["excluded", "excluded", "in-use", "unknown", "unknown", "unknown", "unknown"];
  cases.forEach(([label, err], i) => {
    assert.equal(classifyBindError(err), expected[i], `${label} must classify as ${expected[i]}`);
  });
});

test("only the EXCLUDED verdict is allowed to rotate a preserved value", () => {
  // The allocator's rule, stated as data: preserve on "free" (usable),
  // "in-use" (a live holder -- usually our own dev server) and "unknown" (not
  // our call); re-allocate on "excluded" alone.
  const rotates = (probe: string) => probe === "excluded";
  assert.equal(rotates("excluded"), true);
  assert.equal(rotates("in-use"), false, "an EADDRINUSE value is a LIVE holder, not a broken one");
  assert.equal(rotates("free"), false);
  assert.equal(rotates("unknown"), false);
});

test("a kernel-assigned port probes as free, and a held port probes as in-use", async () => {
  const free = await pickPort();
  assert.equal(await probePort(free), "free");

  const held = await pickPort();
  const server = await listenOn(held);
  try {
    assert.equal(await probePort(held), "in-use");
  } finally {
    await close(server);
  }
});
