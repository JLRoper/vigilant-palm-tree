import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVER_ENTITY_ID, clientEntityId } from "@heroes/contracts";
import {
  FAILURE_WINDOW,
  STALE_AFTER_MS,
  getSnapshot,
  recordSample,
  resetRegistry,
} from "../../server/telemetry/presenceRegistry";

// The registry is a module-level singleton (one per API process by design),
// so each test resets it rather than constructing a fresh instance.
function sample(
  playerId: number,
  receivedAt: number,
  overrides: { ok?: boolean; rttMs?: number; responseBytes?: number; label?: string } = {},
) {
  return {
    playerId,
    label: overrides.label ?? `Player ${playerId}`,
    rttMs: overrides.rttMs ?? 40,
    responseBytes: overrides.responseBytes ?? 2000,
    ok: overrides.ok ?? true,
    receivedAt,
  };
}

test("snapshot always carries exactly one dedicated-server node, even with no clients", () => {
  resetRegistry();
  const snap = getSnapshot("empty-game", { now: 1000 });
  assert.equal(snap.gameName, "empty-game");
  assert.equal(snap.capturedAt, 1000);
  assert.deepEqual(
    snap.entities.map((e) => e.type),
    ["dedicated-server"],
  );
  assert.equal(snap.entities[0].id, SERVER_ENTITY_ID);
  assert.deepEqual(snap.links, []);
});

test("a recorded sample produces a client node and one link to the server", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000, { label: "Host", rttMs: 42, responseBytes: 4000 }));
  const snap = getSnapshot("g1", { now: 1000, pollIntervalMs: 2000 });

  assert.equal(snap.entities.length, 2);
  const client = snap.entities.find((e) => e.id === clientEntityId(0));
  assert.ok(client, "client entity should exist");
  assert.equal(client.type, "client");
  assert.equal(client.label, "Host");
  assert.equal(client.lastSeenAt, 1000);

  assert.equal(snap.links.length, 1);
  const link = snap.links[0];
  assert.equal(link.fromId, clientEntityId(0));
  assert.equal(link.toId, SERVER_ENTITY_ID);
  assert.equal(link.rttMs, 42);
  assert.equal(link.packetLossPct, 0);
  // 4000 bytes over a 2000ms interval == 2000 B/s.
  assert.equal(link.bandwidthBytesPerSec, 2000);
  assert.equal(link.status, "healthy");
});

test("each player gets its own node and link", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000));
  recordSample("g1", sample(1, 1000));
  const snap = getSnapshot("g1", { now: 1000 });
  assert.equal(snap.entities.filter((e) => e.type === "client").length, 2);
  assert.equal(snap.links.length, 2);
  assert.deepEqual(
    snap.links.map((l) => l.toId),
    [SERVER_ENTITY_ID, SERVER_ENTITY_ID],
  );
});

test("games are isolated from each other", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000));
  recordSample("g2", sample(7, 1000));
  assert.deepEqual(
    getSnapshot("g1", { now: 1000 })
      .entities.filter((e) => e.type === "client")
      .map((e) => e.id),
    [clientEntityId(0)],
  );
  assert.deepEqual(
    getSnapshot("g2", { now: 1000 })
      .entities.filter((e) => e.type === "client")
      .map((e) => e.id),
    [clientEntityId(7)],
  );
});

test("rolling failure rate reflects the mix of ok/failed samples in the window", () => {
  resetRegistry();
  // 4 samples, 1 failed -> 25%.
  recordSample("g1", sample(0, 1000, { ok: true }));
  recordSample("g1", sample(0, 1001, { ok: false }));
  recordSample("g1", sample(0, 1002, { ok: true }));
  recordSample("g1", sample(0, 1003, { ok: true }));
  const link = getSnapshot("g1", { now: 1003 }).links[0];
  assert.equal(link.packetLossPct, 25);
  // 25% loss is over the failing threshold (20%).
  assert.equal(link.status, "failing");
});

test("the ring buffer evicts oldest samples beyond FAILURE_WINDOW", () => {
  resetRegistry();
  // FAILURE_WINDOW failures first, then FAILURE_WINDOW successes: the
  // failures must be fully evicted, leaving a 0% rate.
  for (let i = 0; i < FAILURE_WINDOW; i++) {
    recordSample("g1", sample(0, 1000 + i, { ok: false }));
  }
  assert.equal(getSnapshot("g1", { now: 1000 + FAILURE_WINDOW }).links[0].packetLossPct, 100);

  for (let i = 0; i < FAILURE_WINDOW; i++) {
    recordSample("g1", sample(0, 2000 + i, { ok: true }));
  }
  assert.equal(getSnapshot("g1", { now: 2000 + FAILURE_WINDOW }).links[0].packetLossPct, 0);
});

test("rtt and bandwidth come from the newest successful sample, not the newest sample", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000, { ok: true, rttMs: 55, responseBytes: 1000 }));
  recordSample("g1", sample(0, 1001, { ok: false, rttMs: 9999, responseBytes: 0 }));
  const link = getSnapshot("g1", { now: 1001, pollIntervalMs: 2000 }).links[0];
  assert.equal(link.rttMs, 55);
  assert.equal(link.bandwidthBytesPerSec, 500);
});

test("a client with only failed samples reports null rtt/bandwidth and a failing link", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000, { ok: false, rttMs: 3000 }));
  const link = getSnapshot("g1", { now: 1000 }).links[0];
  assert.equal(link.rttMs, null);
  assert.equal(link.bandwidthBytesPerSec, null);
  assert.equal(link.packetLossPct, 100);
  assert.equal(link.status, "failing");
});

test("a client goes stale and drops out of the topology after STALE_AFTER_MS", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000));
  // Exactly at the boundary the client is still present...
  assert.equal(getSnapshot("g1", { now: 1000 + STALE_AFTER_MS }).links.length, 1);
  // ...and one ms past it, gone -- while the server node remains.
  const expired = getSnapshot("g1", { now: 1000 + STALE_AFTER_MS + 1 });
  assert.equal(expired.links.length, 0);
  assert.deepEqual(
    expired.entities.map((e) => e.type),
    ["dedicated-server"],
  );
});

test("a stale client returns to the topology when it polls again", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000));
  assert.equal(getSnapshot("g1", { now: 1000 + STALE_AFTER_MS + 1 }).links.length, 0);
  recordSample("g1", sample(0, 50_000));
  assert.equal(getSnapshot("g1", { now: 50_000 }).links.length, 1);
});

test("the newest label wins when a player renames between polls", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000, { label: "Old" }));
  recordSample("g1", sample(0, 1001, { label: "New" }));
  const client = getSnapshot("g1", { now: 1001 }).entities.find((e) => e.id === clientEntityId(0));
  assert.equal(client?.label, "New");
});

test("receivedAt drives staleness, so slow links stay visible while they keep reporting", () => {
  resetRegistry();
  recordSample("g1", sample(0, 1000, { rttMs: 900 }));
  const link = getSnapshot("g1", { now: 1000 }).links[0];
  assert.equal(link.status, "degraded");
  assert.equal(link.rttMs, 900);
});
