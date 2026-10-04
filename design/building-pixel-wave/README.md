# Building Pixel Art Wave — 2026-10-04 (all 44 sprites: DONE, UNWIRED)

This wave generated the sprite art prerequisite for
[`.plans/20261004-0627_remove-city-building-styles_UNCLAIMED.md`](../../.plans/20261004-0627_remove-city-building-styles_UNCLAIMED.md)
(removal of the city view's 5-style procedural building system). **Read that plan first** — this
file is the Wave 0 completion record and the wiring recipe.

**Status: every file below exists in `src/resources/buildings/`, passed
`remove-specks.mjs` + `repair-alpha.mjs --check` (0 defects) and visual inspection.
WIRED 2026-10-04 (same day): all of it is now registered in `src/render/assetDescriptors.ts` —
44 sprite keys (`pixel.<kind>.<level>`) + the 3 `pixel.mine.*` stoneMine aliases (plan §D-mine),
each with a measured `BUILDING_ANCHOR_OVERRIDES` row. `npm run build` green after wiring
(tsc + vite, 689 modules). Wiring is render-inert by design: the engine's
`BUILDING_SPRITE_KEYS` list / style routing still routes these kinds to classic/procedural until
the removal plan's Wave 1 flips resolution — so no baseline changed.

## Generated this wave (44 new PNGs — none referenced by code yet)

Key format once wired: `pixel.<kind>.<level>` → sprite key `building.pixel.<kind>.<level>`.

| Kind | New files | Notes from visual pass |
|---|---|---|
| townHall | `building-pixel-townHall-{1,2,3}.png` | clean; L3 = stone keep, corner turret, brass bell cote |
| house | `building-pixel-house-{1,2,3}.png` | clean; house-2 needed a regen (one billed no-image model flake) |
| tower | `building-pixel-tower-{1,2,3}.png` | tower-2/3 regen'd once for baked checkerboard; **tower-1 regenerated a third time** (v2 prompt, baked slab reached the bottom edge) — final: padRows 132 → offsetY 11 |
| mageGuild | `building-pixel-mageGuild-{1,2,3}.png` | clean; mageGuild-1 regen'd once |
| market | `building-pixel-market-{1,2,3}.png` | clean, first pass |
| barracks | `building-pixel-barracks-{1,2,3}.png` | clean, first pass |
| smithy | `building-pixel-smithy-{1}.png`, `building-pixel-smithy-{3}.png` | clean (smithy-2 already existed pre-wave) |
| apartment | `building-pixel-apartment-{1,2,3}.png` | clean, first pass |
| farmhouse | `building-pixel-farmhouse-{1,2,3}.png` | clean; farmhouse-2/3 regen'd once |
| archeryRange | `building-pixel-archeryRange-{1,2,3}.png` | clean; archeryRange-1 regen'd once (trapped white bg in shelter gaps) |
| stables | `building-pixel-stables-{1,2,3}.png` | clean; **stables-2 regenerated a third time** with the fixed prompt phrasing (see below) — final pass fully clean |
| huntingLodge | `building-pixel-huntingLodge-{1,2,3}.png` | clean, first pass |
| eyrie | `building-pixel-eyrie-{1,2,3}.png` | clean; eyrie-1/eyrie-3 regen'd once |
| arcaneFont | `building-pixel-arcaneFont-{1,2,3}.png` | clean; caveat: arcaneFont-3 reads as a grand single basin + orb + orbiting runes rather than literally three tiers (best of two attempts) |
| crypt | `building-pixel-crypt-2.png` | clean; closes the live L2 blank-tile hole. Minor: fence prop rendered wooden, not iron |
| gunnersRedoubt | `building-pixel-gunnersRedoubt-2.png` | clean; closes the live L2 blank-tile hole |
| worldrootGrove | `building-pixel-worldrootGrove-2.png` | clean; closes the live L2 blank-tile hole |

Prompt sources are preserved in `design/building-pixel-wave/prompts/*.txt` (one per sprite, plus
`building-pixel-stables-2-v3.txt` — the fixed-phrasing retry).

**Cost:** ~63 billed generations total (44 planned + retries incl. the tower-1 and stables-2
re-fixes + 1 billed no-image flake).

## Critical prompt knowledge for any future sprite wave

The template's "same transparent background" clause makes Gemini bake a literal gray/white
checkerboard into the pixels, which `strip-checkerboard.mjs` often cannot fully clean (enclosed
clusters are unreachable by border flood-fill; a pure-white checker sits outside its tolerances and
`remove-specks.mjs` skips squares >600 px). Working fix, verified repeatedly this wave:

- Replace the background clause with:
  `plain uniform solid light-gray background with absolutely no checkerboard pattern anywhere`
- Append to the final line: `no checkerboard pattern anywhere on the canvas`
- If remnants still appear: re-run `strip-checkerboard.mjs` manually once before spending a retry.

## Wiring — DONE (2026-10-04, same day as generation)

Landed in `src/render/assetDescriptors.ts`:

1. 47 `?url` imports + `BUILDING_SPRITES` keys: all 44 `pixel.<kind>.<level>` keys
   (`pixel.smithy.2` was already wired pre-wave and was NOT duplicated) + 3 safety aliases
   `pixel.mine.1/2/3` → the `stoneMine` art (plan §D-mine, for legacy saves holding the
   non-buildable generic `mine` kind).
2. 48 measured `BUILDING_ANCHOR_OVERRIDES` rows (mine rows copy stoneMine's 12/5/13). All values
   measured per-PNG via `local/measure-building-bottom-pad.mjs` (Playwright canvas, alpha>10,
   `offsetY = round(padRows × 86.4 / 1024)`), method validated against granary-1 (11), crypt-1
   (11), worldrootGrove-3 (0, clipped-bottom) before the sweep.
3. Descriptor defaults (`anchor:"bottom"`, `anchorOffsetY:-12`, `fitWidth 0.9`) come from the
   `BUILDING_DESCRIPTORS` generator — no per-entry descriptor objects.
4. NOT touched by design (Wave 1 of the removal plan owns them): the engine `BUILDING_SPRITE_KEYS`
   list, the `classic.*`/`blocky.*` entries, `pickStyleForBuilding`, and all style routing —
   so this wiring alone changes no rendered pixel (verified: build green, fall-through semantics
   unchanged).

Original wiring recipe (kept for reference):

Follow the existing `pixel.*` precedent in `src/render/assetDescriptors.ts`:

1. Add `?url` imports for all 44 files and entries in `BUILDING_SPRITES`:
   `"pixel.<kind>.<level>": buildingPixel<Kind><Level>` (camelCase names exactly as on disk:
   `townHall`, `mageGuild`, `archeryRange`, `huntingLodge`, `gunnersRedoubt`, `worldrootGrove`, …).
2. For each new key add a **measured** row in `BUILDING_ANCHOR_OVERRIDES`:
   `offsetY = transparentBottomPadRows × 86.4 / 1024` — measure each PNG's transparent bottom-pad
   row count (formula rationale at `assetDescriptors.ts:806-823`; do NOT reuse another sprite's
   number, every measured value this repo uses was per-PNG).
3. Descriptor defaults (`anchor:"bottom"`, `anchorOffsetY:-12`, `fitWidth 0.9`) come from the
   `BUILDING_DESCRIPTORS` generator — no per-entry descriptor objects needed.
4. Per the removal plan this wave does NOT add `pixel-alt` anything, does not touch the
   `classic.*`/`blocky.*` entries (they die with Wave 1 of the plan), and separately adds a
   `mine` → `stoneMine` art alias for legacy saves (see plan §D-mine).

## Wave provenance

Generated 2026-10-04 by 8 parallel subagent batches over
`.kilo/skills/building-sprite-gen/scripts/gemini-buildings.mjs` (Gemini via OpenRouter), default
style reference `building-pixel-granary-1.png`; each kind's L2/L3 used its own L1 as `--ref` for
tier coherence; the three L2-hole sprites used their kind's L1. All post-passes (strip, repair,
specks) ran per the skill; the tree's other files were untouched throughout (a sibling session was
live).
