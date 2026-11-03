import { test } from "node:test";
import assert from "node:assert/strict";
import { FACTION_REGISTRY, SEAT_FACTION_IDS, aiSeatFactions } from "@heroes/engine";

test("SEAT_FACTION_IDS is every registry faction with a shipped roster, minus neutral", () => {
  assert.deepEqual(
    [...SEAT_FACTION_IDS].sort(),
    ["ashen", "human", "ironmark", "verdant"],
    "neutral (catalog-only wild creatures) is not a seat",
  );
  for (const id of SEAT_FACTION_IDS) {
    assert.ok(FACTION_REGISTRY[id].roster.length > 0, `${id} carries a roster`);
  }
});

test("aiSeatFactions is deterministic: one seed, one assignment", () => {
  assert.deepEqual(aiSeatFactions(4242, 3), aiSeatFactions(4242, 3));
  assert.deepEqual(aiSeatFactions(0, 2), aiSeatFactions(0, 2));
});

test("aiSeatFactions never repeats a faction within one game and never returns neutral", () => {
  for (let seed = 0; seed < 500; seed++) {
    const draw = aiSeatFactions(seed, SEAT_FACTION_IDS.length);
    assert.equal(new Set(draw).size, draw.length, `seed ${seed}: ${draw.join(",")} repeats a faction`);
    for (const faction of draw) {
      assert.ok(SEAT_FACTION_IDS.includes(faction), `seed ${seed}: ${faction} is not a seat faction`);
    }
  }
});

test("aiSeatFactions is VARIED: a two-AI-seat game always meets a non-human faction", () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 500; seed++) {
    const draw = aiSeatFactions(seed, 2);
    draw.forEach((f) => seen.add(f));
    assert.ok(
      draw.some((f) => f !== "human"),
      `seed ${seed}: ${draw.join(",")} pins a default single-player game to the Crownlands`,
    );
  }
  assert.deepEqual([...seen].sort(), ["ashen", "human", "ironmark", "verdant"]);
});

test("aiSeatFactions wraps rather than dropping a seat when there are more seats than factions", () => {
  const draw = aiSeatFactions(7, SEAT_FACTION_IDS.length + 2);
  assert.equal(draw.length, SEAT_FACTION_IDS.length + 2);
  for (const faction of draw) assert.ok(faction, "no seat is left unassigned");
});

test("aiSeatFactions draws no value for a seat count of zero and clamps junk counts", () => {
  assert.deepEqual(aiSeatFactions(1, 0), []);
  assert.deepEqual(aiSeatFactions(1, -4), []);
  assert.deepEqual(aiSeatFactions(1, 1.9), aiSeatFactions(1, 1));
});
