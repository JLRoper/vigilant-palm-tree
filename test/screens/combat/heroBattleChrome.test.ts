import { test } from "node:test";
import assert from "node:assert/strict";
import { heroBattleArenaChrome, heroBattleSideLabel } from "../../../src/screens/combat/arena/heroBattleChrome";

// The chrome a real hero battle hands the manual arena (playthrough round 4,
// F5). The arena's top bar and its player rail read these, so they are the one
// place that decides what a hero battle calls itself.

test("heroBattleArenaChrome names both heroes, and never the dev sandbox", () => {
  const chrome = heroBattleArenaChrome(
    { id: "p1-hero", name: "Alaric Ironheart" },
    { id: "p0-hero", name: "Lyra Stormwind" },
  );
  assert.equal(chrome.title, "Hero battle — Alaric Ironheart vs Lyra Stormwind");
  assert.equal(chrome.attackerLabel, "Hero Alaric Ironheart");
  assert.equal(chrome.defenderLabel, "Hero Lyra Stormwind");
  assert.ok(
    !chrome.title.includes("Test Battle") && !chrome.title.includes("Manual Fight"),
    "the dev sandbox's title is the sandbox's own",
  );
});

test("a hero with no name falls back to its id, and the blank case is not an empty title", () => {
  assert.equal(heroBattleSideLabel({ id: "p0-hero" }), "Hero p0-hero");
  assert.equal(heroBattleSideLabel({ id: "p0-hero", name: "   " }), "Hero p0-hero");
  assert.equal(heroBattleSideLabel({ id: "p0-hero", name: null }), "Hero p0-hero");
  const chrome = heroBattleArenaChrome({ id: "p1-hero", name: "  " }, { id: "p0-hero" });
  assert.equal(chrome.title, "Hero battle — p1-hero vs p0-hero");
});
