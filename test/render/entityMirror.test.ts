import { test } from "node:test";
import assert from "node:assert/strict";
import { EntityMirror } from "../../src/render/scene/entityMirror";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

test("bootstrap populates heroes and settlements from GameState", () => {
  const mirror = new EntityMirror();
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 5, 5)],
    settlements: [makeSettlement("s0", 0, 2, 2)],
  });
  mirror.bootstrap(state);

  assert.equal(mirror.getHeroes().length, 2);
  assert.equal(mirror.getSettlements().length, 1);
  const h0 = mirror.getHero("h0");
  assert.ok(h0);
  assert.deepEqual(h0!.tile, { q: 2, r: 2 });
  assert.equal(h0!.moving, false);
  assert.equal(mirror.getSettlement("s0")?.ownerId, 0);
  assert.equal(mirror.getHero("missing"), undefined);
});

test("bootstrap replaces prior mirror contents wholesale", () => {
  const mirror = new EntityMirror();
  mirror.bootstrap(makeState({ heroes: [makeHero("h0", 0, 2, 2)], settlements: [] }));
  mirror.bootstrap(makeState({ heroes: [makeHero("h1", 1, 9, 9)], settlements: [] }));

  assert.equal(mirror.getHero("h0"), undefined);
  assert.ok(mirror.getHero("h1"));
});

test("HeroMoved tweens from the mirror's own current tile (not the state's), and update() drives it to completion", () => {
  const mirror = new EntityMirror();
  mirror.bootstrap(makeState({ heroes: [makeHero("h0", 0, 2, 2)], settlements: [] }));

  const changed = mirror.applyEvent({ type: "HeroMoved", actor: 0, heroId: "h0", to: { q: 3, r: 2 } });
  assert.equal(changed, true);

  const hero = mirror.getHero("h0")!;
  assert.equal(hero.moving, true);
  assert.deepEqual(hero.fromTile, { q: 2, r: 2 });
  assert.deepEqual(hero.toTile, { q: 3, r: 2 });

  const stillMovingAfterShortTick = mirror.update(50);
  assert.equal(stillMovingAfterShortTick, true, "default moveDurationMs is 220ms, so 50ms shouldn't finish the tween");
  assert.equal(hero.moving, true);

  const stillMovingAfterLongTick = mirror.update(1000);
  assert.equal(stillMovingAfterLongTick, false);
  assert.equal(hero.moving, false);
  assert.deepEqual(hero.tile, { q: 3, r: 2 });
});

test("HeroMoved is a no-op for an unknown hero or a move to the hero's current tile", () => {
  const mirror = new EntityMirror();
  mirror.bootstrap(makeState({ heroes: [makeHero("h0", 0, 2, 2)], settlements: [] }));

  assert.equal(mirror.applyEvent({ type: "HeroMoved", actor: 0, heroId: "ghost", to: { q: 9, r: 9 } }), false);
  assert.equal(mirror.applyEvent({ type: "HeroMoved", actor: 0, heroId: "h0", to: { q: 2, r: 2 } }), false);
  assert.equal(mirror.getHero("h0")!.moving, false);
});

test("SettlementCaptured updates ownerId to the capturing actor, and is a no-op for an unknown settlement or an unchanged owner", () => {
  const mirror = new EntityMirror();
  mirror.bootstrap(makeState({ heroes: [], settlements: [makeSettlement("s0", 1, 2, 2)] }));

  assert.equal(
    mirror.applyEvent({ type: "SettlementCaptured", actor: 0, heroId: "h0", settlementId: "s0", previousOwnerId: 1 }),
    true,
  );
  assert.equal(mirror.getSettlement("s0")!.ownerId, 0);

  assert.equal(
    mirror.applyEvent({ type: "SettlementCaptured", actor: 0, heroId: "h0", settlementId: "s0", previousOwnerId: 0 }),
    false,
    "already owned by the actor -- no-op",
  );
  assert.equal(
    mirror.applyEvent({ type: "SettlementCaptured", actor: 5, heroId: "h0", settlementId: "ghost", previousOwnerId: null }),
    false,
  );
});

test("unhandled event types are no-ops, not errors", () => {
  const mirror = new EntityMirror();
  mirror.bootstrap(makeState({ heroes: [makeHero("h0", 0, 2, 2)], settlements: [] }));

  assert.equal(
    mirror.applyEvent({ type: "TurnEnded", actor: 0, round: 2, day: 2, activePlayerId: 1, wrapped: false }),
    false,
  );
  assert.deepEqual(mirror.getHero("h0")!.tile, { q: 2, r: 2 });
});

test("update() returns false once nothing is animating, including with an empty mirror", () => {
  const mirror = new EntityMirror();
  assert.equal(mirror.update(16), false);

  mirror.bootstrap(makeState({ heroes: [makeHero("h0", 0, 2, 2)], settlements: [] }));
  assert.equal(mirror.update(16), false, "no HeroMoved applied yet -- nothing should be moving");
});
