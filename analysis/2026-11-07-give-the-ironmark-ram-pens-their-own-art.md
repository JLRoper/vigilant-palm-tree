# Give Ironmark's ram pens their own art

The one CROSS-faction building-sprite collision in the game, closed. Brief:
re-measure the `ramPens` / `stables` duplicate on current `main`, name the
placeholder with evidence, re-author the copier, run the collision waves'
pipeline, pin the ledger in `test/data/factionBuildingDifferentiation.test.ts`,
one branch, one PR.

Measured against `github/main` at **0.53.21** (`af4b4d3`, merge of #382 — the
branch this landed from was fast-forwarded onto that tip before any work, so
every figure below is current main, not a stale branch). The worktree and the
database are this card's own: `game_poc_wtgui_give_ironmark_s_ram_pens_44c79f`.

---

## 1. The measurement: which of the pair is the placeholder

Re-measured, not taken on the brief's word. The bytes:

| path | sha256 |
|---|---|
| `src/resources/buildings/building-pixel-ramPens-1.png` | `b9a2b7846292fbd7d30abd9bb128ac20582e6ce9c29e897084c1917f674a938e` |
| `src/resources/buildings/building-pixel-stables-1.png` | `b9a2b7846292fbd7d30abd9bb128ac20582e6ce9c29e897084c1917f674a938e` |

Identical, and the whole registered pixel family was scanned to confirm the
scope: **123 files, 116 unique hashes, 7 duplicate groups** — exactly the seven
`analysis/2026-11-07-faction-building-differentiation.md` §E1 recorded, six
within a single faction and this one across two.

**The copier is `ramPens` (ironmark); the original is `stables` (human).** Three
independent pieces of evidence, all in the tree:

1. **The placeholder convention.** `design/arena-unit-sprites/roster-parity-placeholder-art.md`
   §Buildings is a `New kind → Source kind` table — "ramPens | stables" — and its
   preamble says the 2026-10-22 roster expansion "deliberately ships byte-for-byte
   copies of existing project PNGs … temporary visual stand-ins". The destination
   column is the new kind, the source column the file it was copied from.
2. **`git log --follow` on both paths** (the history each file actually has):

   ```
   $ git log --follow --oneline -- src/resources/buildings/building-pixel-ramPens-1.png
   30d1024 feat(factions): roster parity and per-faction starter buildings
   e7b3b20 feat(city): generate and wire pixel building sprites for every kind
   $ git log --follow --oneline -- src/resources/buildings/building-pixel-stables-1.png
   e7b3b20 feat(city): generate and wire pixel building sprites for every kind
   ```

   `stables-1.png` comes from the original 2026-10 pixel building set; the
   `ramPens` path is created later as a second name for those same bytes by the
   roster-parity commit. The one with the shorter history is the copy.
3. **The faction registries agree with the table.** `packages/engine/src/buildingRegistry.ts`
   tags `stables: { faction: "human" }` and `ramPens: { faction: "ironmark" }`,
   and `stables` is the human set's own stable while `ramPens` is a roster-parity
   addition — the new kind is the one drawing borrowed art.

So the copier is re-authored and the original is left alone, the rule the unit
waves followed. Verified afterwards: `building-pixel-stables-1.png` is still
`b9a2b784…`, and its level-2/3 art is still `0479e771…` / `43fcbd99…`.

---

## 2. The pipeline, run as the unit waves built it

Nothing was re-architected: same helper family, same prompt convention, same
per-wave manifest.

- **Four candidates, four different image models**, one foreground call each:
  `google/gemini-2.5-flash-image` (A), `google/gemini-3-pro-image` (B, picked),
  `google/gemini-3.1-flash-image` (C), `google/gemini-nano-banana-2.1` (D).
- **Two references per candidate**, named positionally in the prompt: FIRST the
  placeholder being replaced (`building-pixel-ramPens-1.png` — pixel size,
  outline weight, canvas framing, and the lot's width and horizontal position),
  SECOND a same-faction building whose own art is **not** a placeholder
  (`building-pixel-gunnersRedoubt-1.png` — ironmark: blue-grey ashlar, brass
  trim, forge accents). Ironmark's other non-placeholder buildings are
  `forgeHall` and `deepAnvil`; `delversHall`, `hearthTemple` and the six
  within-faction pairs are themselves copies, so none of them could serve.
- **Prompt committed** at
  `design/arena-unit-sprites/prompts/collision-ramPens-building.txt`, the exact
  text sent: the building wave's own template
  (`design/building-pixel-wave/prompts/building-pixel-stables-1.txt`) with the
  material paragraph pointed at the SECOND reference, the wave README's
  background clause, and an explicit no-slab/no-plinth/no-shadow clause.
- **Raw masters stay out of the commit** (scratch directory;
  `design/arena-unit-sprites/*-1024/` is gitignored). Provenance is the prompt +
  model id + reference hashes, recorded in `collision-fix/MANIFEST.md` wave 3.

---

## 3. Per-candidate verdicts (judged at the drawn size, not at 1024)

Every candidate was cut and then compared at the size the game draws a 1×1
building — the cell's 86.4px draw width — with the shipped `stables` and
`gunnersRedoubt` beside it; the 3× enlargement was used only to inspect detail.

| candidate | model | verdict |
|---|---|---|
| A | `google/gemini-2.5-flash-image` | A square stone pen with a gate, 4 rams, straw, barrels, cut stone. Clean and legible, but the masonry is one flat light blue-grey tone with little brass: the least ironmark of the four. Its lot fills the least of the canvas (0.818 raw), so the cut had to scale it UP 1.045 and the pixel grain coarsens. |
| **B** | **`google/gemini-3-pro-image`** | **Picked.** An oval blue-grey ashlar pen with brass banding, a timber gate with brass, rams (mixed grey and cream fleeces), a hay bale, a water barrel and cut stone. Closest to the faction's own art, legible as *pens* at 86px, and its lot is already near the target width (0.837 raw → 1.022 scale, i.e. barely resampled). |
| C | `google/gemini-3.1-flash-image` | A tall round wall with a brazier, three rams, hay rolls, barrels. The best brass, but the wall is tall enough that at 86px it reads as a keep or a tower well rather than pens. |
| D | `google/gemini-nano-banana-2.1` | Returned **JFIF/JPEG** bytes (magic `ffd8ffe0`) behind the `.png` output path — the behaviour wave 1 recorded for this id. It was decoded through Chromium and cut anyway rather than discarded; it lost on the comparison: the flattest, widest lot (0.960 raw) with the smallest pen. No JPEG enters the tree. |

One pick, so nothing is billed twice: the 4 generations are the wave's whole
cost.

---

## 4. The cut, and the two red transcripts

`design/arena-unit-sprites/collision-cut-building.mjs` is new; the unit helper
`collision-cut.mjs` is **untouched** (git blob `90a062f1…` == `HEAD`) so the unit
waves' recorded helper provenance stays true. It could not be used verbatim: its
`idle`/`icon` modes cut a figure into a 128×128 unit canvas, while a building is
authored on the 1024×1024 `building-pixel-*` canvas and its own GROUND PLANE has
to land on the iso footprint. The phases are the same — border-tone flood fill
(one uniform grey tone here, 188-221, on every candidate) plus a tight halo, then
a floater drop — followed by the building step: measure the sand's lower edges
from a mask (the alpha silhouette is contaminated by the soil slab), scale the
image vertically about the sand's south vertex to the grid's `dy/dx 0.5`
(26.57 deg), clear every pixel below the fitted edges, then crop and draw into
the 1024 canvas at the family lot width with the sprite's own base ON the last
row.

The picked candidate's report:

```
tones: 199,199,199 (border share 100%)
background: cleared 66.7% (flood<=26, halo<=34)
building: 1 components, kept 1, dropped 0 (0px)          <- no fragmentation
lot: sand 857 columns, lower edges dy/dx 0.5680 (29.60 deg) - left 0.5733 right -0.5628
plinth: vertical scale 0.8802, 4722px cleared below the lot's front edges
lot: sand spans x 84..940 = 857px (0.837 of the raw canvas)
crop: 866x573 at 80,340 -> drawn 885x585 at 70,439 (scale 1.0216)
metrics: 1024x1024, content rows 439..1023 (bottomPad 0), x 70..954 (width 885 = 0.864),
         widest 885, ringOpaque 8
anchor: gen-building-anchors measures bottomPad 0 -> anchorOffsetY 0
```

All four candidates produced a 2:1 lot with a bottom pad of 0; the model's own
projection was 29.5-29.8 deg on every one, i.e. the plinth and the angle are
prompt-proof, exactly as the unit-art skill records — the fit is a post-pass, not
a prompt. The soil slab the models added anyway measured 2,419 px (D), 4,722 px
(B), 20,283 px (C), 31,245 px (A); the fit cleared it in every case.

**Red first, twice.**

1. *The ledger, before the art landed* — `npm run` the suite with the placeholder
   still in place: **3 of 9 tests red**, the two distinctness tests and the
   ledger's regression check, all naming both paths:

   ```
   AssertionError: ...\building-pixel-ramPens-1.png and ...\building-pixel-stables-1.png
     are still one file — ramPens (ironmark) and stables (human) must not ship the same building art
   actual: 'b9a2b7846292fbd7d30abd9bb128ac20582e6ce9c29e897084c1917f674a938e'
   expected: 'b9a2b7846292fbd7d30abd9bb128ac20582e6ce9c29e897084c1917f674a938e'
   ```

2. *The footprint pin, after the art landed and then swapped back*
   (`git checkout github/main -- src/resources/buildings/building-pixel-ramPens-1.png`,
   run, restore): **4 of 10 red**, the fourth being

   ```
   ✖ the ramPens lot is cut to the iso footprint: base on the last row, 2:1 edges, no plinth
     AssertionError: the sprite's own base must be the canvas' last row, or the
       rendered lot floats above its cell's south vertex
   ```

   (the placeholder's bottom pad is 108 rows and its measured `anchorOffsetY` was 9).

---

## 5. The ledger, and what it now permits

`test/data/factionBuildingDifferentiation.test.ts` gains a duplicate-byte LEDGER
over the registered pixel family, with the same rule the unit suite's ledger has:
**the measured set must EQUAL the declaration**, so a row can only leave. The
cross-faction row `ramPens = stables` is **deleted** here, which is what makes
the pair's re-collision fail; the six within-faction groups stay declared.

Four tests, all naming both asset paths on failure:

- *every duplicate-byte group … is declared in the ledger* — two-sided: an
  undeclared collision fails ("land one of them its own art, or the collision is
  a regression") and a declared-but-closed group fails ("delete its row here so
  the ledger keeps shrinking toward empty");
- *every remaining duplicate group is within one faction, not a cross-faction
  collision* — the ledger's own semantic claim;
- *no two building kinds of different factions ship the same sprite bytes* — the
  distinctness assertion §E1 deliberately deferred until unique art landed, now
  assertable, covering faction-vs-shared pairs too;
- *the ironmark ramPens / human stables collision this change closed ships unique
  art* — the closed pair pinned by both paths.

Plus the footprint pin: base on the canvas' last row (bottom pad 0),
`BUILDING_ANCHOR_OVERRIDES["pixel.ramPens.1"] === 0`, the lot's lower edges
within 0.02 of the grid's 0.5 (measured 0.4992 = 26.53 deg), and the lot's width
inside the family band. The suite decodes the PNG with a local reader instead of
a `pngjs` import, because the test tree's type gate counts untyped module imports
as debt — the sibling differentiation suite carries the same reader for the same
reason.

### The six groups left declared

| ids sharing art | faction |
|---|---|
| `blackChapel` = `spireOfAsh` | ashen |
| `dragonBoneyard` = `ossuary` | ashen |
| `deepAnvil` = `hearthTemple` | ironmark |
| `delversHall` = `forgeHall` | ironmark |
| `druidCircle` = `worldrootGrove` | verdant |
| `groveSanctum` = `seedlingGrove` | verdant |

Per the card these are reuse within one faction rather than a
differentiation gap, and are deliberately NOT chased here. They stay rows in the
ledger, so each one's own card deletes its row when it lands — and the build
menu's per-faction sets, the gate and the starter-city difference are untouched
by this change (no registry or DB row moves).

---

## 6. Gate

| step | result |
|---|---|
| `npm run build` | green (tsc + vite, built in 2.35s) |
| `npm run lint:deps` | green (547 modules, 1841 dependencies) |
| `npm run test:types` | APPLICATION clean; TEST TREE **no regressions** (296 known, baseline 296) |
| `npm run docs:check` | green (20 maintained docs, 222 local links, 567 source paths) |
| `npm run gen:sprite-keys:check` | green (123 file keys + 22 aliases) |
| `npm run gen:building-anchors:check` | green (145 keys) |
| `npx tsx … test/data/factionBuildingDifferentiation.test.ts` | **10/10** |
| `npm run test:unit` | **3040/3040 pass**, 0 fail |
| `npm run test:visual` | **13/13 scenes, 0.000%** mismatch on every one |
| `npm test` (smoke) | **NOT RUN** — see below |

`npm test` runs `test/smoke.ts`, which deletes every game except its own fixtures
in the shared `game_poc` database. Two sibling cards are live in their own
worktrees, so it was not run from here; CI's `Build + smoke test` job runs it on
the PR. `test:unit` and `test:visual` ran against this worktree's own
`game_poc_wtgui_give_ironmark_s_ram_pens_44c79f`.

The visual suite is the interesting one for an art change and it is
baseline-neutral: the city-view scenes render a human seat's settlement, and
`ramPens` is ironmark-only, so nothing moved.

---

## 7. NOT PROVEN / open

- **Not seen in the running client.** The acceptance here is measurement (the cut
  metrics and the PNG's own pixels at the drawn size) plus the visual suite's
  unchanged baselines — there is no city-view screenshot of the new ram pens on
  an ironmark settlement. The in-game check is the one thing this report does not
  carry.
- **No Docker redeploy.** Nothing was deployed; the Docker stack still serves the
  last built release.
- **A deliberate geometric choice, worth a second opinion.** The card asked for
  the sprite cut "to the footprint exactly … no thick ground plinth". The shipped
  lot is planted exactly (bottom pad 0 → `anchorOffsetY 0`, so the lot's south
  vertex is on its cell's south vertex, which is *better* than the family's own
  art: `stables` keeps a 108-row pad and an offset of 9, i.e. its slab corner,
  not its sand plane, sits on the vertex) — but its WIDTH is the family's
  footprint scale (0.864), not the full cell. A grid-exact lot spanning the
  whole canvas would need `hexSizeMul 1` (a descriptor change, like
  `GRID_EXACT_FARM_STYLES`) and would draw 86.4px wide against its neighbours'
  ~73px, i.e. visibly a fifth larger than the stable it used to share art with.
  I chose the family scale so the new art drops in at the same size as the sprite
  family around it; if the intent was the grid-exact family's full-width lot
  instead, that is a one-line change in the cut helper (`--lot 1`) plus the
  descriptor entry.
- **The six within-faction pairs remain.** By instruction. Each is its own card.
- **Wall-clock caveat:** the ledger's cross-faction test hashes all 123 PNGs, so
  it costs ~9.5s of the suite. Acceptable for the guarantee; noted for whoever
  tunes the unit glob.

---

## 8. What changed

| file | change |
|---|---|
| `test/data/factionBuildingDifferentiation.test.ts` | + the building duplicate LEDGER, the two distinctness tests, the footprint pin, a local PNG reader |
| `src/resources/buildings/building-pixel-ramPens-1.png` | the new art (2f05426f…), replacing the copy of `stables` (b9a2b784…) |
| `src/render/generated/buildingAnchorOverrides.ts` | regenerated: `pixel.ramPens.{1,2,3}` 9 → 0 (the only rows that move) |
| `design/arena-unit-sprites/collision-cut-building.mjs` | new helper (the collision cut, with the iso-lot fit) |
| `design/arena-unit-sprites/prompts/collision-ramPens-building.txt` | new committed prompt |
| `design/arena-unit-sprites/collision-fix/MANIFEST.md` | wave 3 section |
| `docs/sprite-pipelines.md`, `docs/asset-provenance.md` | the building twin of the collision pipeline, and its provenance row |
