import { test } from "node:test";
import assert from "node:assert/strict";
import type { CharterState } from "@heroes/contracts";
import { Hero } from "../../src/entities/hero";
import { Castle } from "../../src/entities/settlement";
import { axialToPixel, type Axial } from "../../src/core/hex";
import { computeReachableSplit } from "../../src/render/overlays/pathOverlay";
import { buildAdventureScene } from "../../src/render/scene/sceneBuilder/adventureScene";
import type {
  CaravanMarkerNode,
  CastleNode,
  CharterOverlayNode,
  FogHexNode,
  HeroNode,
  HeroTrailNode,
  HoverHighlightNode,
  PathSegmentNode,
  ResourceIconNode,
  SelectedTileHighlightNode,
  TerrainHexNode,
  TerritoryOutlineEdgeNode,
  ValidCharterHexNode,
} from "../../src/render/scene/types";
import { makeGrassMap, makeRenderOptions, stubColorForOwner } from "./_helpers";

function nodesOfKind<K extends { kind: string }>(nodes: unknown[], kind: K["kind"]): K[] {
  return (nodes as { kind: string }[]).filter((n) => n.kind === kind) as K[];
}

test("terrain is always emitted; fog covers every tile the view player can't see", () => {
  const map = makeGrassMap(3, 1);
  const enemyHero = new Hero("h-enemy", "Enemy", 0, 0, "enemy", 1);
  const nodes = buildAdventureScene({
    map,
    heroes: [enemyHero],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });

  assert.equal(nodesOfKind<TerrainHexNode>(nodes, "terrainHex").length, 3);
  assert.equal(nodesOfKind(nodes, "terrainDecoration").length, 3);
  assert.equal(nodesOfKind<FogHexNode>(nodes, "fogHex").length, 3, "nothing is owned by viewPlayerId=0, so every tile should be fogged");
  assert.equal(nodesOfKind<HeroNode>(nodes, "hero").length, 0, "the enemy hero is hidden by fog of war");
});

test("an owned hero's vision clears fog and the hero itself is drawn", () => {
  const map = makeGrassMap(3, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });

  assert.equal(nodesOfKind<FogHexNode>(nodes, "fogHex").length, 0, "VISION_RANGE=4 should cover this whole 3-wide map");
  const heroNodes = nodesOfKind<HeroNode>(nodes, "hero");
  assert.equal(heroNodes.length, 1);
  const [node] = heroNodes;
  assert.equal(node.heroId, "h0");
  assert.equal(node.ownerId, 0);
  assert.deepEqual(node.world, axialToPixel(0, 0));
  assert.equal(node.scaleY, 1.0, "not moving -> no squash/stretch");
  assert.equal(node.runFrame, 0, "not moving -> base sprite");
  assert.equal(node.facingDirection, "n");
  assert.equal(node.color, stubColorForOwner(0));
  assert.equal(node.selected, false);
});

test("runFrame: moving heroes alternate poses on moveProgress halves, stationary stays 0", () => {
  const map = makeGrassMap(3, 1);
  const stationary = new Hero("h0", "Hero", 0, 0, "player", 0);
  const firstHalf = new Hero("h1", "Hero", 0, 0, "player", 0);
  firstHalf.moving = true;
  firstHalf.moveProgress = 0.25;
  const secondHalf = new Hero("h2", "Hero", 0, 0, "player", 0);
  secondHalf.moving = true;
  secondHalf.moveProgress = 0.75;
  const nodes = buildAdventureScene({
    map,
    heroes: [stationary, firstHalf, secondHalf],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });

  const heroNodes = nodesOfKind<HeroNode>(nodes, "hero");
  const byId = new Map(heroNodes.map((n) => [n.heroId, n]));
  assert.equal(byId.get("h0")!.runFrame, 0);
  assert.equal(byId.get("h1")!.runFrame, 0, "moveProgress < 0.5 is the base pose");
  assert.equal(byId.get("h2")!.runFrame, 1, "moveProgress >= 0.5 is the frame-2 pose");
});

test("resource icons only render on visible tiles", () => {
  const map = makeGrassMap(2, 1, [{ q: 1, r: 0, resource: "gold" }]);
  const opts = makeRenderOptions({ viewPlayerId: 0 });

  const hidden = buildAdventureScene({ map, heroes: [], castles: [], path: [], hover: null, opts });
  assert.equal(nodesOfKind<ResourceIconNode>(hidden, "resourceIcon").length, 0);

  const hero = new Hero("h0", "Hero", 1, 0, "player", 0);
  const visible = buildAdventureScene({ map, heroes: [hero], castles: [], path: [], hover: null, opts });
  const icons = nodesOfKind<ResourceIconNode>(visible, "resourceIcon");
  assert.equal(icons.length, 1);
  assert.equal(icons[0].resource, "gold");
  assert.equal(icons[0].q, 1);
  assert.equal(icons[0].r, 0);
});

test("charter overlay and valid-charter-hex nodes respect visibility and skip malformed keys", () => {
  const map = makeGrassMap(2, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const charter: CharterState = {
    id: "c0",
    heroId: "h0",
    ownerId: 0,
    targetQ: 1,
    targetR: 0,
    settlementName: "New Town",
    phase: "traveling",
    daysRemaining: 5,
    settlementId: "s-new",
    resourceRates: {},
    foundedOnResource: null,
    citySpots: [],
  };
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({
      viewPlayerId: 0,
      activeCharters: [charter],
      validCharterHexes: new Set(["1,0", "bogus", "NaN,0"]),
    }),
  });

  const charterNodes = nodesOfKind<CharterOverlayNode>(nodes, "charterOverlay");
  assert.equal(charterNodes.length, 1);
  assert.equal(charterNodes[0].q, 1);
  assert.equal(charterNodes[0].phase, "traveling");

  const validHexNodes = nodesOfKind<ValidCharterHexNode>(nodes, "validCharterHex");
  assert.equal(validHexNodes.length, 1, "malformed keys must be skipped, not throw");
  assert.equal(validHexNodes[0].q, 1);
  assert.equal(validHexNodes[0].r, 0);
});

test("castles: owner color/dashed-border mapping and per-castle visibility gating", () => {
  const map = makeGrassMap(6, 1);
  const ownHero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const ownedCastle = new Castle("s-own", { q: 0, r: 0 }, 1, 0, "Home", 0, 0, {}, null);
  const nearNeutral = new Castle("s-near", { q: 2, r: 0 }, 1, null, "Near", 0, 0, {}, null);
  const farNeutral = new Castle("s-far", { q: 5, r: 0 }, 1, null, "Far", 0, 0, {}, null);

  const nodes = buildAdventureScene({
    map,
    heroes: [ownHero],
    castles: [ownedCastle, nearNeutral, farNeutral],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedSettlementId: "s-own" }),
  });

  const castleNodes = nodesOfKind<CastleNode>(nodes, "castle");
  const byId = new Map(castleNodes.map((c) => [c.settlementId, c]));
  assert.equal(castleNodes.length, 2, "the far neutral castle is outside the owned hero's vision");
  assert.ok(!byId.has("s-far"));

  const own = byId.get("s-own")!;
  assert.equal(own.color, stubColorForOwner(0));
  assert.equal(own.dashedBorder, false);
  assert.equal(own.selected, true);

  const near = byId.get("s-near")!;
  assert.equal(near.color, "rgba(255,255,255,0.18)");
  assert.equal(near.dashedBorder, true);
  assert.equal(near.selected, false);
});

test("territory outline edges are tagged with the owning castle's id and color", () => {
  const map = makeGrassMap(3, 3);
  const castle = new Castle("s0", { q: 1, r: 1 }, 1, 0, "Home", 0, 0, {}, null);
  const nodes = buildAdventureScene({
    map,
    heroes: [],
    castles: [castle],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });

  const edges = nodesOfKind<TerritoryOutlineEdgeNode>(nodes, "territoryOutlineEdge");
  assert.ok(edges.length > 0, "a single owned castle should produce at least one boundary edge");
  for (const edge of edges) {
    assert.equal(edge.ownerId, 0);
    assert.equal(edge.color, stubColorForOwner(0));
  }
});

test("hover highlight only appears when the hovered tile is visible", () => {
  const map = makeGrassMap(6, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const opts = makeRenderOptions({ viewPlayerId: 0 });

  const noHover = buildAdventureScene({ map, heroes: [hero], castles: [], path: [], hover: null, opts });
  assert.equal(nodesOfKind<HoverHighlightNode>(noHover, "hoverHighlight").length, 0);

  const visibleHover = buildAdventureScene({ map, heroes: [hero], castles: [], path: [], hover: { q: 1, r: 0 }, opts });
  const visible = nodesOfKind<HoverHighlightNode>(visibleHover, "hoverHighlight");
  assert.equal(visible.length, 1);
  assert.deepEqual(visible[0].world, axialToPixel(1, 0));

  const farHover = buildAdventureScene({ map, heroes: [hero], castles: [], path: [], hover: { q: 5, r: 0 }, opts });
  assert.equal(nodesOfKind<HoverHighlightNode>(farHover, "hoverHighlight").length, 0, "q=5 is hex-distance 5 from the hero, outside VISION_RANGE=4");
});

test("selected-tile highlight is emitted from opts.inspectedTile, even on a fogged hex (unlike hover)", () => {
  const map = makeGrassMap(6, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);

  const noSelection = buildAdventureScene({
    map, heroes: [hero], castles: [], path: [], hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });
  assert.equal(nodesOfKind<SelectedTileHighlightNode>(noSelection, "selectedTileHighlight").length, 0);

  const fogged = buildAdventureScene({
    map, heroes: [hero], castles: [], path: [], hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, inspectedTile: { q: 5, r: 0 } }),
  });
  const nodes = nodesOfKind<SelectedTileHighlightNode>(fogged, "selectedTileHighlight");
  assert.equal(nodes.length, 1, "q=5 is fogged (outside VISION_RANGE=4) but the ring should still draw");
  assert.deepEqual(nodes[0].world, axialToPixel(5, 0));
});

test("path nodes: fully reachable path produces one segment plus the hero's trail", () => {
  const map = makeGrassMap(4, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 10, [{ q: -1, r: 0 }, { q: 0, r: 0 }]);
  const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }];
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path,
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h0" }),
  });

  const splitIdx = computeReachableSplit(path, map, hero.movementRemaining);
  assert.equal(splitIdx, path.length, "movementRemaining=10 should cover all 3 grass steps");

  const segments = nodesOfKind<PathSegmentNode>(nodes, "pathSegment");
  assert.equal(segments.length, 1, "fully reachable -> no separate unreachable segment");
  assert.equal(segments[0].reachable, true);
  assert.deepEqual(
    segments[0].points,
    [axialToPixel(0, 0), axialToPixel(1, 0), axialToPixel(2, 0), axialToPixel(3, 0)],
  );

  const trails = nodesOfKind<HeroTrailNode>(nodes, "heroTrail");
  assert.equal(trails.length, 1);
  assert.equal(trails[0].heroId, "h0");
  assert.equal(trails[0].color, stubColorForOwner(0));
  assert.deepEqual(trails[0].points, [axialToPixel(-1, 0), axialToPixel(0, 0)]);
});

test("path nodes: partially reachable path splits into reachable/unreachable segments (characterizes pathOverlay's existing split math)", () => {
  const map = makeGrassMap(5, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 1);
  const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }];
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path,
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h0" }),
  });

  const splitIdx = computeReachableSplit(path, map, hero.movementRemaining);
  assert.equal(splitIdx, 1, "movementRemaining=1 only affords the first grass step");

  const segments = nodesOfKind<PathSegmentNode>(nodes, "pathSegment");
  const reachable = segments.find((s) => s.reachable);
  const unreachable = segments.find((s) => !s.reachable);
  assert.deepEqual(reachable?.points, [axialToPixel(0, 0), axialToPixel(1, 0)]);
  // pathOverlay.ts's unreachable slice runs to `pathPx.length`, not `fullPx.length` --
  // it never includes the path's final tile's own pixel position. This mirrors that
  // existing behavior verbatim (not something introduced by this decomposition).
  assert.deepEqual(unreachable?.points, [axialToPixel(1, 0), axialToPixel(2, 0), axialToPixel(3, 0)]);
});

test("computeReachableSplit: a fractional movementRemaining below a hex's full cost is still reachable (regression for issue #129)", () => {
  const map = makeGrassMap(2, 1);
  const path = [{ q: 1, r: 0 }];
  const splitIdx = computeReachableSplit(path, map, 0.5);
  assert.equal(splitIdx, 1, "0.5 remaining should still afford one more grass hex (cost 1)");
});

test("pathReachableIdx and pathOrigin overrides are honored", () => {
  const map = makeGrassMap(4, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 10);
  const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }];
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path,
    hover: null,
    opts: makeRenderOptions({
      viewPlayerId: 0,
      selectedHeroId: "h0",
      pathReachableIdx: 1,
      pathOrigin: { q: -2, r: 0 },
    }),
  });

  const segments = nodesOfKind<PathSegmentNode>(nodes, "pathSegment");
  const reachable = segments.find((s) => s.reachable);
  const unreachable = segments.find((s) => !s.reachable);
  assert.deepEqual(reachable?.points, [axialToPixel(-2, 0), axialToPixel(1, 0)], "pathOrigin should anchor the origin point instead of the hero's tile");
  assert.deepEqual(unreachable?.points, [axialToPixel(1, 0), axialToPixel(2, 0)], "pathReachableIdx=1 should force the split despite movementRemaining=10");
});

test("no heroes or no proposed path -> no path/trail nodes at all", () => {
  const map = makeGrassMap(3, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 10, [{ q: -1, r: 0 }, { q: 0, r: 0 }]);
  const opts = makeRenderOptions({ viewPlayerId: 0 });

  const noPath = buildAdventureScene({ map, heroes: [hero], castles: [], path: [], hover: null, opts });
  assert.equal(nodesOfKind(noPath, "pathSegment").length, 0);
  assert.equal(nodesOfKind(noPath, "heroTrail").length, 0, "trail is gated behind a non-empty proposed path, matching pathOverlay.ts");

  const noHeroes = buildAdventureScene({ map, heroes: [], castles: [], path: [{ q: 1, r: 0 }], hover: null, opts });
  assert.equal(nodesOfKind(noHeroes, "pathSegment").length, 0);

  const noSelection = buildAdventureScene({ map, heroes: [hero], castles: [], path: [{ q: 1, r: 0 }], hover: null, opts });
  assert.equal(nodesOfKind(noSelection, "pathSegment").length, 0, "no selectedHeroId -> no path (no heroes[0] fallback)");

  const staleSelection = buildAdventureScene({
    map, heroes: [hero], castles: [], path: [{ q: 1, r: 0 }], hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h-gone" }),
  });
  assert.equal(nodesOfKind(staleSelection, "pathSegment").length, 0, "a selection the hero list no longer carries emits nothing");
  assert.equal(nodesOfKind(staleSelection, "heroTrail").length, 0);
});

test("path/trail nodes render only for the viewer's OWN selected hero (fog-position leak defense)", () => {
  const map = makeGrassMap(4, 1);
  const own = new Hero("h0", "Own", 0, 0, "player", 0, 10, [{ q: -1, r: 0 }, { q: 0, r: 0 }]);
  const foreign = new Hero("h1", "Foe", 3, 0, "enemy", 1, 10, [{ q: 4, r: 0 }, { q: 3, r: 0 }]);
  const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }];

  const foreignSelected = buildAdventureScene({
    map, heroes: [own, foreign], castles: [], path, hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h1" }),
  });
  assert.equal(nodesOfKind(foreignSelected, "pathSegment").length, 0, "a foreign selected hero emits no path segments");
  const foreignTrails = nodesOfKind<HeroTrailNode>(foreignSelected, "heroTrail");
  assert.ok(
    foreignTrails.every((t) => t.heroId !== "h0"),
    "a foreign selection must not unlock the viewer's own-hero trail",
  );
  assert.ok(
    foreignTrails.every((t) => t.intensity === 0.45),
    "the only trail allowed here is the dim enemy-reveal trail, never a full-alpha own-hero trail",
  );

  const ownSelected = buildAdventureScene({
    map, heroes: [own, foreign], castles: [], path, hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h0" }),
  });
  const segments = nodesOfKind<PathSegmentNode>(ownSelected, "pathSegment");
  assert.ok(segments.length >= 1, "own selection emits the path as before");
  assert.ok(segments.every((s) => s.points[0] !== axialToPixel(3, 0)), "no segment anchors at the foreign hero's tile");
  const trails = nodesOfKind<HeroTrailNode>(ownSelected, "heroTrail");
  const ownTrail = trails.find((t) => t.heroId === "h0");
  assert.ok(ownTrail, "the own selection still renders its own trail");
  assert.equal(ownTrail.intensity, undefined, "the own trail is drawn at full intensity");
});

test("a fog-hidden foreign hero leaks nothing: no path, and no reveal trail", () => {
  const map = makeGrassMap(12, 1);
  const own = new Hero("h0", "Own", 0, 0, "player", 0, 10, [{ q: -1, r: 0 }, { q: 0, r: 0 }]);
  const foreign = new Hero("h1", "Foe", 9, 0, "enemy", 1, 10, [
    { q: 11, r: 0 }, { q: 10, r: 0 }, { q: 9, r: 0 },
  ]);
  const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }];

  const nodes = buildAdventureScene({
    map, heroes: [own, foreign], castles: [], path, hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h1" }),
  });

  assert.equal(nodesOfKind<PathSegmentNode>(nodes, "pathSegment").length, 0);
  assert.equal(
    nodesOfKind<HeroTrailNode>(nodes, "heroTrail").filter((t) => t.heroId === "h1").length,
    0,
    "q=9 is outside VISION_RANGE=4, so its trail must not be drawn",
  );
});

test("a visible enemy hero gets one dim reveal trail capped to the last 8 points", () => {
  const map = makeGrassMap(4, 1);
  const own = new Hero("h0", "Own", 0, 0, "player", 0, 10);
  const enemyTrail: Axial[] = [];
  for (let i = 9; i >= 0; i--) enemyTrail.push({ q: 2 - i, r: 0 });
  const enemy = new Hero("h1", "Foe", 2, 0, "enemy", 1, 10, enemyTrail);

  const nodes = buildAdventureScene({
    map, heroes: [own, enemy], castles: [], path: [], hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });

  const trails = nodesOfKind<HeroTrailNode>(nodes, "heroTrail");
  assert.equal(trails.length, 1);
  const [trail] = trails;
  assert.equal(trail.heroId, "h1");
  assert.equal(trail.intensity, 0.45, "an enemy trail is dimmer than the viewer's own");
  assert.equal(trail.color, stubColorForOwner(1));
  assert.equal(trail.points.length, 8, "the reveal trail keeps a short recent history");
  assert.deepEqual(trail.points[0], axialToPixel(-5, 0), "the oldest kept point is 8 back");
  assert.deepEqual(trail.points[7], axialToPixel(2, 0), "the newest kept point is the hero's last trail entry");
  assert.equal(enemy.trail.length, enemyTrail.length, "the hero's own trail history is untouched");
});

test("an enemy hero with no trail history emits no trail node", () => {
  const map = makeGrassMap(4, 1);
  const own = new Hero("h0", "Own", 0, 0, "player", 0, 10);
  const enemy = new Hero("h1", "Foe", 2, 0, "enemy", 1, 10);
  const nodes = buildAdventureScene({
    map, heroes: [own, enemy], castles: [], path: [], hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });
  assert.equal(nodesOfKind<HeroTrailNode>(nodes, "heroTrail").length, 0);
});

test("opts.heroAlpha fades non-own heroes only, and is absent when there is no fade", () => {
  const map = makeGrassMap(4, 1);
  const own = new Hero("h0", "Own", 0, 0, "player", 0, 10);
  const fading = new Hero("h1", "Foe", 1, 0, "enemy", 1, 10);
  const steady = new Hero("h2", "Foe", 2, 0, "enemy", 2, 10);
  const nodes = buildAdventureScene({
    map, heroes: [own, fading, steady], castles: [], path: [], hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, heroAlpha: { h1: 0.5 } }),
  });

  const byId = new Map(nodesOfKind<HeroNode>(nodes, "hero").map((n) => [n.heroId, n]));
  assert.equal(byId.get("h1")!.alpha, 0.5, "a hero with a pending fade carries the alpha");
  assert.ok(!("alpha" in byId.get("h2")!), "an enemy absent from heroAlpha has NO alpha field");
  assert.ok(!("alpha" in byId.get("h0")!), "an own hero never carries an alpha field");
});

test("a heroAlpha entry of 1 is dropped rather than written as a redundant 1", () => {
  const map = makeGrassMap(4, 1);
  const own = new Hero("h0", "Own", 0, 0, "player", 0, 10);
  const enemy = new Hero("h1", "Foe", 1, 0, "enemy", 1, 10);
  const nodes = buildAdventureScene({
    map, heroes: [own, enemy], castles: [], path: [], hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, heroAlpha: { h1: 1 } }),
  });
  const hero = nodesOfKind<HeroNode>(nodes, "hero").find((n) => n.heroId === "h1");
  assert.ok(!("alpha" in hero!), "no fade means the field stays absent so painters take their default path");
});

test("path segments are marked fogged when any tile they span lies under fog (F4)", () => {
  const map = makeGrassMap(7, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 1);
  const path = [
    { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 },
    { q: 4, r: 0 }, { q: 5, r: 0 }, { q: 6, r: 0 },
  ];
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path,
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h0" }),
  });

  const segments = nodesOfKind<PathSegmentNode>(nodes, "pathSegment");
  const reachable = segments.find((s) => s.reachable);
  const unreachable = segments.find((s) => !s.reachable);
  assert.ok(!reachable?.fogged, "origin + first step are within VISION_RANGE=4 of the hero");
  assert.equal(unreachable?.fogged, true, "the dim tail reaches q=5, outside VISION_RANGE=4");
});

test("a fully visible path carries no fogged flag (F4)", () => {
  const map = makeGrassMap(4, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 10);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h0" }),
  });

  const segments = nodesOfKind<PathSegmentNode>(nodes, "pathSegment");
  assert.equal(segments.length, 1);
  assert.notEqual(segments[0].fogged, true);
});

test("a fogged pathOrigin marks the reachable segment fogged too, so bright segments get the under-stroke (F4)", () => {
  const map = makeGrassMap(7, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 10);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [{ q: 1, r: 0 }, { q: 2, r: 0 }],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h0", pathOrigin: { q: 6, r: 0 }, pathReachableIdx: 1 }),
  });

  const reachable = nodesOfKind<PathSegmentNode>(nodes, "pathSegment").find((s) => s.reachable);
  assert.deepEqual(reachable?.points, [axialToPixel(6, 0), axialToPixel(1, 0)]);
  assert.equal(reachable?.fogged, true, "the overridden origin (6,0) sits in fog");
});

test("hero trail points are capped to the last 25, render-side only (F14)", () => {
  const map = makeGrassMap(3, 1);
  const trail: Axial[] = [];
  for (let i = 39; i >= 0; i--) trail.push({ q: -i, r: 0 });
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 10, trail);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [{ q: 1, r: 0 }],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, selectedHeroId: "h0" }),
  });

  const trails = nodesOfKind<HeroTrailNode>(nodes, "heroTrail");
  assert.equal(trails.length, 1);
  assert.equal(trails[0].points.length, 25);
  assert.deepEqual(trails[0].points[24], axialToPixel(0, 0), "the newest trail point (last entry) is kept");
  assert.deepEqual(trails[0].points[0], axialToPixel(-24, 0), "the oldest kept point is 25 back");
  assert.equal(hero.trail.length, 40, "the hero's own trail history is untouched");
});

test("caravan markers share the hero fog gate: hidden in fog, drawn in vision, own seat exempt", () => {
  const map = makeGrassMap(10, 1);
  const caravan = { q: 6, r: 0, ownerId: 1, wagons: 3 };
  const enemyHero = new Hero("h-foe", "Foe", 6, 0, "enemy", 1);

  const fogged = buildAdventureScene({
    map,
    heroes: [],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, caravans: [caravan] }),
  });
  assert.equal(nodesOfKind(fogged, "caravanMarker").length, 0, "no vision at all -> the enemy caravan is invisible");
  assert.equal(nodesOfKind<HeroNode>(fogged, "hero").length, 0, "same for the enemy hero on that tile");

  const seen = buildAdventureScene({
    map,
    heroes: [new Hero("h0", "Hero", 2, 0, "player", 0), enemyHero],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, caravans: [caravan] }),
  });
  assert.equal(nodesOfKind<CaravanMarkerNode>(seen, "caravanMarker").length, 1, "an own hero 4 tiles away brings the tile into vision");
  assert.equal(nodesOfKind<HeroNode>(seen, "hero").length, 2, "hero and caravan gates agree on the same tile");

  const own = buildAdventureScene({
    map,
    heroes: [],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0, caravans: [{ q: 6, r: 0, ownerId: 0, wagons: 3 }] }),
  });
  assert.equal(nodesOfKind(own, "caravanMarker").length, 1, "own caravan bypasses the fog set exactly like own heroes and castles");
});
