# Give the colliding seat factions their own unit art — the first pair

Worked 2026-11-07 in `C:/ProjectDevelopment/heroes-js/.worktrees/give-the-colliding-seat-9814e8`
on branch `wtgui/give-the-colliding-seat-9814e8`, rebased onto `github/main` at
**0.53.14** (`4e38cd5`, merge of #375) before anything below was measured.

The card asked for the whole sprite-collision surface to be worked **in order,
one pair at a time**, with the pipeline proven end to end on the FIRST colliding
seat-faction pair. This is that first pair. The other 23 duplicate groups are
not attempted here — §5 lists them, one card each.

---

## 1. The measurement report this card started from

`analysis/2026-11-07-faction-combat-unit-differentiation.md` was copied out of the
worktree that produced it
(`.worktrees/faction-combat-unit-diff-f50e40/analysis/…`) into the primary
checkout's own `analysis/` directory, and the two copies hash equal
(sha256 `2232a2f4…`, 7,491 bytes). That worktree was still live, so no
reconstruction was needed; the file is also already on `github/main` via #375, so
the primary checkout's copy is that file restored into a tree whose local `main`
still sits at `a080d8d`.

Its counts reproduce exactly: **12** duplicate groups in the arena idle set and
**13** in the icons. Its escalation E1 is the surface this card fixes.

## 2. The audit — the asset paths, and the test that demands the new art

Nothing was overwritten until the paths below were named and the test that
expects the new art was red. The four files this change replaces, all shipped as
byte-identical placeholder copies by the 2026-10-22 roster expansion
(`design/arena-unit-sprites/roster-parity-placeholder-art.md`):

| asset | sha256 (before) | shares bytes with |
|---|---|---|
| `src/resources/units/arena/grave_hound-idle.png` | `c79a9bc143f2a053…` | `src/resources/units/arena/warhound-idle.png` (identical) |
| `src/resources/units/arena/warhound-idle.png` | `c79a9bc143f2a053…` | the same file |
| `src/resources/units/icons/grave_hound.png` | `5b39d394caaa6055…` | `src/resources/units/icons/warhound.png` (identical) |
| `src/resources/units/icons/warhound.png` | `5b39d394caaa6055…` | the same file |

The test that expects the new art is the existing suite
`test/data/factionCombatUnitDifferentiation.test.ts`, extended rather than
duplicated (9 tests before, 13 after). Its new SPRITES section measures the
duplicate groups by content hash and pins them as a **ledger** — every group
still outstanding is declared, and the assertion is that the measured set EQUALS
the ledger — so landing unique art for a group means deleting its row, and a row
may not be added back.

Red before the art landed (verbatim, `PGDATABASE=game_poc_wtgui_give_the_colliding_seat_9814e8`,
`npx tsx --test --test-concurrency=1`):

```
✔ the four seat factions field twelve units each and share none between them
✔ … 8 further pre-existing tests …
✖ units of different factions share no arena art outside the declared ledger
    two units ship the same arena bytes and no ledger row declares it
    + [ '…/src/resources/units/arena/grave_hound-idle.png == …/src/resources/units/arena/warhound-idle.png' ]
    - []
✖ units of different factions share no icon art outside the declared ledger
    + [ '…/src/resources/units/icons/grave_hound.png == …/src/resources/units/icons/warhound.png' ]
✖ the seat-faction pair this change differentiated ships unique art on both surfaces
    …grave_hound-idle.png and …warhound-idle.png are still one file
    actual c79a9bc143f2a0531577e9476b0442cd04c054e445f887ab2cc24354ae7a017c
    expected the same
✖ the new arena art is cut to the iso footprint: base on the last row, no plinth, clean edges
    …grave_hound-idle.png leaves 16 transparent rows under the feet — the unit would float
    above the hex's south vertex
    111 !== 127
# tests 13  # pass 9  # fail 4
```

The footprint test is red for a second, independent reason: the shipped hound is
**not** cut to the grid. See §4.

## 3. The measurement — every duplicate group, re-measured here

Method: content hash (sha256) of each shipped PNG, grouped, keeping groups with
more than one member. Arena = `src/resources/units/arena/<id>-idle.png` for the
51 catalog ids that ship one (the mage has no arena art at all); icons =
`src/resources/units/icons/<id>.png` for all 52. Read from disk, not from prose.

**Arena idle — 12 groups, 5 of them cross-faction** (51 files):

```
axe_thrower = dwarf_axeman = tunnel_levy        ironmark (same faction)
black_dragon = bone_dragon                      neutral = ashen
bone_pikeman = skeleton_warrior                 ashen (same faction)
bramble_blade = briar_warden                    verdant (same faction)
dark_acolyte = wraith                           ashen (same faction)
druid = hearth_priest = runesmith               verdant = ironmark
elk_rider = ram_rider                           verdant = ironmark
grave_hound = warhound                          ashen = human      <-- FIXED HERE
lich = necromancer                              ashen (same faction)
sproutling = treant_elder                       verdant (same faction)
thorn_archer = wildwood_ranger                  verdant (same faction)
ursine_guardian = warbeast = war_boar           verdant = ironmark
```

**Icons — 13 groups, 5 of them cross-faction** (52 files):

```
axe_thrower = dwarf_axeman = tunnel_levy        ironmark (same faction)
black_dragon = bone_dragon                      neutral = ashen
bone_pikeman = skeleton_warrior                 ashen (same faction)
bramble_blade = briar_warden                    verdant (same faction)
dark_acolyte = wraith                           ashen (same faction)
druid = mage                                    verdant = human
elk_rider = ram_rider                           verdant = ironmark
grave_hound = warhound                          ashen = human      <-- FIXED HERE
hearth_priest = runesmith                       ironmark (same faction)
lich = necromancer                              ashen (same faction)
sproutling = treant_elder                       verdant (same faction)
thorn_archer = wildwood_ranger                  verdant (same faction)
ursine_guardian = warbeast = war_boar           verdant = ironmark
```

25 groups. **Three of the six seat-faction pairs collide**: human↔ashen
(`grave_hound = warhound`, both surfaces — the pair landed here), human↔verdant
(`druid = mage`, icons), ironmark↔verdant (`druid = hearth_priest = runesmith`
arena, `elk_rider = ram_rider` and `ursine_guardian = warbeast = war_boar` both
surfaces). Ashen also collides with the neutral catalog (`bone_dragon =
black_dragon`). Eleven of the 25 groups are *within* one faction, which is the
same defect on a less visible surface (a player can field both units).

## 4. The pipeline, proven end to end on the first pair

**Pair:** ashen `grave_hound` vs human `warhound` — the first row of the card's
table, and the collision the shipped art makes most obvious (an undead faction's
hound is literally the living faction's dog).

**Candidates — three to four per unit per surface, from different image models.**
Generated with `openrouter-image.mjs` (the OpenRouter chat-completions image
path) from the prompts committed at
`design/arena-unit-sprites/prompts/collision-{grave_hound,warhound}-{idle,icon}.txt`,
each with a shipped sprite attached as the style reference:

| unit / surface | model | candidate | verdict |
|---|---|---|---|
| grave_hound idle | `google/gemini-2.5-flash-image` | A | readable, but flat shading and a curl in the tail that reads as a second limb at 64px |
| grave_hound idle | `google/gemini-3-pro-image` | **B** | **picked** — ribcage and skull resolve, ember eye reads, best contrast, base band 17% |
| grave_hound idle | `google/gemini-3.1-flash-image` | C | good, but paler and its mist wisps shatter into 34 components on the alpha pass |
| grave_hound idle | `google/gemini-nano-banana-2.1` | D | returns JPEG, not PNG; not used |
| warhound idle | `google/gemini-2.5-flash-image` | A | matches the reference hound, slightly flat |
| warhound idle | `google/gemini-3-pro-image` | **B** | **picked** — richest coat and harness detail, base band 13% |
| warhound idle | `google/gemini-3.1-flash-image` | C | matches, but washed out and a 41% base band (the paws merge with a soft contact shadow) |
| warhound idle | `google/gemini-nano-banana-2.1` | D | JPEG; not used |
| grave_hound icon | `google/gemini-2.5-flash-image` | A | bust reads, but a torn fragment on the left edge survives the floater pass |
| grave_hound icon | `google/gemini-3-pro-image` | **B** | **picked** — cleanest bust, glowing socket, tattered hide, spiked collar |
| grave_hound icon | `google/gemini-3.1-flash-image` | C | clean but paler |
| grave_hound icon | `google/gemini-nano-banana-2.1` | D | JPEG; not used |
| warhound icon | `google/gemini-2.5-flash-image` | A | good, highlights run yellow |
| warhound icon | `google/gemini-3-pro-image` | **B** | **picked** — richest brindle, harness and collar crisp |
| warhound icon | `google/gemini-3.1-flash-image` | C | good, flatter |

`google/gemini-3-pro-image` won all four picks — which is the outcome the sprite
skill predicts (the pro model "keeps the reference's pixel scale and outline
weight while resolving visibly more NEW detail… where flash flattens it"), and it
is why every pick is a 3-pro output. OpenAI's image models could not be used at
all on this date: `openai/gpt-5.4-image-2` and `openai/gpt-5-image-mini` both
return HTTP 502 `Complexity 'none' is not supported for this image model`, and
`openai/gpt-5-image` 502s with `The model gpt-image-1 has been deprecated` — so
the three-model spread is three Google models (2.5-flash-image, 3-pro-image,
3.1-flash-image) plus nano-banana-2.1 as a fourth whose output is JPEG.

**The cut** — `design/arena-unit-sprites/collision-cut.mjs`, committed with this
change (pngjs + bundled Chromium, no network, deterministic): border-seeded flood
fill over the model's fake-transparency background (one uniform tone **or** a
two-tone checkerboard), a tight halo, detached-floaters dropped by connected
component, crop to the alpha bbox, then a high-quality smoothed draw into the
128×128 canvas — the same downscale convention as the wave's own
`downscale-arena.mjs` — followed by zeroing the 2px edge ring.

The card's four requirements, each a measurement rather than a claim:

- **"cut to the iso grid EXACTLY… onto the iso footprint."** The descriptor for
  every unit sprite is `anchor: "bottom"` with **no `anchorOffsetY`**, and the
  painter's own comment says that anchor means "feet at the hex's south vertex".
  It puts the *canvas' last row* at that vertex, so the base lands on the
  footprint only when the lowest opaque row IS the last row. The new pair is cut
  that way — `bottomPad 0` for both, asserted. The shipped family is not: the 51
  arena idle sprites carry **2–19** transparent rows under the feet (the old hound
  carried 16), so every one of them floats above its hex by up to ~8px at the
  drawn size. The new pair stands on the footprint; normalising the rest is
  follow-up work (§5, and it is a per-sprite re-cut, not a descriptor change —
  adding a per-unit `anchorOffsetY` would be the building family's generated-table
  pattern, not a hand-edit).
- **"real alpha."** No model returns usable transparency (Gemini paints a
  checkerboard; 3-pro sometimes paints flat white). Measured after the pass: the
  top 2 rows and both side 2-px columns are fully transparent on both new sprites
  (`ringOpaque 0`), asserted.
- **"NO thick ground plinth."** The cut reports the base band (the widest opaque
  row in the bottom 3) against the widest row: **0.17** for grave_hound and
  **0.13** for warhound, against **0.17** for the shipped hound it replaces —
  i.e. the feet, not a slab. The test pins a ceiling of 0.50 for the authored
  assets. Calibration note: the shipped population spans 0.12–1.00 (the lich's
  robe hem and the thorn archer's stance legitimately reach 1.00), so this is a
  guard on the new art, **not** a family-wide rule, and it is not asserted
  family-wide.
- **"iso grid… exactly"** also means square 128×128 (the descriptor's
  `naturalSize`), centred on the hex's vertical axis (both new sprites land at
  x-centre 63.5–64.0 against the axis 63.5), and the figure at the family's
  content scale (94 of 128 rows = 73% of the canvas; the shipped hound is 88 =
  69%, the family 2–19 rows of pad aside).

**The pair's own distinctness** is asserted directly as well: the two hounds'
arena bytes and icon bytes now differ (`5acafdd1…` vs `400995e7…`, `4854d78c…` vs
`411e85a8…`), so ashen and human are no longer the same sprite on either surface.

## 5. REMAINING — one card per duplicate group

23 groups remain (25 measured minus the 2 closed by this change). Each is the
same defect: a unit shipping another unit's file. They are listed in the order the
collision report named them, seat-faction collisions first, because those are the
ones that make two *factions* indistinguishable. "Same faction" rows still cost
the player: both units can be fielded at once.

### Seat-faction collisions (the ones that make two factions look alike)

**R1 — verdant `druid` = human `mage` (icons).** The last colliding seat pair not
touched here. Human↔verdant. Card: author a druid icon and a mage icon (the mage
has no arena art either — `EXPECTED_ARENA_GAPS` in
`test/render/unitArenaDescriptors.test.ts` — so a druid/mage wave can close both).

**R2 — verdant `druid` = ironmark `hearth_priest` = ironmark `runesmith` (arena
idle).** Ironmark↔verdant, and an intra-faction collision underneath it (hearth
priest and runesmith share bytes). Three sprites, one card.

**R3 — verdant `elk_rider` = ironmark `ram_rider` (arena idle + icons).**
Ironmark↔verdant on both surfaces.

**R4 — verdant `ursine_guardian` = verdant `warbeast` = ironmark `war_boar`
(arena idle + icons).** Ironmark↔verdant plus an intra-verdant collision.

### Neutral collisions

**R5 — neutral `black_dragon` = ashen `bone_dragon` (arena idle + icons).** The
ashen faction's dragon is the neutral catalog's living dragon. `roster-parity-placeholder-art.md`
names bone_dragon ← black_dragon explicitly.

### Within-faction collisions

**R6 — ironmark `axe_thrower` = `dwarf_axeman` = `tunnel_levy` (arena idle +
icons).** Three ironmark units, one sprite; two of them are placeholders for
dwarf_axeman.

**R7 — ashen `bone_pikeman` = `skeleton_warrior` (arena idle + icons).**

**R8 — verdant `bramble_blade` = `briar_warden` (arena idle + icons).**

**R9 — ashen `dark_acolyte` = `wraith` (arena idle + icons).**

**R10 — ashen `lich` = `necromancer` (arena idle + icons).**

**R11 — verdant `sproutling` = `treant_elder` (arena idle + icons).**

**R12 — verdant `thorn_archer` = `wildwood_ranger` (arena idle + icons).**

**R13 — ironmark `hearth_priest` = `runesmith` (icons only).** The arena half is
inside R2; this is the icon half.

### Not a duplicate group, but the same surface

**R14 — arena bottom-pad normalisation.** Not a collision, a framing defect: the
51 shipped arena idle sprites carry 2–19 transparent rows under the feet, and the
shared descriptor floats every one of them above the hex's south vertex. The pair
landed here is cut to 0; the rest need a re-cut (or the building family's
generated per-unit anchor table). Measured, not inferred — the numbers are in §4.

## 6. What this change does NOT prove

- **The other 23 groups.** Not attempted, by instruction; each is a per-unit art
  card (R1–R13 above, one per group).
- **The pair in the running client.** The new art is verified by measurement (the
  alpha/geometry assertions) and by eye at 128px and at the drawn ~64px, not by a
  screenshot from the arena. The `battle-arena-*` visual baselines are unaffected
  either way: they render unit *count* badges on hexes, with no unit sprite drawn
  in any of the three captured states (checked in
  `test/visual-baselines/battle-arena-default.png`).
- **The other two poses of the warhound.** `warhound-attack.png` and
  `warhound-move.png` are unique to the warhound and are untouched, so they still
  carry the old framing (20 and 27 rows of bottom pad). They are not part of the
  collision surface; re-cutting them belongs to R14.
- **Attribution/licence of the model output.** The generated PNGs are raw
  OpenRouter model output with no seed exposed; the per-wave manifest records the
  model id, prompt file and reference per the repo's metadata convention, and
  nothing about training-data provenance.

---

## 7. Verification actually run

All commands run in this worktree with `PGDATABASE=game_poc_wtgui_give_the_colliding_seat_9814e8`
(the per-worktree database — nothing here touches the shared `game_poc`), Node v24.18.0.

| command | result |
|---|---|
| `npx tsx --env-file=.env.test --test --test-concurrency=1 test/data/factionCombatUnitDifferentiation.test.ts` | **13 tests, 13 pass, 0 fail** — the 9 pre-existing tests plus the 4 new ones (two ledger tests, the pair test, the footprint test), which were red before the art landed (§2) |
| `npx tsc --noEmit -p tsconfig.json` (the application tree) | clean, 0 errors |
| `npm run test:types` | `APPLICATION TYPES: clean (0 errors)`; `TEST TREE TYPES: no regressions (302 known errors across 78 files, baseline 302)` — the new test file adds none (its PNG read is a local decoder, not an untyped `pngjs` import) |
| `npm run test:unit` | **3015 tests, 3015 pass, 0 fail** |
| `npm run lint:deps` | no dependency violations (544 modules, 1827 dependencies) |
| `npm run docs:check` | passed — 20 maintained docs, 221 local links, 567 source paths |
| `npm run build` | succeeded (`tsc && vite build`, built in 2.30s) |
| `npm run test:visual` | **PASS — all 13 scenes matched their baselines, 0.000% mismatch**, including `battle-arena-legacy`, `battle-arena-scenebuilder` and `battle-arena-default`. This is the check that answers "does new unit art move a baseline": it does not, because the arena scenes render unit *count* badges, not sprites. |
| `npm test` (the CI job's own `test/smoke.ts` entry) | see the PR body; run against the per-worktree database |

Not run, and why: `npm run test:districts` and `npm run test:cityview` (city-view
suites — this change touches no settlement, economy or city code, and neither
suite reads unit art), and `test:all` (it would wipe the shared `game_poc`
database while sibling worktrees are live, which the repo forbids).

The four assets were confirmed on disk by content hash after the copy
(`5acafdd107c61eaa…`, `400995e719afd321…`, `4854d78cd14c3802…`, `411e85a84ae61b4c…`,
the full hashes recorded in `design/arena-unit-sprites/collision-fix/MANIFEST.md`),
so the committed bytes are the cut bytes, not a stale working copy.
