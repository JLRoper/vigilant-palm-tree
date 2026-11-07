# Collision art wave 3 — the verdant ursine guardian and the ironmark war boar

Worked 2026-11-07 in `C:/ProjectDevelopment/heroes-js/.worktrees/take-collision-art-wave-3dda5a`
on branch `wtgui/take-collision-art-wave-3dda5a`, rebased onto `github/main` at
**0.53.23** (`fea8c5b`, the merge of #384) before the final gate run — main moved
three times under this card (the sibling building-set and ram-pens landings), so
the branch was re-based three times and the version re-bumped each time. The art,
the prompts and every measurement below were produced on the first base and are
unchanged by the rebases.

Wave 1 built the pipeline and landed the FIRST colliding seat-faction pair
(`analysis/2026-11-07-give-the-colliding-seat-factions-their-own-unit-art.md`);
wave 2 ran it on the druid / hearth_priest cluster
(`analysis/2026-11-07-collision-art-wave-2-the-druid-and-the-hearth-priest.md`).
This wave runs the same helper — `design/arena-unit-sprites/collision-cut.mjs`,
unchanged — on the next seat-faction row of the wave-1 audit's REMAINING table,
and shrinks the duplicate-byte ledger in
`test/data/factionCombatUnitDifferentiation.test.ts` by two rows.

---

## 1. The brief, and the row it resolves

The card said: pick the next **pair-sized** batch — two units across both
surfaces, about four PNGs — from the wave-2 audit's REMAINING table and the
ledger on main. The ledger on main declares **20 rows**, 10 arena and 10 icons.

Two settled rules decide which row and which side of it:

1. **A collision group is a SET.** Closing one requires **all but one** of its
   members re-authored, and a row that NARROWS is rewritten with its surviving
   members, never dropped.
2. **Re-author the COPIERS** named in
   `design/arena-unit-sprites/roster-parity-placeholder-art.md`, **never the
   originals.**

The ledger row that satisfies both AND is pair-sized is
`[ursine_guardian, warbeast, war_boar]` on both surfaces — the wave-1 audit's
**R4**:

```
arena: [ursine_guardian, warbeast, war_boar]   (one file, three ways)
icon:  [ursine_guardian, warbeast, war_boar]   (one file, three ways)
```

`roster-parity-placeholder-art.md` names the provenance (lines 23–24):

| unit | icon copied from | arena idle copied from |
|---|---|---|
| verdant `ursine_guardian` | verdant `warbeast` | verdant `warbeast` |
| ironmark `war_boar` | verdant `warbeast` | verdant `warbeast` |

`ursine_guardian` and `war_boar` are the **COPIERS**; `warbeast` is the
**ORIGINAL**. Re-authoring the two copiers and leaving the original's art intact
is the side of the collision that is wrong — and it is exactly the set rule's
"all but one": two of the three members rewritten, the third untouched.

**Scope, confirmed:** four PNGs — verdant `ursine_guardian` and ironmark
`war_boar`, each on both surfaces — closing the arena triple and the icon triple.
This is the same weight as waves 1 and 2 (two units × two surfaces). `warbeast`,
`elk_rider = ram_rider` (R3) and the rest of the ledger are not touched.

**Why not R3 (`elk_rider = ram_rider`), the row above it?** That group has two
members, so closing it re-authors **one** unit (`ram_rider`, the copier) — two
PNGs, half the card's stated weight, and it leaves `elk_rider` as the sole
original. It does not fit "two units across both surfaces", so it is deferred, not
skipped.

## 2. The audit — the four paths, and the bytes on each side

Nothing was overwritten until the paths below were named. Each new asset replaces
a byte-for-byte copy of another unit's file; the original is untouched.

| asset | before | copied from (before sha256) | after (this wave) |
|---|---|---|---|
| `src/resources/units/arena/ursine_guardian-idle.png` | `553d8e6f3c0f5fc93e061f7d4d1a00f54902de63de454131ba68aeffd221d9cf` | `arena/warbeast-idle.png`, identical | `42405fb5ce784a62e17650a1e2a6dada74cdac7394b8cf6b59eb4433475f9623` |
| `src/resources/units/arena/war_boar-idle.png` | `553d8e6f3c0f5fc93e061f7d4d1a00f54902de63de454131ba68aeffd221d9cf` | `arena/warbeast-idle.png`, identical | `cd3f6ecef0abce31fb17320882dd2185ce502f62672ab7c138516dd2f5661943` |
| `src/resources/units/icons/ursine_guardian.png` | `8321dcdf8125d90789a085cdbba52265158cfd0578c6db57ebb713063c25bf70` | `icons/warbeast.png`, identical | `e09a9deccc0aade5c781e2f97b28a01536ccd321f6e97ead91cbb26c3a515242` |
| `src/resources/units/icons/war_boar.png` | `8321dcdf8125d90789a085cdbba52265158cfd0578c6db57ebb713063c25bf70` | `icons/warbeast.png`, identical | `6fadb84f2a5c3224489bd0b5dfe52a3babb0749dd6b066774ac2347b8fd8bdf4` |

Full hashes, prompts and references are in
`design/arena-unit-sprites/collision-fix/MANIFEST.md` (wave 3 section).

The original is confirmed unchanged after the copy, by content hash:
`arena/warbeast-idle.png` `553d8e6f…`, `icons/warbeast.png` `8321dcdf…`. The
placeholder table's provenance holds: the copiers moved, the original did not.

### The two groups, justified per asset

The ledger's rule is that a row LEAVES only when no two of its members still share
a file. Group by group, naming the blobs whose bytes changed:

| group | blobs that changed | members after | leaves? |
|---|---|---|---|
| arena `[ursine_guardian, warbeast, war_boar]` | `arena/ursine_guardian-idle.png` and `arena/war_boar-idle.png` (both new; `warbeast-idle.png` untouched) | `ursine_guardian` `42405fb5…`, `warbeast` `553d8e6f…`, `war_boar` `cd3f6ece…` — three distinct files | **yes** |
| icon `[ursine_guardian, warbeast, war_boar]` | `icons/ursine_guardian.png` and `icons/war_boar.png` (both new; `warbeast.png` untouched) | `ursine_guardian` `e09a9dec…`, `warbeast` `8321dcdf…`, `war_boar` `6fadb84f…` — three distinct files | **yes** |

No row narrowed, so no row was rewritten, and none was added. Re-measured from
disk after the copy: the arena surface drops 10 groups → **9**, the icon surface
10 → **9** — exactly the two declared rows removed and nothing else.

## 3. The pipeline, run again (not rebuilt)

`design/arena-unit-sprites/collision-cut.mjs` is wave 1's helper, used as it ships
(git blob `90a062f13223e4d46f3a6497cdde2bca2abd696e`, byte-identical to `HEAD` and
unmodified by this change). No second pipeline was written.

**Candidates — three to four per surface, from different image models**, via the
OpenRouter chat-completions image path, with committed prompts
(`design/arena-unit-sprites/prompts/collision-{ursine_guardian,war_boar}-{idle,icon}.txt`)
and two attached references each: the placeholder sprite being replaced (its pixel
size, outline weight and canvas framing) and a same-faction unit whose art is NOT
itself a placeholder (Verdant Wild `forest_scout` for the ursine guardian,
Ironmark Holds `shield_bearer` for the war boar — palette, shading ramp, outline
weight).

| surface | model | candidate | verdict |
|---|---|---|---|
| ursine_guardian idle | `google/gemini-2.5-flash-image` | A | a clean green bear with vine straps, but plainer — no leaf mantle, and it reads closer to a recolour of the incumbent |
| ursine_guardian idle | `google/gemini-3-pro-image` | B | **rejected** — the model painted a WHITE background region enclosed by the figure; the border-seeded flood fill cannot reach it, so a white block survives the cut. 11 components, 571px dropped |
| ursine_guardian idle | `google/gemini-3.1-flash-image` | **C** | **picked** — the richest: a deep moss-green bear with a full oak-leaf mantle over the shoulders and back, bramble harness, amber-gold eyes. One connected component, base band 0.22 |
| ursine_guardian idle | `google/gemini-nano-banana-2.1` | D | returns JPEG, not PNG; not used |
| ursine_guardian icon | `google/gemini-2.5-flash-image` | A | clean green bear bust with an oak-leaf collar, very readable at 64px, but plain |
| ursine_guardian icon | `google/gemini-3-pro-image` | B | **rejected** — shattered on the alpha pass (464 components, 3735px dropped) and left two stray white specks under the bust |
| ursine_guardian icon | `google/gemini-3.1-flash-image` | **C** | **picked** — a leaf-crowned green bear bust matching the idle's mantle; one connected component, no specks |
| ursine_guardian icon | `google/gemini-nano-banana-2.1` | D | JPEG; not used |
| war_boar idle | `google/gemini-2.5-flash-image` | A | a forge-blue boar with a runed iron shoulder plate — but it carries a detached ember puff at the snout, which the cut keeps as a SECOND connected component (a floating fragment on the hex) |
| war_boar idle | `google/gemini-3-pro-image` | B | rich copper-brown boar with brow and shoulder iron, but the same detached ember puff plus a stray orange thread — again kept as a second component (12 components, 4094px dropped) |
| war_boar idle | `google/gemini-3.1-flash-image` | **C** | **picked** — a grey-brown boar with a riveted iron face-plate and shoulder barding, banded tusks, ember-orange eye, no floating breath. One connected component, base band 0.31 |
| war_boar idle | `google/gemini-nano-banana-2.1` | D | JPEG; not used |
| war_boar icon | `google/gemini-2.5-flash-image` | A | a dark blue-black boar bust with a plain iron brow plate, clean and readable |
| war_boar icon | `google/gemini-3-pro-image` | **B** | **picked** — the richest bust: grey-brown bristled boar, rune-riveted iron face-plate and pauldron, banded tusks, snout ring, ember-orange eye; one component |
| war_boar icon | `google/gemini-3.1-flash-image` | C | **rejected** — the head is drawn to the full canvas width and clips at the right edge (x extent 4–123, widest 120) |
| war_boar icon | `google/gemini-nano-banana-2.1` | D | JPEG; not used |

**Model spread, and a reversal.** Three models served usable PNGs on every
surface (`gemini-2.5-flash-image`, `gemini-3-pro-image`, `gemini-3.1-flash-image`)
plus `nano-banana-2.1` as a fourth whose output is JFIF/JPEG. Unlike waves 1 and
2, `google/gemini-3-pro-image` did **not** sweep the picks: it won only the war
boar icon. On the two arena idle surfaces it produced the two worst candidates —
a surviving white background block (ursine) and a detached ember component
(boar) — and on the ursine icon it shattered into 464 components. This is the
opposite of wave 1's finding on a hound and closer to wave 2's on a robed figure:
the pro model's extra internal detail does not reliably survive this pipeline's
flood fill, and it is worth judging every candidate downscaled and after the cut
rather than trusting the model id. No OpenAI id was probed this wave.

**The cut** — one helper, one mode per surface, deterministic, no network:
border-seeded flood fill over the model's fake-transparency background (a uniform
tone or a two-tone checkerboard), a tight halo, detached floaters dropped by
connected component, crop to the alpha bbox, a high-quality smoothed draw into the
128×128 canvas (the same downscale convention as `downscale-arena.mjs`), then
zeroing the 2px edge ring. `idle` draws into a 120×94 box with the base on the
canvas' LAST row; `icon` centres the bust in a 120×120 box.

| metric | ursine_guardian idle | war_boar idle | ursine_guardian icon | war_boar icon |
|---|---|---|---|---|
| dimensions | 128×128 RGBA | 128×128 RGBA | 128×128 RGBA | 128×128 RGBA |
| transparent rows under the feet | **0** | **0** | n/a (centred) | n/a (centred) |
| content rows | 35..127 | 34..127 | 4..123 | 4..123 |
| content height | 93 / 128 (73%) | 94 / 128 (73%) | 120 / 128 | 120 / 128 |
| x extent | 4..123, centre 63.5 | 6..122, centre 64.0 | 10..118, centre 64.0 | 9..118, centre 63.5 |
| widest row | 115 | 117 | 109 | 110 |
| base band / widest row | 25/115 = **0.22** | 36/117 = **0.31** | 11/109 = 0.10 | 22/110 = 0.20 |
| opaque pixels in the 2px top/left/right ring | **0** | **0** | **0** | **0** |

Both arena sprites land with `bottomPad 0` and `ringOpaque 0`: the base is on the
canvas' last row (the hex's south vertex under the `unit.<id>.<pose>` descriptor's
bottom anchor) and the model's fake background is gone from every edge the figure
does not stand on.

## 4. The ledger edit, and the two tests that guard it

`test/data/factionCombatUnitDifferentiation.test.ts` (14 tests before, 15 after):

1. **Two rows deleted** from `OUTSTANDING_DUPLICATE_GROUPS` — arena
   `[ursine_guardian, warbeast, war_boar]` and icon
   `[ursine_guardian, warbeast, war_boar]`. The ledger's doc comment now names
   wave 3 alongside waves 1 and 2.
2. **A new cluster test** — *"the ursine_guardian / war_boar cluster this change
   differentiated ships unique art on every surface"* — asserts every pair inside
   each closed group is now a distinct file, and its message names **both asset
   paths** (`…/arena/ursine_guardian-idle.png and …/arena/warbeast-idle.png are
   still one file — the arena group [ursine_guardian, warbeast, war_boar] must not
   share bytes`). A re-collision of any two named paths fails here and in the
   ledger test, which prints the same pair joined by ` == `.
3. **The footprint contract extended** — `FOOTPRINT_EXACT_ARENA_IDS` gains
   `ursine_guardian` and `war_boar`, so the two new arena sprites are held to the
   same base-on-the-last-row / no-plinth / clean-edge assertions waves 1 and 2
   pinned. The ceiling stays **per-asset** (`MAX_BASE_BAND_RATIO`): 0.50 for the
   quadruped waves — wave 1's hounds measure 0.17 and 0.13 and this wave's bear
   and boar 0.22 and 0.31, all standing on four thin limbs — and 0.85 for wave 2's
   robed pair whose hem IS the stance. A slab that swallows the stance still trips
   it.

## 5. Failing first

This wave's tests were run red the same way waves 1 and 2 did it: the edited test
file with the ORIGINAL four placeholder PNGs still in place, `PGDATABASE=game_poc_wtgui_take_collision_art_wave_3dda5a`,
`npx tsx --env-file=.env.test --test --test-concurrency=1`:

```
✔ … 11 pre-existing tests …
✖ units of different factions share no arena art outside the declared ledger
    two units ship the same arena bytes and no ledger row declares it
    + [ '…/src/resources/units/arena/ursine_guardian-idle.png == …/src/resources/units/arena/warbeast-idle.png == …/src/resources/units/arena/war_boar-idle.png' ]
    - []
✖ units of different factions share no icon art outside the declared ledger
    + [ '…/src/resources/units/icons/ursine_guardian.png == …/src/resources/units/icons/war_boar.png == …/src/resources/units/icons/warbeast.png' ]
    - []
✖ the ursine_guardian / war_boar cluster this change differentiated ships unique art on every surface
    …/src/resources/units/arena/ursine_guardian-idle.png and …/src/resources/units/arena/warbeast-idle.png are still one file
    actual   553d8e6f3c0f5fc93e061f7d4d1a00f54902de63de454131ba68aeffd221d9cf
    expected the same
✖ the new arena art is cut to the iso footprint: base on the last row, no plinth, clean edges
    …/src/resources/units/arena/ursine_guardian-idle.png leaves 16 transparent rows under the feet — the unit would float
    above the hex's south vertex
    111 !== 127
ℹ tests 15
ℹ pass 11
ℹ fail 4
```

Four red, the same count as waves 1 and 2, each naming the asset paths — and the
ledger's own measured-set-equals-declared assertion is what catches the two closed
rows (a group still measured but no longer declared). With the new art in place:
**15 tests, 15 pass, 0 fail**.

## 6. Self-critique (before landing, at the size the game draws)

The user's standing ask on visual work: a self-critique pass before the next
iteration. Run on the four picks, downscaled to the drawn ~64px and magnified,
beside the incumbent:

- **The incumbent `warbeast` is itself a bear** — a brown-grey bear with a wooden
  back plate and a yellow flower garland. So a `ursine_guardian` that is also a
  bear risks reading as a recolour of the very file it replaces. The pick is
  pushed hard the other way: a deep **moss-green** coat (against the incumbent's
  brown), a full **oak-leaf mantle** across the shoulders and back, a bramble
  harness, and amber-gold eyes. At 64px the two read as different animals, and the
  bear that is the verdant *warbeast* is left exactly as it was. **Finding, not
  fixed:** the verdant roster fields two bears (`warbeast`, `ursine_guardian`) —
  a design overlap in the roster itself, not an art defect. It is recorded here
  rather than papered over; a follow-up could re-theme one of them.
- **The war boar** reads unambiguously as ironmark: riveted iron face-plate and
  pauldron, banded tusks, iron-grey hide, ember-orange eye — nothing like the
  verdant bear, on either surface.
- **Two candidates were rejected on evidence, not taste.** The pro model's ursine
  idle left a **white background block** the flood fill cannot reach (an enclosed
  background region), and its war boar idle a **detached ember puff** kept as a
  second connected component. Both would have shipped a visible artifact. This is
  a **pipeline limitation worth knowing** — the helper's border-seeded flood fill
  cannot clear a background region the figure encloses — but the card says run the
  pipeline unchanged, so it is recorded, not patched.
- **The icon/idle coherence** is deliberate: the ursine idle and icon are the same
  model (3.1-flash) with the same leaf-mantle motif; the war boar's idle (3.1) and
  icon (3-pro) share the grey-brown-and-iron palette.

## 7. What this change does NOT prove

- **The new art in the running client.** Verified by measurement (the alpha and
  geometry assertions above) and by eye on the cut PNGs at 128px, at the drawn
  ~64px, and in contact sheets — **not** by a screenshot from the arena. No arena
  screenshot was taken, so nothing here should be read as "seen in the client".
  The `battle-arena-*` visual baselines are unaffected either way, and that is
  checked: they render unit *count* badges on hexes, with no unit sprite drawn in
  any of the captured states, and `npm run test:visual` matched all 13 scenes at
  0.000% after this change.
- **The other 18 groups.** Untouched by instruction. Two sibling cards are live in
  this repository; this wave keeps to its own tree and its own database.
- **The other poses of these units.** `ursine_guardian`, `war_boar` and `warbeast`
  ship attack/move PNGs only for `warbeast` (`warbeast-attack.png`,
  `warbeast-move.png`); the two re-authored units ship only `-idle`, so there is
  no other pose to re-cut. `warbeast`'s other poses are untouched.
- **R3 (`elk_rider = ram_rider`).** Deferred, not skipped — a two-member group
  needs one unit re-authored and does not fit the card's pair-sized scope.
- **The helper hash wave 1 recorded.** Wave 1's manifest records
  `6073599b1a1a673907292f5a00656bba16d88834c27501e9ae8132fa91bbbc07` for
  `collision-cut.mjs`; this wave re-measured the file it actually has — git blob
  `90a062f1…` (unchanged since wave 1 committed it) and sha256 `4d6dc46d…`, the
  same pair wave 2 recorded. Wave 1's `6073599b…` is the outlier (most likely a
  line-ending difference at hash time, `core.autocrlf=true` here). Recorded, not
  re-litigated, and the wave-1 section is not edited.

## 8. Verification actually run

All commands run in this worktree with
`PGDATABASE=game_poc_wtgui_take_collision_art_wave_3dda5a` (the per-worktree
database, so nothing here touches the shared `game_poc`), Node v24.18.0.

| command | result |
|---|---|
| `npx tsx --env-file=.env.test --test --test-concurrency=1 test/data/factionCombatUnitDifferentiation.test.ts` | **15 tests, 15 pass, 0 fail** — the 14 pre-existing tests plus the new cluster test; 4 were red before the art landed (§5) |
| `npm run build` | succeeded (`tsc && vite build`, built in 2.03s) |
| `npm run lint:deps` | no dependency violations (547 modules, 1841 dependencies cruised) |
| `npm run test:types` | `APPLICATION TYPES: clean (0 errors)`; `TEST TREE TYPES: no regressions (296 known errors across 77 files, baseline 296)` — the edited test file adds none |
| `npm run docs:check` | passed — 20 maintained docs, 221 local links, 567 source paths |
| `npm run test:unit` | **3031 tests, 3031 pass, 0 fail** (run on its own, on the first base), and **3041/3041** inside `test:all` on the final base (the siblings' new test files add the rest) |
| `npm run test:visual` | **PASS — all 13 scenes matched their baselines, 0.000% mismatch**, including `battle-arena-legacy`, `battle-arena-scenebuilder` and `battle-arena-default` — new unit art does not move a baseline |
| `npm test` (the CI job's own `test/smoke.ts` entry) | `ALL TESTS PASSED`, run against the per-worktree database |
| `node tools/docs-check.mjs --changed-from github/main` | passed (selective: 16 changed files; freshness enforced for the 4 owned docs) |
| `node tools/test-scope.mjs --changed-from github/main` | `TESTS REQUIRED: 10 of 16 changed file(s) are game code` — which is why the gate's `test:all` was run |
| `npm run test:all` (the repo's own gate: every `tools/run-test.mjs` suite, then `test:unit`) | **`run-test OK` — 18 passed, 0 failed, 0 did not run**, then `test:unit` **3041/3041**, exit 0 |

**One gate gotcha, recorded because it cost a re-run.** `test/smoke.ts` asserts the
gear dropdown's build-info text carries the CURRENT `package.json` version, and it
serves the client through `vite preview` — i.e. the **prebuilt `dist/`**. Running
`npm run build` before the version bump therefore leaves `dist/` stamped with the
old version and smoke fails with `gear dropdown missing version text: v0.53.19
(73b08df)…` while every other suite passes. The fix is to rebuild after the bump
and re-run; the final run above is that run (smoke reported
`v0.53.24`). The order is build → bump → build → test:all.

**A second, smaller collision.** The sibling ram-pens card also appended a
`## Wave 3` section to `design/arena-unit-sprites/collision-fix/MANIFEST.md` (the
building-surface track, a different audit). The rebase conflicted there; both
sections are kept, and this wave's heading now reads
`Wave 3 — … (the unit-sprite track)` with a one-line numbering note, rather than
renumbering or rewriting the sibling's section.

Not run, and why: nothing from the repo's own gate — `npm run test:all` covers the
`test:districts` and `test:cityview` suites it chains, and it is safe here only
because `PGDATABASE` is this worktree's own database; the shared `game_poc` is
never pointed at (the suites delete games).

The four assets were confirmed on disk by content hash after the copy
(`42405fb5ce…`, `cd3f6ecef0…`, `e09a9deccc…`, `6fadb84f2a…`), so the committed
bytes are the cut bytes, not a stale working copy, and the original `warbeast`
art was confirmed unchanged (`553d8e6f…` arena, `8321dcdf…` icon).
