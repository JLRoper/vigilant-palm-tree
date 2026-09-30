# Hero panel army icons — plan

**Status:** Executed 2026-09-29/30 (commit `c0778d2`): all 12 catalog ids wired via `unitImages.ts`'s `KNOWN` map to the icons in `src/resources/units/icons/`; coverage tests added (and `test/data/` joined the `test:unit` glob). The legacy placeholder PNGs remain on disk unreferenced — their retirement/overwrite is still awaiting a user nod. Sister plan to [2026-09-29-arena-unit-sprites.md](./2026-09-29-arena-unit-sprites.md) — same Style B unit identity, different render surface (DOM `<img>`, not canvas). Written 2026-09-29.

## Problem

The Hero Info panel's Army section (and every other `getUnitImageUrl` consumer) shows unit art that is either a wired googly-eye placeholder (`swordsman/archer/cavalry.png`) or the generic fallback placeholder for the other 9 unit types. The user wants real per-unit icon art for the square army-grid tiles.

## Current state (verified 2026-09-29)

- `src/screens/heroes/armySection.ts` renders **8 square tiles** (4-col grid, `aspectRatio: 1`, `borderRadius: 4`, dark tile bg `rgba(0,0,0,0.35)`, thin border) with `objectFit: contain` images. Each tile shows the platoon's **primary (first) entry's** unit image + a total-count badge (bottom-right) + a `+N` badge when the platoon mixes unit types — the "primary unit" rule already exists DOM-side, mirroring the arena's dominant-unit decision.
- Tile render size ≈ **55–65 CSS px** (panel-width dependent). 128 px natural assets are crisp at 2× DPR.
- Image source: `src/data/unitImages.ts` → `getUnitImageUrl(unitTypeId)` over a `KNOWN` map (3 wired ids) with `placeholder.png` fallback. Consumers: `armySection.ts`, `settlementInfoMenu.ts`, `cityView/buildingMenu.ts` — wiring all 12 icons lights up **three surfaces at once**, not just the hero panel.

## Decisions (2026-09-29, user-confirmed via Q&A)

1. **Format:** bust portrait (head-and-shoulders, cropped mid-chest, ~80% canvas fill) — reads at ~60 px where a full body would not.
2. **Art:** fresh set of 12 in the **Style B dramatic-miniature language** (same family as the arena set; not crops of the arena art).
3. **Delivery:** `src/resources/units/icons/<unitTypeId>.png` (new folder, no overwrite of the 3 wired legacy placeholders). Nothing on screen changes until wiring.

## Asset contract

- **Files:** `src/resources/units/icons/<unitTypeId>.png` — 128×128, transparent background, no baked frame (the tile supplies bg + border; a baked frame would double-frame).
- All 12 catalog ids covered: `peasant, archer, crossbowman, swordsman, pikeman, cavalry, monk, crusader, griffin, hydra, wisp, black_dragon`.
- 1024 px masters + per-unit prompts preserved under `design/arena-unit-sprites/icon-1024/` and `prompts/icon-*.txt`; review contact sheet at true tile size (60 px on the tile dark) at `design/arena-unit-sprites/icon-contact-sheet.png`.

## Wiring (deferred with the arena work — the only code touch)

- `unitImages.ts`: extend `KNOWN` with 12 imports from `../resources/units/icons/<id>.png` (or repoint the map at the icons folder wholesale). Tiny, additive, single file.
- Effect: hero panel army grid + settlement info menu + building menu all switch from placeholder to real art simultaneously — a visible UI change, so it should ride the same "wiring wave" as the arena descriptor work once the concurrent agent's changes land.
- **Leftover cleanup question for wiring time (needs user nod, it replaces existing image files):** retire or overwrite the legacy wired placeholders `src/resources/units/{swordsman,archer,cavalry}.png` and `placeholder.png` once the KNOWN map no longer references them (keep `placeholder.png` as the catalog-miss fallback).
- Optional guard: a unit test asserting every unit-catalog id has a file in `src/resources/units/icons/` so future catalog additions can't ship icon-less (mirrors the arena descriptor-coverage test idea).

## Production notes (carried from the arena run)

- Same Gemini/OpenRouter pipeline (`building-sprite-gen` scripts), ~12–14 billed calls, enclosed-background pockets cleaned per-region, anti-building clause on creature prompts.
- Consistency: identical STYLE/composition paragraphs across all 12; only the Subject paragraph varies — keep that discipline for any future icon wave (e.g. higher-tier variants).

## Out of scope (this pass)

- Any code change (wiring, KNOWN map, tests) — queued behind the concurrent agent's in-flight work.
- Overwriting the 3 legacy placeholder PNGs.
- City-view / arena consumption of these icons (the arena uses its own full-body set; the city building menu inherits these via `getUnitImageUrl` at wiring time).
