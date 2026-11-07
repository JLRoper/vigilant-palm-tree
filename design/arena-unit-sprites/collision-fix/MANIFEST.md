# Faction-collision manifests

Per-wave provenance for the assets landed by the sprite-collision waves. Fields
follow `docs/asset-provenance.md` §"Metadata for Future Art"; `unknown` is written
where a value is not exposed. One H2 per wave; the newest wave is last.

---

## Wave 1 — the ashen grave hound and the crown warhound

Per-wave manifest for the four assets landed by
`analysis/2026-11-07-give-the-colliding-seat-factions-their-own-unit-art.md`
(the first of the 25 duplicate-byte sprite groups, ashen `grave_hound` =
human `warhound`).

### Final assets

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

### Generation

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

### Prompts

Committed, one per unit per surface; the exact text sent, no placeholders.

| prompt file | sha256 | used for |
|---|---|---|
| `design/arena-unit-sprites/prompts/collision-grave_hound-idle.txt` | `51aa3c44bcd7f62a2ff116f91174345e16f98d0e42d2a6ccf4d29bd7860429f7` | grave_hound idle (all candidates) |
| `design/arena-unit-sprites/prompts/collision-grave_hound-icon.txt` | `2ffa4288402d008a976ea84e00c842e3109fb59bc504c9fb6511a6952e047210` | grave_hound icon |
| `design/arena-unit-sprites/prompts/collision-warhound-idle.txt` | `2ef339e5414e5d2c75343e027f0254760d28df6e6b586ad28754ee37d1652ccd` | warhound idle |
| `design/arena-unit-sprites/prompts/collision-warhound-icon.txt` | `be8e8625e411790d85cfb7d59fb4e8cb915b707c495cf073f0d0862fd98a585a` | warhound icon |

### Reference images (the model received these)

| asset | reference (as it was at generation time) | sha256 | role |
|---|---|---|---|
| grave_hound idle | `src/resources/units/arena/bone_pikeman-idle.png` | `e5f60289e9b40a0d4a7dc53e42de379e2030689597808773c276fad03384d6cb` | Ashen Court pixel-art style/scale |
| grave_hound icon | `src/resources/units/icons/bone_pikeman.png` | `69b78afd281bf24c89a70f2eb75b7e03e04ee6e7ed3e4ff75364097cc97fdce0` | Ashen icon style |
| warhound idle | FIRST `src/resources/units/arena/warhound-attack.png`, SECOND `src/resources/units/arena/bone_pikeman-idle.png` | `4db011165320a0f68469b8f8a41639dd67683ffbce4fc9a9288b6efb91bcd76f`, `e5f60289e9b40a0d4a7dc53e42de379e2030689597808773c276fad03384d6cb` | the same hound's design, then style/scale |
| warhound icon | `src/resources/units/icons/warhound.png` | `5b39d394caaa60554030f9aadef1f4aa8c24756c50d3d8dbb004bdbb644fbeb0` — the **pre-change placeholder** this wave replaced (the path now holds `411e85a84ae61b4c…`) | icon style |

### Source masters

The raw model outputs (1024²) are **not committed**: they were written to a
session scratch directory, following the wave's own convention that
`design/arena-unit-sprites/*-1024/` masters are gitignored. Reproducibility
therefore rests on the committed prompt + model id + reference above, not on the
master. `google/gemini-nano-banana-2.1` returned JFIF/JPEG rather than PNG and its
output was discarded.

### Post-processing

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

### Acceptance

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

### Attribution / licence

Raw output of the named OpenRouter-hosted models. No per-asset licence or
attribution restriction was supplied with the response; training-data provenance
is not exposed. Nothing was copied from third-party art.

---

## Wave 2 — the verdant druid and the ironmark hearth priest

Per-wave manifest for the four assets landed by
`analysis/2026-11-07-collision-art-wave-2-the-druid-and-the-hearth-priest.md`:
the arena group `druid = hearth_priest = runesmith` and the icon groups
`druid = mage` and `hearth_priest = runesmith` — three of the wave-1 audit's
REMAINING rows (R1, R2 and R13), closed with four PNGs.

The two units re-authored are the placeholder COPIERS of that cluster; the
originals keep their art (`roster-parity-placeholder-art.md`): druid icon
← mage, druid arena idle ← runesmith, hearth_priest icon and arena idle
← runesmith.

### Final assets

| asset path | family key | sha256 | dimensions |
|---|---|---|---|
| `src/resources/units/arena/druid-idle.png` | `unit.druid.idle` (glob) | `01a3b2ca734ece48b7fc1ae02bb990dbfd1aa952a260e2460d889d42df2e6b4c` | 128×128 RGBA |
| `src/resources/units/arena/hearth_priest-idle.png` | `unit.hearth_priest.idle` (glob) | `f94923ad954660455c2821e2c88496cbdaf4b87b2cf98e348a7e36896c31e712` | 128×128 RGBA |
| `src/resources/units/icons/druid.png` | `unitImages.ts` KNOWN map | `9da1e5819f68e457813ed4d1cbd2af687f2f2d0506d48c2af7d4410498ea5959` | 128×128 RGBA |
| `src/resources/units/icons/hearth_priest.png` | `unitImages.ts` KNOWN map | `4bb03527833d8af8eb486ad0f8f43f3d1d84dab1de1f073968f586237b5e942a` | 128×128 RGBA |

Replaced (the placeholder copies the 2026-10-22 roster expansion shipped), all
still on disk unchanged after the copy:

| replaced path | sha256 (before) | it was a copy of |
|---|---|---|
| `src/resources/units/arena/druid-idle.png` | `3ce3a525c4fb8e5e20c364b908b79e8d200208d4bc42241c30cff0f5c04b0135` | `arena/runesmith-idle.png` (identical) |
| `src/resources/units/arena/hearth_priest-idle.png` | `3ce3a525c4fb8e5e20c364b908b79e8d200208d4bc42241c30cff0f5c04b0135` | `arena/runesmith-idle.png` (identical) |
| `src/resources/units/icons/druid.png` | `412aa097fb33832c871c82cee1c1a22fbf6c0fcd804826fff3cc2e2009e26e27` | `icons/mage.png` (identical) |
| `src/resources/units/icons/hearth_priest.png` | `bd86dad2c2e32aa80864f732010dd9d8157d1af54827b5cd49ee4844b6a2becd` | `icons/runesmith.png` (identical) |

The originals are therefore the before-images: `arena/runesmith-idle.png`
`3ce3a525…`, `icons/runesmith.png` `bd86dad2…`, `icons/mage.png` `412aa097…`.

### Generation

- Date: 2026-11-07.
- Provider: OpenRouter (`POST /api/v1/chat/completions`, `modalities: ["image","text"]`).
- Models: `google/gemini-2.5-flash-image`, `google/gemini-3-pro-image`,
  `google/gemini-3.1-flash-image` (and one probe at `openai/gpt-5.4-image-2`).
  Three picks are `google/gemini-3-pro-image`; the **druid arena idle pick is
  `google/gemini-2.5-flash-image`** — on a robed upright figure the pro model's
  extra internal detail bought a thinner silhouette that read worse at the drawn
  size. Per-candidate verdicts are in the report's §3. Request/job IDs and seeds
  are **not exposed** by the API.
- Not usable on this date: `openai/gpt-5.4-image-2` returned HTTP 502
  `Complexity 'none' is not supported for this image model` on the druid icon
  prompt — the same provider failure wave 1 recorded on three OpenAI ids.

### Prompts

Committed, one per unit per surface; the exact text sent, no placeholders.
Both hashes are given because `core.autocrlf=true` makes the on-disk sha256
line-ending dependent: the sha256 is of the file as written (and as such is the
committed blob), the git blob hash is what the repository holds either way.

| prompt file | sha256 (as written) | git blob | used for |
|---|---|---|---|
| `design/arena-unit-sprites/prompts/collision-druid-idle.txt` | `4a979ed93a18fb951cd62d3bacff36165d92b59b7a6a89748dfa9d43ebe6e118` | `ffbeb826d8fc086e40b443e4a4757cc487f3bd88` | druid idle (all candidates) |
| `design/arena-unit-sprites/prompts/collision-druid-icon.txt` | `1054afdd2902bafe3c8f8b5c99b35f38832e7bdcda68b54096861f02735dfd23` | `5eeadb68372179a8ffa09aeab47876c63106f80e` | druid icon (and the OpenAI probe) |
| `design/arena-unit-sprites/prompts/collision-hearth_priest-idle.txt` | `4b83eb684853a98feacb405d56f09b8e54b686b8cb5e2db1ae83f77e0850893e` | `0d1d50ae13bd8729ab33ca670cc39d0d25062e1c` | hearth_priest idle |
| `design/arena-unit-sprites/prompts/collision-hearth_priest-icon.txt` | `c657bc99095f94b7e5d685858ee096e6f28b0cdc2097e7f0c33266d75b1ae39f` | `aaa588f1e6f9f50d6d11ae39c6f555ef17a7b191` | hearth_priest icon |

Each prompt names its references positionally ("the FIRST attached image", "the
SECOND attached image") because two are attached; see below.

### Reference images (the model received these)

| asset | reference (as it was at generation time) | sha256 | role |
|---|---|---|---|
| druid idle | FIRST `src/resources/units/arena/druid-idle.png` (the placeholder being replaced), SECOND `src/resources/units/arena/forest_scout-idle.png` | `3ce3a525c4fb8e5e20c364b908b79e8d200208d4bc42241c30cff0f5c04b0135`, `b1525749c0d16d9efc9f43abbfc51e5ffd740e06645c01eaf63cdd45bc802bb0` | pixel size / outline weight / canvas framing, then Verdant Wild palette and rendering (NOT the subject) |
| druid icon | FIRST `src/resources/units/icons/druid.png` (the placeholder being replaced), SECOND `src/resources/units/icons/forest_scout.png` | `412aa097fb33832c871c82cee1c1a22fbf6c0fcd804826fff3cc2e2009e26e27`, `e264ed9ebfad90b9b59207741f2061bf55e174d41aefc0b4b7c42a57c6bfe378` | bust framing, then Verdant icon style |
| hearth_priest idle | FIRST `src/resources/units/arena/hearth_priest-idle.png` (the placeholder being replaced), SECOND `src/resources/units/arena/shield_bearer-idle.png` | `3ce3a525c4fb8e5e20c364b908b79e8d200208d4bc42241c30cff0f5c04b0135`, `d82f7bdc432962a3d2b8be4a9ce9a40ba042641c153187f08f13712b9d628711` | pixel size / outline weight / canvas framing, then Ironmark palette and rendering |
| hearth_priest icon | FIRST `src/resources/units/icons/hearth_priest.png` (the placeholder being replaced), SECOND `src/resources/units/icons/shield_bearer.png` | `bd86dad2c2e32aa80864f732010dd9d8157d1af54827b5cd49ee4844b6a2becd`, `5534c0994244fb6a207a6a6a7338216201a786e1a6bfd7694c7ce05966c40f9b` | bust framing, then Ironmark icon style |

The second reference in each pair is a same-faction unit whose own art is **not**
a placeholder (`forest_scout`, `shield_bearer`), so it carries the faction's real
palette and pixel-art rendering rather than another unit's copied bytes.

### Source masters

The raw model outputs (1024²) are **not committed**, per the same convention wave
1 followed: they were written to a session scratch directory
(`%LOCALAPPDATA%\Temp\wag\603abb0b\raw`), and
`design/arena-unit-sprites/*-1024/` is gitignored. Reproducibility rests on the
committed prompt + model id + reference above, not on the master. No model
returned usable transparency; `hearth_priest` idle candidate A painted a flat
black background and candidate B (the pick) a flat white one, both handled by the
helper's border-tone flood fill.

### Post-processing

The wave-1 helper, unchanged (no second pipeline):

```
node design/arena-unit-sprites/collision-cut.mjs <raw.png> <out.png> idle|icon
```

- `design/arena-unit-sprites/collision-cut.mjs` — git blob
  `90a062f13223e4d46f3a6497cdde2bca2abd696e` (== `HEAD`, unmodified by this
  change); sha256 on disk in this checkout
  `4d6dc46d66e7fb1aff1b07145adaddc8212190c65d5082cfe5f151e21b5b6b67`.
- Run under Node v24.18.0 with pngjs 7.0.0 and Playwright 1.61.1 (bundled
  Chromium); enabled devDependencies, no install performed by this wave.
- **Provenance note.** Wave 1's section above records sha256
  `6073599b1a1a673907292f5a00656bba16d88834c27501e9ae8132fa91bbbc07` for this
  same path. That does not match the file wave 1 committed, which is byte-for-byte
  what `HEAD` still holds — most likely a line-ending difference at hash time
  (`core.autocrlf=true` here). Wave 2 records the git blob hash as well as the
  sha256 so the committed bytes are unambiguous.

### Acceptance

Measured by the helper's own report, then asserted by
`test/data/factionCombatUnitDifferentiation.test.ts`:

| check | druid idle | hearth_priest idle |
|---|---|---|
| dimensions | 128×128 | 128×128 |
| transparent rows under the feet | **0** | **0** |
| opaque content rows | 34–127 | 34–127 |
| content height | 94 / 128 (73%) | 94 / 128 (73%) |
| x extent | 33–95, centre 64.0 | 28–100, centre 64.0 |
| widest row | 52 | 71 |
| base band / widest row | 40/52 = **0.77** | 57/71 = **0.80** |
| opaque pixels in the 2px top/left/right ring | **0** | **0** |

Icons: `druid` drawn 120×119 at (4,5), content rows 5–123, x 4–123, centre 63.5,
ring clear; `hearth_priest` drawn 120×109 at (4,10), content rows 10–118, x
4–123, centre 63.5, ring clear.

The base-band ceiling in the footprint test is per authored asset: 0.50 for wave
1's hounds (thin paws) and 0.85 for this wave's robed pair, whose hem IS the
stance — the shipped `runesmith` measures 0.63 and `shield_bearer` 0.77. See the
report's §4 and §6.

Validation commands:

- `npx tsx --env-file=.env.test --test --test-concurrency=1 test/data/factionCombatUnitDifferentiation.test.ts` → **14/14 green** (4 red before the art landed; the red transcript is in the report's §5).
- `npm run build`, `npm run lint:deps`, `npm run test:types`, `npm run docs:check`, `npm run test:unit` (3029/3029), `npm run test:visual` (13/13 scenes, 0.000%), `npm test` (smoke, `ALL TESTS PASSED`) → green; the full table is in the report's §7.

### Attribution / licence

Raw output of the named OpenRouter-hosted models. No per-asset licence or
attribution restriction was supplied with the response; training-data provenance
is not exposed. Nothing was copied from third-party art.

---

## Wave 3 — the ironmark ram pens (the one cross-faction BUILDING collision)

Per-wave manifest for the single asset landed by
`analysis/2026-11-07-give-the-ironmark-ram-pens-their-own-art.md`: the
`ramPens = stables` pair — the only one of the building audit's seven duplicate
groups
(`analysis/2026-11-07-faction-building-differentiation.md` §E1) that collides
ACROSS factions, and therefore the only one that makes two seats
indistinguishable. The other six stay declared as within-faction reuse in
`test/data/factionBuildingDifferentiation.test.ts`.

The two paths were byte-identical (`sha256
b9a2b7846292fbd7d30abd9bb128ac20582e6ce9c29e897084c1917f674a938e` on both). The
**copier is `ramPens`**: `roster-parity-placeholder-art.md` §Buildings lists it
as the destination whose source is `stables`, `git log --follow` shows
`building-pixel-stables-1.png` added by `e7b3b20` (the original 2026-10 pixel
building set) and `building-pixel-ramPens-1.png` added later, as a copy, by
`30d1024` (roster parity and per-faction starter buildings). Same rule as the
unit waves: the copier is re-authored, the original keeps its bytes.

### Final asset

| asset path | family key | sha256 | dimensions |
|---|---|---|---|
| `src/resources/buildings/building-pixel-ramPens-1.png` | `pixel.ramPens.1` (glob) — `pixel.ramPens.2/3` alias to it | `2f05426fcaa858c013d080e827b0f34d6d0844b68212ba9197bdc6491d2430da` | 1024×1024 RGBA |

Replaced (the placeholder the 2026-10-22 roster expansion shipped): sha256
`b9a2b7846292fbd7d30abd9bb128ac20582e6ce9c29e897084c1917f674a938e`, one file
serving both `building-pixel-ramPens-1.png` and `building-pixel-stables-1.png`.
The original is untouched: `building-pixel-stables-1.png` is still
`b9a2b7846292fbd7d30abd9bb128ac20582e6ce9c29e897084c1917f674a938e`, and its
level-2/3 art still `0479e771d65f33190e331b5e7a963eb456379d45dc6e17c2296ae48b7999c85e`
and `43fcbd99436eb57d581c7be45073d9d84025f6e601cbcd5fb6e3c3228c9d4fe0`.

Generated artifact: `src/render/generated/buildingAnchorOverrides.ts` —
`pixel.ramPens.{1,2,3}` move from `9` to `0`, the only rows that change.

### Generation

- Date: 2026-11-07.
- Provider: OpenRouter (`POST /api/v1/chat/completions`, `modalities: ["image","text"]`),
  one candidate per model, each a foreground call.
- Models run — four candidates, four DIFFERENT ids:
  `google/gemini-2.5-flash-image` (candidate A),
  `google/gemini-3-pro-image` (**candidate B, the pick**),
  `google/gemini-3.1-flash-image` (candidate C),
  `google/gemini-nano-banana-2.1` (candidate D).
  Raw candidate sha256:
  A `1806998613935ee3473c9fd308e78c25a7a20e6bf7ad6eb04527126ba58ee61b`,
  B `f39cd5f1f632c3e4722f27b0dfa38b25a07bbbe3303107e74f6f453ee3096a0b`,
  C `5ba87dd682c9ee2238cb60538a7b6342c23dfc2d8e4c5de627fcae664c657990`,
  D `e880e31f438597385b27dac377d2c2995004ac8ee53d57cb53836aa56d33f4de`.
  Request/job IDs and seeds are **not exposed** by the API.
- Candidate D returned JFIF/JPEG bytes behind the `.png` output path (magic
  `ffd8ffe0`), the same behaviour wave 1 recorded for this id. It was decoded
  through Chromium and cut like the others rather than discarded; it lost on the
  drawn-size comparison, so no JPEG enters the tree.
- Why B: at the in-game lot size (the 1×1 cell's 86.4px draw width) it is the
  clearest of the four as a stone-walled animal pen, and it is the closest to the
  ironmark material idiom its reference carries — blue-grey ashlar, brass
  banding, a wooden gate, straw and a water barrel. A is the flattest and
  lightest (its masonry reads as one tone); C's wall is tall enough to read as a
  keep rather than pens; D came back as the flattest, widest lot with the
  smallest pen. All four were cut and compared at the drawn size before the
  pick, not at 1024.

### Prompts

Committed, one per surface (buildings have a single surface); the exact text
sent, no placeholders. Both hashes are given because `core.autocrlf=true` makes
the on-disk sha256 line-ending dependent.

| prompt file | sha256 (as written) | git blob | used for |
|---|---|---|---|
| `design/arena-unit-sprites/prompts/collision-ramPens-building.txt` | `38708501b5eb3f3314f6ffb15b36b1b01c9a2b583a055f59de8a638feab5ebd7` | `45b7326e4acaaa179ff7bc87e53e9c6736b018ab` | all four candidates |

The prompt is the building wave's own template
(`design/building-pixel-wave/prompts/building-pixel-stables-1.txt`) with the
faction material paragraph pointed at the SECOND reference, plus the
wave-README's background clause ("plain uniform solid light-gray background with
absolutely no checkerboard pattern anywhere", and the trailing
"no checkerboard pattern anywhere on the canvas") and an explicit
no-slab/no-plinth/no-shadow clause. The models drew a soil slab under the lot
anyway — all four, 2,419 px (D) to 31,245 px (A) of it, the same prompt-proof
plinth the unit-art skill records — and the fit pass cleared it in every case.

### Reference images (the model received these)

| asset | reference (as it was at generation time) | sha256 | role |
|---|---|---|---|
| ramPens building | FIRST `src/resources/buildings/building-pixel-ramPens-1.png` (the placeholder being replaced, byte-identical to `stables-1.png`), SECOND `src/resources/buildings/building-pixel-gunnersRedoubt-1.png` | `b9a2b7846292fbd7d30abd9bb128ac20582e6ce9c29e897084c1917f674a938e`, `cf2d435a1ed0c996b9aeed01611bd43943b67773941d94e917814111e3c68fe1` | the FIRST carries pixel size, outline weight, canvas framing and the LOT's width and position; the SECOND is a same-faction building whose own art is **not** a placeholder (ironmark: blue-grey stone, brass trim, forge accents) and carries the palette and materials. Ironmark's other two non-placeholder buildings are `forgeHall` and `deepAnvil`; `delversHall`, `hearthTemple` and the six within-faction pairs are themselves placeholder copies, so they are not usable as a style reference. |

### Source masters

The raw model outputs (1024²) are **not committed**, following the same
convention as the unit waves: they were written to a session scratch directory
(`%LOCALAPPDATA%\Temp\wag\283eb115\raw`) and `design/arena-unit-sprites/*-1024/`
is gitignored. Reproducibility rests on the committed prompt + model id +
reference above, not on the master.

### Post-processing

A new helper beside the unit one — the same pipeline, with a third mode for the
building canvas:

```
node design/arena-unit-sprites/collision-cut-building.mjs <raw.png> <out.png> [--canvas 1024] [--lot 0.855]
```

- `design/arena-unit-sprites/collision-cut-building.mjs` — git blob
  `af6cdd581214b089df5940d44a57c4e6ea7d8d2b`, sha256
  `3ac2a7a2a668263d3c00f9e5a57701bcb1d580220613b7af42f20b3f158f86e9`.
- `design/arena-unit-sprites/collision-cut.mjs` — **unchanged by this wave**,
  git blob `90a062f13223e4d46f3a6497cdde2bca2abd696e` (== `HEAD`), so the unit
  waves' recorded helper provenance stays true. It could not be used verbatim:
  its `idle`/`icon` modes cut a figure into a 128×128 unit canvas, while a
  building is authored on the 1024×1024 `building-pixel-*` canvas and needs its
  GROUND PLANE planted on the iso footprint.
- Run under Node v24.18.0 with pngjs 7.0.0 and Playwright 1.61.1 (bundled
  Chromium); no install performed by this wave.
- Phases: border-tone flood fill (one tone here: every candidate's border was a
  single uniform grey, 188-221) + tight halo → floater drop → the LOT fitted to
  the grid (sand mask, robust line fit per side of the south vertex, vertical
  scale `0.5 / measured` about that vertex, everything below the fitted edges
  cleared) → crop → uniform scale so the ground diamond spans `--lot` of the
  canvas and the sprite's own base is the canvas' LAST row → metrics.
- **Provenance note (carried forward).** Wave 1's section records sha256
  `6073599b1a1a673907292f5a00656bba16d88834c27501e9ae8132fa91bbbc07` for
  `collision-cut.mjs`, which matches neither the blob at `HEAD` nor an on-disk
  hash this wave could reproduce; wave 2 already recorded the blob hash instead.
  Stated again rather than rewritten: the wave-1 line is left as it stands.

### Acceptance

Measured by the helper's own report, then asserted by
`test/data/factionBuildingDifferentiation.test.ts`:

| check | value |
|---|---|
| background cleared | 66.7% of the canvas (flood ≤ 26, halo ≤ 34) |
| components | 1 kept, 0 dropped (no fragmentation) |
| model lot's lower edges | dy/dx 0.5680 (**29.60 deg**) — left 0.5733, right 0.5628, south vertex 512,910 |
| vertical fit | scale 0.8802 about the south vertex → 0.4992 (26.53 deg) after |
| soil slab cleared | 4,722 px below the lot's fitted front edges |
| sand diamond width | 857 px raw → drawn 885 px = **0.864** of the canvas (family band 0.84-0.92) |
| canvas | 1024×1024 RGBA, content rows 439..1023 |
| bottom pad | **0** rows (alpha > 10) → `anchorOffsetY` **0**, measured by `gen-building-anchors.mjs` |
| ring (2px) | 8 px opaque — the lot's own outline reaching the corners, not a frame |

Validation commands:

- `npx tsx --env-file=.env --env-file=.env.test --test --test-concurrency=1 test/data/factionBuildingDifferentiation.test.ts` → **10/10 green** (3 of the 10 red before the art landed, 4 red with the placeholder swapped back; both transcripts are in the report's §4).
- `npm run build`, `npm run lint:deps`, `npm run test:types` (no regressions), `npm run docs:check`, `npm run gen:sprite-keys:check`, `npm run gen:building-anchors:check`, `npm run test:unit` (**3040/3040**), `npm run test:visual` (**13/13 scenes, 0.000%**) → green. `npm test` (smoke, `test/smoke.ts`) was **not run**: it wipes every game in the shared `game_poc` database and sibling worktrees were live.

### Attribution / licence

Raw output of the named OpenRouter-hosted models. No per-asset licence or
attribution restriction was supplied with the response; training-data provenance
is not exposed. Nothing was copied from third-party art.
