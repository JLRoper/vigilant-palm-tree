import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_ENTITY_ID_PREFIX,
  LINK_DEGRADED_LOSS_PCT,
  LINK_DEGRADED_RTT_MS,
  LINK_FAILING_LOSS_PCT,
  LINK_FAILING_RTT_MS,
  SERVER_ENTITY_ID,
  clientEntityId,
  deriveLinkStatus,
  playerIdFromEntityId,
} from "@heroes/contracts";

test("a fast, lossless link is healthy", () => {
  assert.equal(deriveLinkStatus(0, 0), "healthy");
  assert.equal(deriveLinkStatus(40, 0), "healthy");
});

test("null rtt means no recent successful sample, which is failing", () => {
  assert.equal(deriveLinkStatus(null, 0), "failing");
  // Failing on rtt wins even when loss looks clean.
  assert.equal(deriveLinkStatus(null, 0), "failing");
});

test("rtt thresholds are exclusive at the boundary", () => {
  assert.equal(deriveLinkStatus(LINK_DEGRADED_RTT_MS, 0), "healthy");
  assert.equal(deriveLinkStatus(LINK_DEGRADED_RTT_MS + 1, 0), "degraded");
  assert.equal(deriveLinkStatus(LINK_FAILING_RTT_MS, 0), "degraded");
  assert.equal(deriveLinkStatus(LINK_FAILING_RTT_MS + 1, 0), "failing");
});

test("loss thresholds are exclusive at the boundary", () => {
  assert.equal(deriveLinkStatus(10, LINK_DEGRADED_LOSS_PCT), "healthy");
  assert.equal(deriveLinkStatus(10, LINK_DEGRADED_LOSS_PCT + 1), "degraded");
  assert.equal(deriveLinkStatus(10, LINK_FAILING_LOSS_PCT), "degraded");
  assert.equal(deriveLinkStatus(10, LINK_FAILING_LOSS_PCT + 1), "failing");
});

test("either dimension alone can degrade or fail a link", () => {
  assert.equal(deriveLinkStatus(500, 0), "degraded");
  assert.equal(deriveLinkStatus(40, 10), "degraded");
  assert.equal(deriveLinkStatus(2000, 0), "failing");
  assert.equal(deriveLinkStatus(40, 50), "failing");
});

// Node-id format. These exist because the client, the server registry, and the
// snapshot builder each key off this format; if they ever disagree the graph
// goes silently empty rather than throwing, so the round trip is pinned here.
test("clientEntityId and playerIdFromEntityId round-trip a seat", () => {
  for (const seat of [0, 1, 7, 42]) {
    assert.equal(playerIdFromEntityId(clientEntityId(seat)), seat);
  }
  assert.equal(clientEntityId(0), `${CLIENT_ENTITY_ID_PREFIX}0`);
});

test("the server node id is not mistaken for a player", () => {
  assert.equal(playerIdFromEntityId(SERVER_ENTITY_ID), null);
});

test("malformed node ids yield null rather than NaN", () => {
  assert.equal(playerIdFromEntityId("client:abc"), null);
  assert.equal(playerIdFromEntityId("client:"), null);
  assert.equal(playerIdFromEntityId("client:1.5"), null);
  assert.equal(playerIdFromEntityId("0"), null);
});

test("the worse of the two dimensions wins", () => {
  // Healthy rtt, failing loss.
  assert.equal(deriveLinkStatus(10, 100), "failing");
  // Failing rtt, healthy loss.
  assert.equal(deriveLinkStatus(5000, 0), "failing");
  // Degraded rtt paired with failing loss is still failing.
  assert.equal(deriveLinkStatus(400, 90), "failing");
});
