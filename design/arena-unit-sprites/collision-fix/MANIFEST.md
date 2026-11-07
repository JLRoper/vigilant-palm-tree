# Faction-collision wave 1 — the ashen grave hound and the crown warhound

Per-wave manifest for the four assets landed by
`analysis/2026-11-07-give-the-colliding-seat-factions-their-own-unit-art.md`
(the first of the 25 duplicate-byte sprite groups, ashen `grave_hound` =
human `warhound`). Fields follow `docs/asset-provenance.md` §"Metadata for
Future Art"; `unknown` is written where a value is not exposed.

## Final assets

| asset path | family key | sha256 | dimensions |
|---|---|---|---|
| `src/resources/units/arena/grave_hound-idle.png` | `unit.grave_hound.idle` (glob) | `5acafdd107c61eaa9f6d2e471370856a3ff1d3c419cb98d3b8373febf4e58e22` | 128×128 RGBA |
| `src/resources/units/arena/warhound-idle.png` | `unit.warhound.idle` (glob) | `400995e719afd321f14580cefd66df8b356288caa1daf642b830ccad06468563` | 128×128 RGBA |
| `src/resources/units/icons/grave_hound.png` | `unitImages.ts` KNOWN map | `4854d78cd14c380286f575635f18c8178a12f2c5cc87acce05fd654fa20696e8` | 128×128 RGBA |
| `src/resources/units/icons/warhound.png` | `unitImages.ts` KNOWN map | `411e85a84ae61b4cbb7a3122bec948867f5c44a695182ab20093b0a8fd321a3e` | 128×128 RGBA |

Replaced (the placeholder copies the 2026-10-22 roster expansion shipped):
`c79a9bc143f2a0531577e9476b0442cd04c054e445f887ab2cc24354ae7a017c` (both arena
idle files, one file twice) and
`5b39d394caaa60554030f9aadef1f4aa8c24756c50d3d8dbb004bdbb644fbeb0` (both icons,
one file twice).

## Generation

- Date: 2026-11-07.
- Provider: OpenRouter (`POST /api/v1/chat/completions`, `modalities: ["image","text"]`).
- Models: `google/gemini-2.5-flash-image`, `google/gemini-3-pro-image`,
  `google/gemini-3.1-flash-image` (and `google/gemini-nano-banana-2.1`, whose
  output is JPEG and was not used). All four **picked** assets are
  `google/gemini-3-pro-image`; the per-candidate verdicts are in the report's §4.
  Request/job IDs and seeds are **not exposed** by the API.
- Not usable on this date: `openai/gpt-5.4-image-2` and `openai/gpt-5-image-mini`
  (HTTP 502, `Complexity 'none' is not supported for this image model`),
  `openai/gpt-5-image` (HTTP 502, `The model gpt-image-1 has been deprecated`).

## Prompts

Committed, one per unit per surface; the exact text sent, no placeholders.

| prompt file | sha256 | used for |
|---|---|---|
| `design/arena-unit-sprites/prompts/collision-grave_hound-idle.txt` | `51aa3c44bcd7f62a2ff116f91174345e16f98d0e42d2a6ccf4d29bd7860429f7` | grave_hound idle (all candidates) |
| `design/arena-unit-sprites/prompts/collision-grave_hound-icon.txt` | `2ffa4288402d008a976ea84e00c842e3109fb59bc504c9fb6511a6952e047210` | grave_hound icon |
| `design/arena-unit-sprites/prompts/collision-warhound-idle.txt` | `2ef339e5414e5d2c75343e027f0254760d28df6e6b586ad28754ee37d1652ccd` | warhound idle |
| `design/arena-unit-sprites/prompts/collision-warhound-icon.txt` | `be8e8625e411790d85cfb7d59fb4e8cb915b707c495cf073f0d0862fd98a585a` | warhound icon |

## Reference images (the model received these)

| asset | reference (as it was at generation time) | sha256 | role |
|---|---|---|---|
| grave_hound idle | `src/resources/units/arena/bone_pikeman-idle.png` | `e5f60289e9b40a0d4a7dc53e42de379e2030689597808773c276fad03384d6cb` | Ashen Court pixel-art style/scale |
| grave_hound icon | `src/resources/units/icons/bone_pikeman.png` | `69b78afd281bf24c89a70f2eb75b7e03e04ee6e7ed3e4ff75364097cc97fdce0` | Ashen icon style |
| warhound idle | FIRST `src/resources/units/arena/warhound-attack.png`, SECOND `src/resources/units/arena/bone_pikeman-idle.png` | `4db011165320a0f68469b8f8a41639dd67683ffbce4fc9a9288b6efb91bcd76f`, `e5f60289e9b40a0d4a7dc53e42de379e2030689597808773c276fad03384d6cb` | the same hound's design, then style/scale |
| warhound icon | `src/resources/units/icons/warhound.png` | `5b39d394caaa60554030f9aadef1f4aa8c24756c50d3d8dbb004bdbb644fbeb0` — the **pre-change placeholder** this wave replaced (the path now holds `411e85a84ae61b4c…`) | icon style |

## Source masters

The raw model outputs (1024²) are **not committed**: they were written to a
session scratch directory, following the wave's own convention that
`design/arena-unit-sprites/*-1024/` masters are gitignored. Reproducibility
therefore rests on the committed prompt + model id + reference above, not on the
master. `google/gemini-nano-banana-2.1` returned JFIF/JPEG rather than PNG and its
output was discarded.

## Post-processing

One committed helper, deterministic, no network:
`design/arena-unit-sprites/collision-cut.mjs`
(sha256 `6073599b1a1a673907292f5a00656bba16d88834c27501e9ae8132fa91bbbc07`),
run under Node v24.18.0 with pngjs 7.0.0 and Playwright 1.61.1 (bundled Chromium):

```
node design/arena-unit-sprites/collision-cut.mjs <raw.png> <out.png> idle|icon
```

It (1) flood-fills the model's fake-transparency background from the border over
one uniform tone **or** a two-tone checkerboard plus a tight halo, (2) drops
detached floaters by connected component, (3) crops to the alpha bbox, (4) draws
the crop into the 128×128 canvas with high-quality smoothing (the same downscale
convention as `downscale-arena.mjs`) into a 120×94 box (`idle`, base on the last
row) or a 120×120 box (`icon`, centred), and (5) zeroes the 2px edge ring. No
outline pass, no padding pass, no colour edit.

## Acceptance

Measured by the helper's own report, then asserted by
`test/data/factionCombatUnitDifferentiation.test.ts`:

| check | grave_hound idle | warhound idle |
|---|---|---|
| dimensions | 128×128 | 128×128 |
| transparent rows under the feet | 0 | 0 |
| opaque content rows | 34–127 | 46–127 |
| content height | 94 / 128 (73%) | 82 / 128 (64%) |
| x extent | 13–114, centre 63.5 | 4–123, centre 63.5 |
| base band / widest row | 15/87 = **0.17** | 14/104 = **0.13** |
| opaque pixels in the 2px top/left/right ring | 0 | 0 |

The icons are centred busts at 120×120 in the 128 canvas, 2px ring clear.

Validation commands:

- `npx tsx --env-file=.env.test --test --test-concurrency=1 test/data/factionCombatUnitDifferentiation.test.ts` → 13/13 green.
- `test/data/unitIcons.coverage.test.ts`, `test/render/unitArenaDescriptors.test.ts`,
  `test/data/unitCatalogParity.test.ts` → green (filename convention, coverage,
  and the descriptor contract are unchanged by this wave).

## Attribution / licence

Raw output of the named OpenRouter-hosted models. No per-asset licence or
attribution restriction was supplied with the response; training-data provenance
is not exposed. Nothing was copied from third-party art.
