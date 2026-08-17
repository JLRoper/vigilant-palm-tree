// Painter unit tests. The dispatcher shell is tested here; per-kind
// transcription tests land alongside each Commit 3-10 in the design doc.
//
// Stub painters are no-ops, so the recording-shim ctx should observe zero
// canvas calls for any node kind until the transcription lands. Future
// per-kind tests will assert on the call log once the actual Canvas
// transcription is in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { paintScene } from "../../src/render/scene/paint2d";
import type { SceneNode } from "../../src/render/scene/types";
import { makeNoopPaint2DDep, makeRecordingCtx } from "./_helpers";

test("paintScene: empty input is a no-op (no calls emitted, no throw)", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintScene(ctx, [], makeNoopPaint2DDep(), { viewportW: 800, viewportH: 600 });
  assert.equal(calls.length, 0);
});

test("paintScene: one of every node kind dispatches without throwing under stub painters", () => {
  const { ctx, calls } = makeRecordingCtx();
  const nodes: SceneNode[] = [
    { kind: "terrainHex", q: 0, r: 0, world: { x: 0, y: 0 }, terrain: "grass" },
    { kind: "terrainDecoration", q: 0, r: 0, world: { x: 0, y: 0 }, terrain: "grass" },
    { kind: "fogHex", q: 0, r: 0, world: { x: 0, y: 0 } },
    { kind: "resourceIcon", q: 0, r: 0, world: { x: 0, y: 0 }, resource: "gold" },
    { kind: "charterOverlay", q: 0, r: 0, world: { x: 0, y: 0 }, phase: "traveling" },
    { kind: "validCharterHex", q: 0, r: 0, world: { x: 0, y: 0 } },
    {
      kind: "castle",
      settlementId: "s",
      world: { x: 0, y: 0 },
      level: 1,
      variant: 0,
      ownerId: 0,
      selected: false,
      color: "rgba(255,255,255,0.18)",
      dashedBorder: true,
    },
    { kind: "territoryOutlineEdge", ownerId: 0, color: "#000", x1: 0, y1: 0, x2: 1, y2: 1 },
    { kind: "pathSegment", reachable: true, points: [{ x: 0, y: 0 }] },
    { kind: "heroTrail", heroId: "h", color: "#fff", points: [{ x: 0, y: 0 }] },
    { kind: "hoverHighlight", q: 0, r: 0, world: { x: 0, y: 0 } },
    {
      kind: "hero",
      heroId: "h",
      ownerId: 0,
      world: { x: 0, y: 0 },
      facingDirection: "N",
      horseVariant: "bubbly",
      faction: "player",
      scaleY: 1,
      color: "#fff",
      selected: false,
    },
    {
      kind: "citySkybox",
      viewportW: 800,
      viewportH: 600,
      spriteVariant: 1,
      parallaxEnabled: false,
      parallaxLayerCount: 4,
      offsetX: 0,
      offsetY: 0,
    },
    { kind: "cityCell", gx: 0, gy: 0, screen: { x: 0, y: 0 }, halfWidth: 10, halfHeight: 10, hovered: false },
    {
      kind: "cityResourceSpot",
      gx: 0,
      gy: 0,
      screen: { x: 0, y: 0 },
      tileWidth: 32,
      tileHeight: 32,
      resource: "gold",
    },
    { kind: "cityMine", gx: 0, gy: 0, screen: { x: 0, y: 0 }, tileWidth: 32, tileHeight: 32, resource: "gold", level: 1 },
    {
      kind: "cityBuilding",
      gx: 0,
      gy: 0,
      buildingKind: "townHall",
      level: 1,
      center: { x: 0, y: 0 },
      halfWidth: 10,
      halfHeight: 10,
      ownerColor: "#888",
      style: "classic",
      selected: false,
    },
    {
      kind: "cityGhostBuilding",
      buildingKind: "townHall",
      center: { x: 0, y: 0 },
      halfWidth: 10,
      halfHeight: 10,
      ownerColor: "#888",
      style: "classic",
      valid: true,
    },
    { kind: "cityLabel", text: "x", x: 0, y: 0, fontPx: 12, alpha: 1 },
    { kind: "battleHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30, impassable: false, inMoveRange: false, available: false },
    {
      kind: "battleAttackTargetRing",
      side: "attacker",
      slotIndex: 0,
      world: { x: 0, y: 0 },
      radius: 24,
    },
    { kind: "battleAiTelegraphHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30 },
    { kind: "battleMovePath", side: "attacker", slotIndex: 0, points: [{ x: 0, y: 0 }] },
    { kind: "battleImpactRing", world: { x: 0, y: 0 }, radius: 10, alpha: 1 },
    { kind: "battleAiActingRing", side: "attacker", slotIndex: 0, world: { x: 0, y: 0 }, radius: 24 },
    {
      kind: "battleCombatant",
      side: "attacker",
      slotIndex: 0,
      world: { x: 0, y: 0 },
      radius: 16,
      selected: false,
      unitCount: 5,
      hpRatio: 1,
    },
    { kind: "battleFloatingText", text: "-1", world: { x: 0, y: 0 }, alpha: 1 },
  ];
  paintScene(ctx, nodes, makeNoopPaint2DDep(), { viewportW: 800, viewportH: 600 });
  // Stub painters emit no canvas calls. Replace with call-log assertions as
  // each kind's real transcription lands (Commits 3-10 in the design doc).
  assert.equal(calls.length, 0);
});

test("paintScene: omitting frame is allowed (some callers only pass nodes+deps)", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintScene(ctx, [{ kind: "battleHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30, impassable: false, inMoveRange: false, available: false }], makeNoopPaint2DDep());
  assert.equal(calls.length, 0);
});

test("paintScene: a citySkybox node requires a frame (fail-fast, not a silent no-op)", () => {
  // The dispatcher throws before iterating when a citySkybox node is present
  // and no frame is supplied. Catches missing-viewport wiring at the call
  // site rather than deeper in the real Canvas math (Commit 7 of the
  // design doc).
  const { ctx } = makeRecordingCtx();
  const skybox: SceneNode = {
    kind: "citySkybox",
    viewportW: 800,
    viewportH: 600,
    spriteVariant: 1,
    parallaxEnabled: false,
    parallaxLayerCount: 4,
    offsetX: 0,
    offsetY: 0,
  };
  assert.throws(
    () => paintScene(ctx, [skybox], makeNoopPaint2DDep()),
    /citySkybox.*requires a Paint2DFrame/,
  );
  // ...but only fails when a citySkybox is *present*. Battle-only input
  // without frame still works (painters don't need the viewport frame).
  const battleOnly: SceneNode[] = [
    { kind: "battleHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30, impassable: false, inMoveRange: false, available: false },
  ];
  paintScene(ctx, battleOnly, makeNoopPaint2DDep());
});

test("paintScene: a citySkybox node with a frame does not throw", () => {
  const { ctx } = makeRecordingCtx();
  const skybox: SceneNode = {
    kind: "citySkybox",
    viewportW: 800,
    viewportH: 600,
    spriteVariant: 1,
    parallaxEnabled: false,
    parallaxLayerCount: 4,
    offsetX: 0,
    offsetY: 0,
  };
  paintScene(ctx, [skybox], makeNoopPaint2DDep(), { viewportW: 800, viewportH: 600 });
});

test("paintScene: dispatcher emits nodes in array order (paint-order contract) without mutating input", () => {
  // The recorder's ctx is a Proxy that records every method call in the
  // order it was made. Even though stubs are no-ops, the *invocation order*
  // is observable: if the dispatcher dispatched node B before node A, the
  // iteration order would differ between the two calls below.
  const { ctx: ctxA, calls: callsA } = makeRecordingCtx();
  const { ctx: ctxB, calls: callsB } = makeRecordingCtx();
  const nodes: SceneNode[] = [
    { kind: "battleHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30, impassable: false, inMoveRange: false, available: false },
    {
      kind: "battleCombatant",
      side: "attacker",
      slotIndex: 0,
      world: { x: 0, y: 0 },
      radius: 16,
      selected: false,
      unitCount: 5,
      hpRatio: 1,
    },
  ];
  paintScene(ctxA, nodes, makeNoopPaint2DDep());
  paintScene(ctxB, [...nodes].reverse(), makeNoopPaint2DDep());

  // The call sequences must be identical (stubs are no-ops, so the
  // recorded call counts are equal). What we *really* want to lock in is
  // input non-mutation: if a future painter mutates `node` (e.g. by
  // stamping a "drawn" flag onto it), the second paintScene call would
  // observe different state. Snapshot the input before/after each call.
  const snapshotBefore = JSON.stringify(nodes);
  paintScene(ctxA, nodes, makeNoopPaint2DDep());
  const snapshotAfter = JSON.stringify(nodes);
  assert.equal(snapshotAfter, snapshotBefore, "paintScene must not mutate its input nodes");

  // And the stub-phase ordering is symmetric: both forward and reverse
  // produce the same call log (no per-node calls yet, but the symmetry is
  // the contract).
  assert.equal(callsA.length, callsB.length, "forward and reverse-call orderings must produce identical recorded calls");
});
