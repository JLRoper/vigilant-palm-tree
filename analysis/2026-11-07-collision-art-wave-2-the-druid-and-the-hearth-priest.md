# Collision art wave 2 — the verdant druid and the ironmark hearth priest

Worked 2026-11-07 in `C:/ProjectDevelopment/heroes-js/.worktrees/take-collision-art-wave-bb7beb`
on branch `wtgui/take-collision-art-wave-bb7beb`, cut from `github/main` at
**0.53.16** (`8a6f845`, the merge of #378 — wave 1).

Wave 1 built the pipeline and landed the FIRST colliding seat-faction pair
(`analysis/2026-11-07-give-the-colliding-seat-factions-their-own-unit-art.md`).
This wave runs that same pipeline — `design/arena-unit-sprites/collision-cut.mjs`,
unchanged — on the next cluster of the wave-1 REMAINING table, and shrinks the
duplicate-byte ledger in `test/data/factionCombatUnitDifferentiation.test.ts` by
three rows.

---

## 1. The brief, and the measurement that contradicted it

The card said the druid "closes THREE of the remaining duplicate groups: its
icon is shared with the human mage, and its arena sprite is shared three ways
with ironmark's hearth priest and the runesmith. **Two assets, three groups.**"

Measured off the shipped bytes, two assets cannot close three groups, and the
reason is arithmetic rather than taste:

- A duplicate group is a set of units whose PNG is literally one file. The
  druid's arena group is `[druid, hearth_priest, runesmith]` — all three paths
  hold `3ce3a525…`. Handing the druid new art removes the druid from that set and
  leaves `[hearth_priest, runesmith]` still sharing a file. The group does not
  leave the ledger; it **narrows**, and a narrowing row is rewritten with its
  surviving members, never dropped.
- So the arena group leaves only if TWO of its three members are re-authored,
  and the icon groups (`[druid, mage]`, `[hearth_priest, runesmith]`) each need
  one member re-authored. The minimum that closes all three rows is **four
  PNGs** across two units.

The placeholder provenance settles WHICH two units, and which side of each group
to rewrite (`design/arena-unit-sprites/roster-parity-placeholder-art.md`):

| unit | icon copied from | arena idle copied from |
|---|---|---|
| verdant `druid` | human `mage` | ironmark `runesmith` |
| ironmark `hearth_priest` | ironmark `runesmith` | ironmark `runesmith` |

`druid` and `hearth_priest` are the COPIERS; `mage` and `runesmith` are the
originals. Re-authoring the copiers and leaving the originals' art intact is the
side of the collision that is wrong, and it is the side this wave rewrote.

**Scope, confirmed:** four PNGs — `druid` and `hearth_priest`, each on both
surfaces — closing the arena triple and both icon pairs. The mage is not folded
in (its icon is the original, and it still has no arena art at all:
`EXPECTED_ARENA_GAPS` in `test/render/unitArenaDescriptors.test.ts`), and neither
is the rest of the audit's R1+R2 as written.

**Size against wave 1.** Wave 1 was two units, two surfaces, four assets, closing
two groups. This wave is the same size — two units, two surfaces, four assets —
closing three groups, because the arena group it closes has three members rather
than two. The card's own count ("two assets, three groups") was the only thing
that could not be reconciled, and it is recorded here as a falsified estimate
rather than quietly worked around.

## 2. The audit — the four paths, and the bytes on each side

Nothing was overwritten until the paths were named. Each new asset replaces a
byte-for-byte copy of another unit's file; the original is untouched.

| asset | before | copied from (before sha256) | after (this wave) |
|---|---|---|---|
| `src/resources/units/arena/druid-idle.png` | `3ce3a525c4fb8e5e…e5f0c04b0135` | `arena/runesmith-idle.png`, identical | `01a3b2ca734ece48…df2e6b4c` |
| `src/resources/units/arena/hearth_priest-idle.png` | `3ce3a525c4fb8e5e…e5f0c04b0135` | `arena/runesmith-idle.png`, identical | `f94923ad95466045…896c31e712` |
| `src/resources/units/icons/druid.png` | `412aa097fb33832c…09e26e27` | `icons/mage.png`, identical | `9da1e5819f68e457…0498ea5959` |
| `src/resources/units/icons/hearth_priest.png` | `bd86dad2c2e32aa8…b6a2becd` | `icons/runesmith.png`, identical | `4bb03527833d8af8…237b5e942a` |

Full hashes, prompts and references are in
`design/arena-unit-sprites/collision-fix/MANIFEST.md` (wave 2 section).

The originals are confirmed unchanged after the copy, by content hash:
`runesmith-idle.png` `3ce3a525…`, `runesmith.png` `bd86dad2…`, `mage.png`
`412aa097…`. The placeholder table's provenance holds: the copiers moved, the
originals did not.

### The three groups, justified per asset

The ledger's rule is that a row LEAVES only when no two of its members still
share a file. Group by group, naming the blob whose bytes changed:

| group | blob that changed | members after | leaves? |
|---|---|---|---|
| arena `[druid, hearth_priest, runesmith]` | `arena/druid-idle.png` and `arena/hearth_priest-idle.png` (both new) | `druid` `01a3b2ca…`, `hearth_priest` `f94923ad…`, `runesmith` `3ce3a525…` — three distinct files | **yes** |
| icon `[druid, mage]` | `icons/druid.png` (new; `mage.png` untouched) | `druid` `9da1e581…`, `mage` `412aa097…` — distinct | **yes** |
| icon `[hearth_priest, runesmith]` | `icons/hearth_priest.png` (new; `runesmith.png` untouched) | `hearth_priest` `4bb03527…`, `runesmith` `bd86dad2…` — distinct | **yes** |

No row narrowed, so no row was rewritten, and none was added. Re-measured from
disk after the copy: the arena surface drops 11 groups → **10**, the icon surface
12 → **10** — exactly the three declared rows removed and nothing else.

## 3. The pipeline, run again (not rebuilt)

`design/arena-unit-sprites/collision-cut.mjs` is wave 1's helper, used as it
ships (git blob `90a062f13223e4d46f3a6497cdde2bca2abd696e`, byte-identical to
`HEAD` and unmodified by this change). No second pipeline was written.

**Candidates — three to four per surface, from different image models**, via the
OpenRouter chat-completions image path, with committed prompts
(`design/arena-unit-sprites/prompts/collision-{druid,hearth_priest}-{idle,icon}.txt`)
and two attached references each: the placeholder sprite being replaced (its
pixel size, outline weight and canvas framing) and a same-faction unit whose art
is NOT itself a placeholder (Verdant Wild `forest_scout` for the druid, Ironmark
Holds `shield_bearer` for the hearth priest — palette, shading ramp, outline
weight).

| surface | model | candidate | verdict |
|---|---|---|---|
| druid idle | `google/gemini-2.5-flash-image` | **A** | **picked** — the stockiest, clearest silhouette of the three: green hooded robe with a leaf-cut hem, oak staff crowned with leaves and a gold sap bead, satchel, grey beard. Reads at 64px |
| druid idle | `google/gemini-3-pro-image` | B | more internal detail, but a thinner figure whose antlers sprout from the staff head — reads as a second object at game size |
| druid idle | `google/gemini-3.1-flash-image` | C | good, but the same antlered staff and a paler robe |
| druid icon | `google/gemini-2.5-flash-image` | A | bust reads, but the staff dominates the frame and the bust is small |
| druid icon | `google/gemini-3-pro-image` | **B** | **picked** — cleanest bust: hood with oak leaves, grey-green beard, acorn clasp, staff crown behind the shoulder |
| druid icon | `google/gemini-3.1-flash-image` | C | clean, very close to B; B's leaves and clasp resolve better |
| druid icon | `openai/gpt-5.4-image-2` | D | **HTTP 502** `Complexity 'none' is not supported for this image model` — the same provider failure wave 1 recorded; not used |
| hearth_priest idle | `google/gemini-2.5-flash-image` | A | painted a flat BLACK background, and holds the rune hammer across the body, which inflates the widest row and flatters the base-band measurement without changing the stance |
| hearth_priest idle | `google/gemini-3-pro-image` | **B** | **picked** — hooded dwarf, braided copper beard with iron rings, forge-blue robes, iron gorget, hearth censer, hammer head-down at his side |
| hearth_priest idle | `google/gemini-3.1-flash-image` | C | near-identical to B; B's censer and runes are crisper |
| hearth_priest icon | `google/gemini-2.5-flash-image` | A | hammer clipped at the frame edge, bust smaller |
| hearth_priest icon | `google/gemini-3-pro-image` | **B** | **picked** — hood, gorget with runes, braided beard, rune hammer behind the shoulder with ember glow; distinctly NOT the runesmith's goggles-and-apron bust |
| hearth_priest icon | `google/gemini-3.1-flash-image` | C | good; the collar runes read as noise at icon size |

Three different image models per surface, four on the druid icon counting the
OpenAI probe. Unlike wave 1 (where `gemini-3-pro-image` swept all four picks),
the arena idle pick here is `gemini-2.5-flash-image`: on a robed upright figure
the pro model's extra internal detail buys a thinner silhouette that reads worse
at the drawn size, which is the opposite of the trade wave 1 found on a hound.

**The cut** — one helper, one mode per surface, deterministic, no network:
border-seeded flood fill over the model's fake-transparency background (an
uniform tone or a two-tone checkerboard), a tight halo, detached floaters dropped
by connected component, crop to the alpha bbox, a high-quality smoothed draw into
the 128×128 canvas (the same downscale convention as `downscale-arena.mjs`),
then zeroing the 2px edge ring. `idle` draws into a 120×94 box with the base on
the canvas' LAST row; `icon` centres the bust in a 120×120 box.

| metric | druid idle | hearth_priest idle | druid icon | hearth_priest icon |
|---|---|---|---|---|
| dimensions | 128×128 RGBA | 128×128 RGBA | 128×128 RGBA | 128×128 RGBA |
| transparent rows under the feet | **0** | **0** | n/a (centred) | n/a (centred) |
| content rows | 34..127 | 34..127 | 5..123 | 10..118 |
| content height | 94 / 128 (73%) | 94 / 128 (73%) | 119 / 128 | 109 / 128 |
| x extent | 33..95, centre 64.0 | 28..100, centre 64.0 | 4..123, centre 63.5 | 4..123, centre 63.5 |
| widest row | 52 | 71 | 106 | 110 |
| base band / widest row | 40/52 = **0.77** | 57/71 = **0.80** | 38/106 = 0.36 | 48/110 = 0.44 |
| opaque pixels in the 2px top/left/right ring | **0** | **0** | **0** | **0** |

Both arena sprites land with `bottomPad 0` and `ringOpaque 0`: the base is on
the canvas' last row (the hex's south vertex under the `unit.<id>.<pose>`
descriptor's bottom anchor) and the model's fake background is gone from every
edge the figure does not stand on.

## 4. The ledger edit, and the two tests that guard it

`test/data/factionCombatUnitDifferentiation.test.ts` (13 tests before, 14 after):

1. **Three rows deleted** from `OUTSTANDING_DUPLICATE_GROUPS` — arena
   `[druid, hearth_priest, runesmith]`, and the icons `[druid, mage]` and
   `[hearth_priest, runesmith]`. The ledger's doc comment now states the rule the
   wave-2 scope turned on: a group LEAVES only when no two of its members still
   share a file, and a row that narrows is rewritten with its surviving members
   rather than dropped.
2. **A new cluster test** — *"the druid / hearth_priest cluster this change
   differentiated ships unique art on every surface"* — asserts every pair inside
   each closed group is now a distinct file, and its message names **both asset
   paths** (`…/arena/druid-idle.png and …/arena/hearth_priest-idle.png are still
   one file — the arena group [druid, hearth_priest, runesmith] must not share
   bytes`). A re-collision of any two named paths fails here and in the ledger
   test, which prints the same pair joined by ` == `.
3. **The footprint contract extended** — `FOOTPRINT_EXACT_ARENA_IDS` gains
   `druid` and `hearth_priest`, so the two new arena sprites are held to the same
   base-on-the-last-row / no-plinth / clean-edge assertions wave 1 pinned. The
   base-band ceiling became per-asset, because the band a figure stands on is a
   property of its silhouette: wave 1's hounds stand on four thin paws and keep
   the 0.50 ceiling, while a robed upright figure stands on its own hem — the
   shipped `runesmith` measures 0.63 and `shield_bearer` 0.77 (the `lich`'s hem
   reaches 1.00) — so the wave-2 pair is pinned just above its own measured band
   (0.85). A slab that swallows the stance still trips it. This is the one place
   this wave loosened a wave-1 constant, and it is recorded as a measurement
   rather than a preference.

## 5. Failing first

Wave 1's four new tests were red before its art landed. This wave's tests were
run red the same way: the new test file with the ORIGINAL four placeholder PNGs
restored (`git checkout HEAD --` the four paths, art restored afterwards),
`PGDATABASE=game_poc_wtgui_take_collision_art_wave_bb7beb`,
`npx tsx --env-file=.env.test --test --test-concurrency=1`:

```
✔ … 9 pre-existing tests …
✖ units of different factions share no arena art outside the declared ledger
    two units ship the same arena bytes and no ledger row declares it
    + [ '…/src/resources/units/arena/druid-idle.png == …/src/resources/units/arena/hearth_priest-idle.png' ]
    - []
✖ units of different factions share no icon art outside the declared ledger
    + [ '…/src/resources/units/icons/druid.png == …/src/resources/units/icons/mage.png',
        '…/src/resources/units/icons/hearth_priest.png == …/src/resources/units/icons/runesmith.png' ]
    - []
✖ the druid / hearth_priest cluster this change differentiated ships unique art on every surface
    …/src/resources/units/arena/druid-idle.png and …/src/resources/units/arena/hearth_priest-idle.png are still one file
    actual   3ce3a525c4fb8e5e20c364b908b79e8d200208d4bc42241c30cff0f5c04b0135
    expected the same
✖ the new arena art is cut to the iso footprint: base on the last row, no plinth, clean edges
    …/src/resources/units/arena/druid-idle.png leaves 11 transparent rows under the feet — the unit would float
    above the hex's south vertex
    116 !== 127
# tests 14  # pass 10  # fail 4
```

Four red, the same count as wave 1, each naming the asset paths. With the new art
in place: **14 tests, 14 pass, 0 fail**.

## 6. What this change does NOT prove

- **The new art in the running client.** Verified by measurement (the alpha and
  geometry assertions above) and by eye on the cut PNGs at 128px and in a
  contact sheet — **not** by a screenshot from the arena. No arena screenshot was
  taken, so nothing here should be read as "seen in the client". The
  `battle-arena-*` visual baselines are unaffected either way, and that is
  checked: they render unit *count* badges on hexes, with no unit sprite drawn in
  any of the three captured states, and `npm run test:visual` matched all 13
  scenes at 0.000% after this change.
- **The other 22 groups.** Untouched by instruction. Three sibling cards are live
  in this repository; this wave keeps to its own tree and its own database. The
  mage is not folded in (its icon is the original art, and its missing arena art
  is still `EXPECTED_ARENA_GAPS`), so the audit's R1+R2 as written is not what
  landed here.
- **The other poses of these units.** `druid`, `hearth_priest` and `runesmith`
  ship no attack/move PNGs at all — only `-idle` — so there is no other pose to
  re-cut, unlike the warhound in wave 1.
- **Attribution/licence of the model output.** Raw OpenRouter model output with
  no seed exposed; the wave-2 manifest records the model id, prompt file and
  reference per the repo's metadata convention, and nothing about training-data
  provenance.
- **The helper hash wave 1 recorded.** Wave 1's manifest records
  `6073599b1a1a673907292f5a00656bba16d88834c27501e9ae8132fa91bbbc07` for
  `collision-cut.mjs`; the file committed by that change (and unchanged since;
  `git hash-object` = `HEAD`'s blob, `90a062f1…`) hashes `4d6dc46d66e7fb1a…` in
  this checkout. The two cannot both describe the same bytes, most likely a
  line-ending difference at hash time. Wave 2 records the git blob hash as well
  as the sha256 for exactly this reason; the discrepancy is flagged, not fixed in
  someone else's file.

## 7. Verification actually run

All commands run in this worktree with
`PGDATABASE=game_poc_wtgui_take_collision_art_wave_bb7beb` (the per-worktree
database created for this branch by `databaseNameForBranch`, so nothing here
touches the shared `game_poc`), Node v24.18.0.

| command | result |
|---|---|
| `npx tsx --env-file=.env.test --test --test-concurrency=1 test/data/factionCombatUnitDifferentiation.test.ts` | **14 tests, 14 pass, 0 fail** — the 13 pre-existing tests plus the new cluster test; 4 were red before the art landed (§5) |
| `npm run build` | succeeded (`tsc && vite build`, built in 2.31s) |
| `npm run lint:deps` | no dependency violations (547 modules, 1841 dependencies) |
| `npm run test:types` | `APPLICATION TYPES: clean (0 errors)`; `TEST TREE TYPES: no regressions (296 known errors across 77 files, baseline 296)` — the edited test file adds none |
| `npm run docs:check` | passed — 20 maintained docs, 221 local links, 567 source paths |
| `npm run test:unit` | **3029 tests, 3029 pass, 0 fail** |
| `npm run test:visual` | **PASS — all 13 scenes matched their baselines**, including `battle-arena-legacy`, `battle-arena-scenebuilder` and `battle-arena-default` — new unit art does not move a baseline |
| `npm test` (the CI job's own `test/smoke.ts` entry) | `ALL TESTS PASSED`, run against the per-worktree database |

Not run, and why: `test:districts`, `test:cityview` and the other `tools/run-test.mjs`
suites (this change touches no settlement, economy or city code, and none of them
reads unit art), and `test:all` (it would wipe the shared `game_poc` while sibling
worktrees are live, which the repo forbids).

The four assets were confirmed on disk by content hash after the copy
(`01a3b2ca73…`, `f94923ad95…`, `9da1e5819f…`, `4bb0352783…`), so the committed
bytes are the cut bytes, not a stale working copy.
