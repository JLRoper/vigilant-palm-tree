import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStateManager } from "../../src/managers/GameStateManager";
import { GameMap } from "../../src/map/gameMap";
import { makeHero, makeState } from "../charter/_helpers";
import type { GameState } from "@heroes/contracts";

const HERO_ID = "h0";

function stateWithHeroAt(q: number, r: number): GameState {
  return makeState({ heroes: [makeHero(HERO_ID, 0, q, r)] });
}

function managerWith(state: GameState): GameStateManager {
  const manager = new GameStateManager();
  manager.setGameMap(new GameMap(7, "small"));
  manager.setState(state);
  manager.rebuildHeroesFromState();
  return manager;
}

test("rebuildHeroesFromState keeps an in-flight tween alive across a state replacement", () => {
  const manager = managerWith(stateWithHeroAt(0, 0));
  const hero = manager.getHero(HERO_ID);
  assert.ok(hero, "fixture hero exists");
  hero.startMoveToPath([{ q: 0, r: 0 }, { q: 1, r: 0 }]);
  assert.equal(hero.moving, true);

  manager.replaceState(stateWithHeroAt(1, 0));
  manager.rebuildHeroesFromState();

  const after = manager.getHero(HERO_ID);
  assert.ok(after);
  assert.equal(after.moving, true, "a mid-walk state replacement must not snap the tweening hero");
  assert.equal(manager.getHeroes().length, 1, "the hero stays in the rebuilt roster");
});

test("update reconciles a hero against the state the moment its tween finishes", () => {
  const manager = managerWith(stateWithHeroAt(0, 0));
  const hero = manager.getHero(HERO_ID);
  assert.ok(hero);
  hero.startMoveToPath([{ q: 0, r: 0 }, { q: 1, r: 0 }]);
  manager.replaceState(stateWithHeroAt(1, 0));
  manager.rebuildHeroesFromState();

  const changed = manager.update(10_000);

  assert.equal(changed, true, "a finished tween reconciles even though the controller state did not change");
  assert.equal(hero.moving, false);
  assert.deepEqual({ q: hero.tile.q, r: hero.tile.r }, { q: 1, r: 0 });
  assert.deepEqual({ q: hero.fromTile.q, r: hero.fromTile.r }, { q: 1, r: 0 });
});

test("rebuildHeroesFromState still snaps an idle hero to the state position", () => {
  const manager = managerWith(stateWithHeroAt(0, 0));
  const hero = manager.getHero(HERO_ID);
  assert.ok(hero);
  assert.equal(hero.moving, false);

  manager.replaceState(stateWithHeroAt(4, 3));
  manager.rebuildHeroesFromState();

  assert.deepEqual({ q: hero.tile.q, r: hero.tile.r }, { q: 4, r: 3 });
  assert.equal(hero.moving, false);
});