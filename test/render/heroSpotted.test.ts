import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heroFadeAlpha,
  observeHeroSightings,
  pruneHeroSightings,
  resetHeroSpotted,
} from "../../src/render/heroSpotted";

test("a hero first seen within the scene-load grace window never fades", () => {
  resetHeroSpotted();
  observeHeroSightings(["h0"], 0);
  assert.equal(heroFadeAlpha("h0", 0), 1, "the very first frame establishes boot; nothing animates");
  assert.equal(heroFadeAlpha("h0", 150), 1);
  assert.equal(heroFadeAlpha("h0", 500), 1, "still inside the 1000ms grace window");
  assert.equal(heroFadeAlpha("h0", 1000), 1);
  assert.equal(heroFadeAlpha("h0", 100000), 1, "a grace-window sighting stays at full alpha for the rest of the scene");
});

test("a hero first seen after the grace window fades in from FADE_MIN_ALPHA over FADE_MS", () => {
  resetHeroSpotted();
  observeHeroSightings([], 0);
  observeHeroSightings(["h1"], 5000);
  assert.equal(heroFadeAlpha("h1", 5000), 0.25, "no time has elapsed yet");
  assert.equal(heroFadeAlpha("h1", 5150), 0.625, "halfway through the fade");
  assert.equal(heroFadeAlpha("h1", 5300), 1, "exactly FADE_MS after the sighting");
  assert.equal(heroFadeAlpha("h1", 6000), 1, "clamped, never overshoots");
});

test("an unobserved hero is fully opaque", () => {
  resetHeroSpotted();
  observeHeroSightings(["h0"], 0);
  assert.equal(heroFadeAlpha("h-never-seen", 99999), 1);
});

test("pruneHeroSightings drops ids outside the live set, so a returning hero re-fades", () => {
  resetHeroSpotted();
  observeHeroSightings([], 0);
  observeHeroSightings(["h1"], 5000);
  assert.equal(heroFadeAlpha("h1", 5200), 0.75, "the 300ms fade is most of the way through");
  assert.equal(heroFadeAlpha("h1", 5400), 1, "past the fade, fully opaque");

  pruneHeroSightings(new Set(["h-other"]));
  assert.equal(heroFadeAlpha("h1", 5400), 1, "a forgotten id reads as unobserved");

  observeHeroSightings(["h1"], 9000);
  assert.equal(heroFadeAlpha("h1", 9000), 0.25, "coming back after a prune counts as a fresh sighting");
});

test("pruneHeroSightings keeps ids that are still live", () => {
  resetHeroSpotted();
  observeHeroSightings([], 0);
  observeHeroSightings(["h1", "h2"], 5000);
  pruneHeroSightings(new Set(["h1"]));
  assert.equal(heroFadeAlpha("h2", 5000), 1, "a pruned id would otherwise stick at its old sighting time");
  assert.equal(heroFadeAlpha("h1", 5300), 1);
});

test("resetHeroSpotted clears both the sightings and the boot stamp", () => {
  resetHeroSpotted();
  observeHeroSightings([], 0);
  observeHeroSightings(["h1"], 5000);
  assert.equal(heroFadeAlpha("h1", 5000), 0.25);

  resetHeroSpotted();
  assert.equal(heroFadeAlpha("h1", 5000), 1, "forgotten after a reset");

  observeHeroSightings(["h2"], 7000);
  assert.equal(heroFadeAlpha("h2", 7000), 1, "the first sighting after a reset re-establishes boot, so it is a grace-window sighting");
  observeHeroSightings(["h3"], 9000);
  assert.equal(heroFadeAlpha("h3", 9000), 0.25, "boot is 7000 now, so 2000ms later is past the grace window");
});
