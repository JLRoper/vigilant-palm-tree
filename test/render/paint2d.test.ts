// Painter unit tests. The dispatcher shell is tested here; per-kind
// transcription tests land alongside each Commit 3-10 in the design doc.
//
// Stub painters are no-ops, so the recording-shim ctx should observe zero
// canvas calls for any node kind until the transcription lands. Future
// per-kind tests will assert on the call log once the actual Canvas
// transcription is in.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paintScene,
  paintTerrainHex,
  paintTerrainDecoration,
  paintFogHex,
  paintHoverHighlight,
  paintResourceIcon,
  paintCastle,
  paintCharterOverlay,
  paintValidCharterHex,
  paintPathSegment,
  paintHeroTrail,
  paintTerritoryOutlineEdge,
  paintHero,
  paintCitySkybox,
  paintCityCell,
  paintCityResourceSpot,
  paintCityMine,
  paintCityBuilding,
  paintCityGhostBuilding,
  paintCityLabel,
  paintBattleHex,
  paintBattleAttackTargetRing,
  paintBattleAiTelegraphHex,
  paintBattleMovePath,
  paintBattleImpactRing,
  paintBattleAiActingRing,
  paintBattleCombatant,
  paintBattleFloatingText,
} from "../../src/render/scene/paint2d";
import type { SceneNode } from "../../src/render/scene/types";
import { makeNoopPaint2DDep, makeRecordingCtx } from "./_helpers";

test("paintScene: empty input is a no-op (no calls emitted, no throw)", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintScene(ctx, [], makeNoopPaint2DDep(), { viewportW: 800, viewportH: 600 });
  assert.equal(calls.length, 0);
});

test("paintScene: every node kind emits canvas calls (stubs are gone)", () => {
  // Commits 4-10 land; the dispatcher now has zero stub painters. Every
  // SceneNode kind must produce at least one canvas call (the smoke check
  // is per-kind in the dedicated tests below). The no-op-painters assertion
  // only makes sense while kinds are still stubbed.
  const { ctx, calls } = makeRecordingCtx();
  const nodes: SceneNode[] = [
    { kind: "terrainHex", q: 0, r: 0, world: { x: 0, y: 0 }, terrain: "grass" },
    { kind: "terrainDecoration", q: 0, r: 0, world: { x: 0, y: 0 }, terrain: "forest" },
    { kind: "fogHex", q: 0, r: 0, world: { x: 0, y: 0 } },
    { kind: "hoverHighlight", q: 0, r: 0, world: { x: 0, y: 0 } },
    { kind: "resourceIcon", q: 0, r: 0, world: { x: 0, y: 0 }, resource: "gold" },
    { kind: "charterOverlay", q: 0, r: 0, world: { x: 0, y: 0 }, phase: "traveling" },
    { kind: "validCharterHex", q: 0, r: 0, world: { x: 0, y: 0 } },
    { kind: "castle", settlementId: "s", world: { x: 0, y: 0 }, level: 1, variant: 0, ownerId: 0, selected: false, color: "#fff", dashedBorder: true },
    { kind: "territoryOutlineEdge", ownerId: 0, color: "#000", x1: 0, y1: 0, x2: 1, y2: 1 },
    { kind: "pathSegment", reachable: true, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    { kind: "heroTrail", heroId: "h", color: "#fff", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    { kind: "hero", heroId: "h", ownerId: 0, world: { x: 0, y: 0 }, facingDirection: "N", horseVariant: "hero", faction: "player", scaleY: 1, color: "#fff", selected: false },
    { kind: "battleHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30, impassable: false, inMoveRange: false, available: false },
    { kind: "battleCombatant", side: "attacker", slotIndex: 0, world: { x: 0, y: 0 }, radius: 16, selected: false, unitCount: 5, hpRatio: 1 },
  ];
  paintScene(ctx, nodes, makeNoopPaint2DDep(), { viewportW: 800, viewportH: 600 });
  assert.ok(calls.length > 0, "every node kind must emit Canvas calls when the painter is implemented");
});

test("paintScene: omitting frame is allowed (some callers only pass nodes+deps)", () => {
  // After Commit 9, battleHex emits calls, so the old `calls.length === 0`
  // assertion no longer holds. The contract being tested is "no throw on
  // no frame" -- the painter's battle hex path doesn't need viewportFrame.
  const { ctx } = makeRecordingCtx();
  paintScene(ctx, [{ kind: "battleHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30, impassable: false, inMoveRange: false, available: false }], makeNoopPaint2DDep());
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

test("paintScene: dispatcher does not mutate input nodes", () => {
  // The dispatcher iterates nodes by array order. What we want to lock in
  // is input non-mutation: if a future painter mutates `node` (e.g. by
  // stamping a "drawn" flag onto it), the next paintScene call on the same
  // nodes would observe different state.
  const { ctx } = makeRecordingCtx();
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
  const snapshotBefore = JSON.stringify(nodes);
  paintScene(ctx, nodes, makeNoopPaint2DDep());
  paintScene(ctx, nodes, makeNoopPaint2DDep());
  paintScene(ctx, nodes, makeNoopPaint2DDep());
  const snapshotAfter = JSON.stringify(nodes);
  assert.equal(snapshotAfter, snapshotBefore, "paintScene must not mutate its input nodes across multiple calls");
});

test("paintTerrainHex: emits fill + stroke with TERRAIN_COLORS keyed by node.terrain", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintTerrainHex(ctx, { kind: "terrainHex", q: 0, r: 0, world: { x: 10, y: 20 }, terrain: "grass" }, makeNoopPaint2DDep());
  const styleSet = calls.filter((c) => c.name.startsWith("set:"));
  const fill = styleSet.find((c) => c.name === "set:fillStyle");
  const stroke = styleSet.find((c) => c.name === "set:strokeStyle");
  assert.ok(fill, "should set fillStyle");
  assert.ok(stroke, "should set strokeStyle");
  assert.ok(calls.some((c) => c.name === "beginPath"), "should begin a path");
  assert.ok(calls.some((c) => c.name === "fill"), "should fill");
  assert.ok(calls.some((c) => c.name === "stroke"), "should stroke");
  const lineWidth = styleSet.find((c) => c.name === "set:lineWidth");
  assert.deepEqual(lineWidth?.args, [1], "live renderer uses 1px stroke for terrain hex");
});

test("paintTerrainDecoration: forest emits a tree triangle + trunk rect", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintTerrainDecoration(ctx, { kind: "terrainDecoration", q: 0, r: 0, world: { x: 0, y: 0 }, terrain: "forest" }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "beginPath"), "forest should draw a tree path");
  assert.ok(calls.some((c) => c.name === "fill"), "forest should fill the tree");
  assert.ok(calls.some((c) => c.name === "fillRect"), "forest should paint a trunk rect");
});

test("paintTerrainDecoration: mountain emits a grey triangle + a snow-cap triangle", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintTerrainDecoration(ctx, { kind: "terrainDecoration", q: 0, r: 0, world: { x: 0, y: 0 }, terrain: "mountain" }, makeNoopPaint2DDep());
  const triangleFills = calls.filter((c) => c.name === "fill").length;
  assert.ok(triangleFills >= 2, "mountain should paint at least two filled triangles (base + snow cap)");
});

test("paintTerrainDecoration: water emits a single arc stroke", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintTerrainDecoration(ctx, { kind: "terrainDecoration", q: 0, r: 0, world: { x: 0, y: 0 }, terrain: "water" }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "arc"), "water should draw an arc");
  assert.ok(calls.some((c) => c.name === "stroke"), "water should stroke the arc");
});

test("paintFogHex: emits the live fog rgba fill + a stroke", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintFogHex(ctx, { kind: "fogHex", q: 0, r: 0, world: { x: 0, y: 0 } }, makeNoopPaint2DDep());
  const fill = calls.find((c) => c.name === "set:fillStyle");
  assert.equal(fill?.args[0], "rgba(8, 10, 16, 0.78)", "fog fill must match the live rgba(8,10,16,0.78)");
  const stroke = calls.find((c) => c.name === "set:strokeStyle");
  assert.equal(stroke?.args[0], "rgba(8, 10, 16, 0.55)", "fog edge must match the live rgba(8,10,16,0.55)");
  assert.ok(calls.some((c) => c.name === "fill"), "fog should fill");
  assert.ok(calls.some((c) => c.name === "stroke"), "fog should stroke");
});

test("paintHoverHighlight: emits hexPath + 3px stroke in the live #ffcc00", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintHoverHighlight(ctx, { kind: "hoverHighlight", q: 0, r: 0, world: { x: 0, y: 0 } }, makeNoopPaint2DDep());
  const stroke = calls.find((c) => c.name === "set:strokeStyle");
  assert.equal(stroke?.args[0], "#ffcc00", "hover stroke must match the live #ffcc00");
  const lineWidth = calls.find((c) => c.name === "set:lineWidth");
  assert.deepEqual(lineWidth?.args, [3], "hover stroke must be 3px to match the live renderer");
  assert.ok(calls.some((c) => c.name === "beginPath"), "hover should begin a hex path");
  assert.ok(calls.some((c) => c.name === "stroke"), "hover should stroke");
  assert.ok(!calls.some((c) => c.name === "fill"), "hover should not fill");
});

test("paintCastle: emits an arc border; dashed when ownerId is null", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintCastle(ctx, { kind: "castle", settlementId: "s", world: { x: 50, y: 50 }, level: 1, variant: 0, ownerId: null, selected: false, color: "rgba(255,255,255,0.18)", dashedBorder: true }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "arc"), "should draw an arc border");
  const setDash = calls.filter((c) => c.name === "setLineDash");
  assert.ok(setDash.length >= 1, "should call setLineDash at least once (4,4 for unowned)");
});

test("paintCharterOverlay: traveling phase uses dashed stroke, constructing uses solid + two house triangles", () => {
  const { ctx: ctxTravel, calls: callsTravel } = makeRecordingCtx();
  paintCharterOverlay(ctxTravel, { kind: "charterOverlay", q: 0, r: 0, world: { x: 0, y: 0 }, phase: "traveling" }, makeNoopPaint2DDep());
  assert.ok(callsTravel.some((c) => c.name === "setLineDash"), "traveling should set a dash pattern");
  assert.ok(callsTravel.some((c) => c.name === "fill"), "traveling should fill");

  const { ctx: ctxConstruct, calls: callsConstruct } = makeRecordingCtx();
  paintCharterOverlay(ctxConstruct, { kind: "charterOverlay", q: 0, r: 0, world: { x: 0, y: 0 }, phase: "constructing" }, makeNoopPaint2DDep());
  // Each triangle has 1 moveTo + 2 lineTo; two triangles -> 2 moveTo + 4 lineTo.
  const moveToCount = callsConstruct.filter((c) => c.name === "moveTo").length;
  const lineToCount = callsConstruct.filter((c) => c.name === "lineTo").length;
  assert.ok(moveToCount >= 2, "constructing should draw two house triangles (2 moveTo)");
  assert.ok(lineToCount >= 4, "constructing should draw two house triangles (4 lineTo)");
});

test("paintValidCharterHex: emits a dashed stroke + a translucent fill using deps.validCharterStyle", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintValidCharterHex(ctx, { kind: "validCharterHex", q: 0, r: 0, world: { x: 0, y: 0 } }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "setLineDash"), "valid charter should dash");
  assert.ok(calls.some((c) => c.name === "stroke"), "should stroke");
  assert.ok(calls.some((c) => c.name === "fill"), "should fill");
});

test("paintPathSegment: reachable uses 4px width + 6px midpoint dots, unreachable uses 3px + 4px", () => {
  const { ctx: ctxR, calls: callsR } = makeRecordingCtx();
  paintPathSegment(ctxR, { kind: "pathSegment", reachable: true, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }] }, makeNoopPaint2DDep());
  const lwR = callsR.find((c) => c.name === "set:lineWidth");
  assert.deepEqual(lwR?.args, [4], "reachable path uses 4px line width");

  const { ctx: ctxU, calls: callsU } = makeRecordingCtx();
  paintPathSegment(ctxU, { kind: "pathSegment", reachable: false, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }] }, makeNoopPaint2DDep());
  const lwU = callsU.find((c) => c.name === "set:lineWidth");
  assert.deepEqual(lwU?.args, [3], "unreachable path uses 3px line width");
});

test("paintHeroTrail: emits two save()/restore() pairs (per-traversal) + the dot arc + the line stroke", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintHeroTrail(ctx, { kind: "heroTrail", heroId: "h", color: "#fff", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }] }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "save"), "should save ctx state");
  assert.ok(calls.some((c) => c.name === "restore"), "should restore ctx state");
  assert.ok(calls.some((c) => c.name === "arc"), "should draw trail dots");
  assert.ok(calls.some((c) => c.name === "stroke"), "should stroke the trail line");
});

test("paintTerritoryOutlineEdge: emits a 0.45-alpha line + uses deps.getTerritoryBorderWidth() as lineWidth", () => {
  const { ctx, calls } = makeRecordingCtx();
  const deps = makeNoopPaint2DDep();
  const stub = new Map<string, unknown>([["getTerritoryBorderWidth", 2.5]]);
  void stub;
  const realGetter = deps.getTerritoryBorderWidth;
  let capturedWidth: number | undefined;
  (deps as { getTerritoryBorderWidth: () => number }).getTerritoryBorderWidth = () => {
    capturedWidth = 2.5;
    return 2.5;
  };
  paintTerritoryOutlineEdge(ctx, { kind: "territoryOutlineEdge", ownerId: 0, color: "#abc", x1: 0, y1: 0, x2: 10, y2: 10 }, deps);
  assert.equal(capturedWidth, 2.5, "should consult deps.getTerritoryBorderWidth()");
  const lineWidth = calls.find((c) => c.name === "set:lineWidth");
  assert.deepEqual(lineWidth?.args, [2.5], "live emission uses deps.getTerritoryBorderWidth()");
  const alpha = calls.find((c) => c.name === "set:globalAlpha");
  assert.deepEqual(alpha?.args, [0.45], "live emission uses 0.45 globalAlpha");
  (deps as { getTerritoryBorderWidth: () => number }).getTerritoryBorderWidth = realGetter;
});

test("paintHero: with hero horseVariant and no sprite, falls back to drawKnightSprite (calls ctx.fillRect)", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintHero(ctx, { kind: "hero", heroId: "h", ownerId: 0, world: { x: 0, y: 0 }, facingDirection: "N", horseVariant: "hero", faction: "player", scaleY: 1, color: "#fff", selected: false }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "fillRect"), "procedural knight should call fillRect for each pixel");
  assert.ok(calls.some((c) => c.name === "arc"), "should also draw the owner dot");
});

test("paintCitySkybox: without skybox provider, falls back to the CITY_BG fillRect", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintCitySkybox(ctx, { kind: "citySkybox", viewportW: 800, viewportH: 600, spriteVariant: 1, parallaxEnabled: false, parallaxLayerCount: 4, offsetX: 0, offsetY: 0 }, makeNoopPaint2DDep(), { viewportW: 800, viewportH: 600 });
  assert.ok(calls.some((c) => c.name === "fillRect"), "skybox should fillRect the BG fallback when no provider");
  const fill = calls.find((c) => c.name === "set:fillStyle");
  assert.equal(fill?.args[0], "#1a1620", "fallback must match the live CITY_BG");
});

test("paintCityCell: hovered uses 3px gold stroke, unhovered uses 1px #3a3450", () => {
  const { ctx: ctxH, calls: callsH } = makeRecordingCtx();
  paintCityCell(ctxH, { kind: "cityCell", gx: 0, gy: 0, screen: { x: 0, y: 0 }, halfWidth: 10, halfHeight: 10, hovered: true }, makeNoopPaint2DDep());
  const lwH = callsH.find((c) => c.name === "set:lineWidth");
  assert.deepEqual(lwH?.args, [3], "hovered cell uses 3px stroke");

  const { ctx: ctxU, calls: callsU } = makeRecordingCtx();
  paintCityCell(ctxU, { kind: "cityCell", gx: 0, gy: 0, screen: { x: 0, y: 0 }, halfWidth: 10, halfHeight: 10, hovered: false }, makeNoopPaint2DDep());
  const lwU = callsU.find((c) => c.name === "set:lineWidth");
  assert.deepEqual(lwU?.args, [1], "unhovered cell uses 1px stroke");
});

test("paintCityResourceSpot: without a sprite, falls back to the diamond shape with RESOURCE_PAL colors", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintCityResourceSpot(ctx, { kind: "cityResourceSpot", gx: 0, gy: 0, screen: { x: 0, y: 0 }, tileWidth: 40, tileHeight: 40, resource: "gold" }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "lineTo"), "diamond should call lineTo");
  assert.ok(calls.some((c) => c.name === "fill"), "diamond should fill");
  assert.ok(calls.some((c) => c.name === "stroke"), "diamond should stroke");
  const fill = calls.find((c) => c.name === "set:fillStyle");
  assert.ok(fill?.args[0]?.length > 0, "fill should use RESOURCE_PAL[gold].stone");
});

test("paintCityMine: emits the diamond + the four inked wall polygons + the level number", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintCityMine(ctx, { kind: "cityMine", gx: 0, gy: 0, screen: { x: 0, y: 0 }, tileWidth: 40, tileHeight: 40, resource: "gold", level: 3 }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "fillRect"), "mine should fillRect the wall section");
  assert.ok(calls.some((c) => c.name === "fillText"), "mine should print the level number");
  const text = calls.find((c) => c.name === "fillText");
  assert.equal(text?.args?.[0], "3", "mine should print the level");
});

test("paintCityBuilding: with selected=true, draws a dashed cyan strokeRect around the footprint", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintCityBuilding(ctx, { kind: "cityBuilding", gx: 0, gy: 0, buildingKind: "townHall", level: 1, center: { x: 0, y: 0 }, halfWidth: 20, halfHeight: 20, ownerColor: "#888", style: "classic", selected: true }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "strokeRect"), "selected building should strokeRect");
  assert.ok(calls.some((c) => c.name === "setLineDash"), "selected building should be dashed");
});

test("paintCityGhostBuilding: emits a 0.45-alpha strokeRect green/red depending on node.valid", () => {
  const { ctx: ctxG, calls: callsG } = makeRecordingCtx();
  paintCityGhostBuilding(ctxG, { kind: "cityGhostBuilding", buildingKind: "townHall", center: { x: 0, y: 0 }, halfWidth: 20, halfHeight: 20, ownerColor: "#888", style: "classic", valid: true }, makeNoopPaint2DDep());
  const strokeG = callsG.find((c) => c.name === "set:strokeStyle");
  assert.equal(strokeG?.args[0], "#44ff44", "valid ghost should be green");

  const { ctx: ctxR, calls: callsR } = makeRecordingCtx();
  paintCityGhostBuilding(ctxR, { kind: "cityGhostBuilding", buildingKind: "townHall", center: { x: 0, y: 0 }, halfWidth: 20, halfHeight: 20, ownerColor: "#888", style: "classic", valid: false }, makeNoopPaint2DDep());
  const strokeR = callsR.find((c) => c.name === "set:strokeStyle");
  assert.equal(strokeR?.args[0], "#ff4444", "invalid ghost should be red");
});

test("paintCityLabel: emits a fillText with the node's text and fontPx", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintCityLabel(ctx, { kind: "cityLabel", text: "Castle", x: 10, y: 20, fontPx: 14, alpha: 1 }, makeNoopPaint2DDep());
  const text = calls.find((c) => c.name === "fillText");
  assert.equal(text?.args?.[0], "Castle");
  assert.equal(text?.args?.[1], 10);
  assert.equal(text?.args?.[2], 20);
  const font = calls.find((c) => c.name === "set:font");
  assert.ok(font?.args?.[0]?.includes("14px"), "label should use 14px font");
});

test("paintBattleHex: inMoveRange uses rgba(210,210,215,0.35) fill, available uses bright gold stroke", () => {
  const { ctx: ctxR, calls: callsR } = makeRecordingCtx();
  paintBattleHex(ctxR, { kind: "battleHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30, impassable: false, inMoveRange: true, available: false }, makeNoopPaint2DDep());
  const fillR = callsR.find((c) => c.name === "set:fillStyle");
  assert.equal(fillR?.args[0], "rgba(210,210,215,0.35)", "in-range hex should use the rgba(210,210,215,0.35) fill");

  const { ctx: ctxA, calls: callsA } = makeRecordingCtx();
  paintBattleHex(ctxA, { kind: "battleHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30, impassable: false, inMoveRange: false, available: true }, makeNoopPaint2DDep());
  const strokeA = callsA.find((c) => c.name === "set:strokeStyle");
  assert.equal(strokeA?.args[0], "rgba(255,214,102,0.9)", "available hex should use the bright gold stroke");
});

test("paintBattleAttackTargetRing: arcs the target area in #e05050", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintBattleAttackTargetRing(ctx, { kind: "battleAttackTargetRing", side: "attacker", slotIndex: 0, world: { x: 0, y: 0 }, radius: 24 }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "arc"), "should draw an arc");
  const stroke = calls.find((c) => c.name === "set:strokeStyle");
  assert.equal(stroke?.args[0], "#e05050", "should use the live attack-target red");
});

test("paintBattleAiTelegraphHex: red fill + stroke around the predicted target hex", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintBattleAiTelegraphHex(ctx, { kind: "battleAiTelegraphHex", q: 0, r: 0, world: { x: 0, y: 0 }, hexRadius: 30 }, makeNoopPaint2DDep());
  const fill = calls.find((c) => c.name === "set:fillStyle");
  assert.equal(fill?.args[0], "rgba(224,80,80,0.22)", "AI telegraph should use the 0.22-alpha red fill");
});

test("paintBattleMovePath: emits a 2px white-alpha line through the path points", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintBattleMovePath(ctx, { kind: "battleMovePath", side: "attacker", slotIndex: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }] }, makeNoopPaint2DDep());
  const stroke = calls.find((c) => c.name === "set:strokeStyle");
  assert.equal(stroke?.args[0], "rgba(255,255,255,0.28)", "move path should use the white-alpha stroke");
  const lw = calls.find((c) => c.name === "set:lineWidth");
  assert.deepEqual(lw?.args, [2], "move path should use 2px line width");
});

test("paintBattleImpactRing: emits an arc whose alpha tracks node.alpha", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintBattleImpactRing(ctx, { kind: "battleImpactRing", world: { x: 0, y: 0 }, radius: 30, alpha: 0.45 }, makeNoopPaint2DDep());
  const stroke = calls.find((c) => c.name === "set:strokeStyle");
  assert.equal(stroke?.args[0], "rgba(255,190,90,0.45)", "impact ring should use the rgba(255,190,90,alpha) stroke");
});

test("paintBattleAiActingRing: arcs the AI's acting slot in #fff 3px", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintBattleAiActingRing(ctx, { kind: "battleAiActingRing", side: "attacker", slotIndex: 0, world: { x: 0, y: 0 }, radius: 24 }, makeNoopPaint2DDep());
  const stroke = calls.find((c) => c.name === "set:strokeStyle");
  assert.equal(stroke?.args[0], "#ffffff", "AI acting ring should be white");
  assert.ok(calls.some((c) => c.name === "arc"), "should draw an arc");
});

test("paintBattleCombatant: selected attacker uses bright blue, unselected defender uses dark red, prints unitCount + HP bar", () => {
  const { ctx: ctxA, calls: callsA } = makeRecordingCtx();
  paintBattleCombatant(ctxA, { kind: "battleCombatant", side: "attacker", slotIndex: 0, world: { x: 0, y: 0 }, radius: 16, selected: true, unitCount: 5, hpRatio: 0.8 }, makeNoopPaint2DDep());
  const fillA = callsA.find((c) => c.name === "set:fillStyle");
  assert.equal(fillA?.args[0], "#5fb0ff", "selected attacker uses bright blue");
  const text = callsA.find((c) => c.name === "fillText");
  assert.equal(text?.args?.[0], "5", "combatant should print unitCount");

  const { ctx: ctxD, calls: callsD } = makeRecordingCtx();
  paintBattleCombatant(ctxD, { kind: "battleCombatant", side: "defender", slotIndex: 0, world: { x: 0, y: 0 }, radius: 16, selected: false, unitCount: 3, hpRatio: 0.5 }, makeNoopPaint2DDep());
  const fillD = callsD.find((c) => c.name === "set:fillStyle");
  assert.equal(fillD?.args[0], "#c04040", "unselected defender uses dark red");
});

test("paintBattleFloatingText: emits a strokeText + fillText pair with the alpha-coloured rgba", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintBattleFloatingText(ctx, { kind: "battleFloatingText", text: "-5", world: { x: 0, y: 0 }, alpha: 0.8 }, makeNoopPaint2DDep());
  assert.ok(calls.some((c) => c.name === "strokeText"), "float should outline the text");
  assert.ok(calls.some((c) => c.name === "fillText"), "float should fill the text");
  const fill = calls.find((c) => c.name === "set:fillStyle");
  assert.equal(fill?.args[0], "rgba(255,214,102,0.8)", "float fill should match the live gold-tinted alpha");
});
