---
name: building-sprite-gen
description: >
  Generate isometric pixel-art building sprites for the game using Gemini image
  generation through the OpenRouter API, style-matched to an existing reference
  sprite, then fix the baked-in checkerboard background to real alpha
  transparency. Use when asked to create or generate a new building sprite,
  game asset image, or style-matched pixel-art PNG.
---

# Building sprite generation (Gemini via OpenRouter)

Generate new isometric building sprites that match the style of the existing
sprite set: chunky pixels, 2:1 dimetric isometric projection, thick dark-brown
outlines, warm brown/tan palette, transparent background, square canvas.

Two project scripts do the work (both plain Node, no build step):

| Script | Purpose |
|---|---|
| `scripts/gemini-buildings.mjs` (in this skill folder) | Sends a reference PNG + prompt to `google/gemini-2.5-flash-image` via the OpenRouter chat-completions API and saves the returned image. Stores no prompts — every invocation passes `--name` plus `--prompt`/`--prompt-file`, so multiple agents can run it concurrently without editing anything. Auto-runs the strip post-pass on every output. |
| `scripts/strip-checkerboard.mjs` (in this skill folder) | Converts the model's fake "transparent" background (a baked-in gray checkerboard) into real alpha. Runs automatically after each generation; also usable standalone. |
| `scripts/remove-specks.mjs` (in this skill folder) | Removes isolated background specks (checker islands the border flood-fill cannot reach) via connected-component analysis. Deletes only non-main, small, low-saturation opaque components — colored details like gold flecks and the main sprite always survive. |
| `scripts/repair-alpha.mjs` (in this skill folder) | Seals the thin transparent seams that over-aggressive stripping can carve along art boundaries — seams that shatter a sprite into disconnected fragments with see-through slits (the drake commander sprites failed exactly this way). Bridges seams, re-opens legit enclosed background, fills enclosed holes, snaps interior partial-alpha pixels. Runs automatically after each generation; also usable standalone with `--check` as a clean/damaged gate. |

## Prerequisites

- `OPENROUTER_API_KEY` set in the environment (the script reads
  `process.env.OPENROUTER_API_KEY` and exits if missing). Each team member uses
  their own key — never commit one, never put it in `.env` contents that get
  shared. Get one at openrouter.ai (keys page). Every generation bills a small
  amount to that account's credits.
- `playwright` (already a dev dependency — the strip script uses its bundled
  Chromium for canvas pixel work).

## Workflow

### 1. Write the prompt

The style match comes almost entirely from the attached reference image
(`src/resources/buildings/building-pixel-granary-1.png`), so keep this shape —
style paragraph + subject + plot composition:

```
Isometric pixel art game asset for a medieval city-builder, matching the
attached reference image exactly in style: same chunky pixel size, same 2:1
dimetric isometric projection (standard 30° angle), same thick dark-brown
outlines around every shape, same warm brown/tan color palette, same
transparent background, square 1:1 canvas.

Subject: <one paragraph describing the building and its materials, roof,
door/windows, decorations>.

Plot: a square 20x20 meter lot shown as a diamond, topped with light sandy
ground with darker speckles and a few tiny grass tufts, and a thin darker
soil slab visible along the front two edges. <one paragraph on yard props,
positioning, and how much of the footprint the building covers>.

Single centered asset, nothing outside the plot, clean pixel-art shading,
no anti-aliasing halos, no text, no watermark.
```

Tips learned from the first run (woodcutter's hut):

- Spell out concrete composition facts (building ~40% of footprint, yard props
  by side, stepping stones from the door) — the model follows them well.
- Known limitation: the output's pixel grain tends to come out finer than the
  reference. If it matters, add an explicit "use the reference's chunky pixel
  size, larger pixels" and regenerate. Each run costs one generation.

### 2. Generate — pass the prompt as arguments (no script edits)

Write the prompt to a temp text file (most robust — avoids shell quoting
issues with long multi-paragraph prompts), then run:

```
node .kilo/skills/building-sprite-gen/scripts/gemini-buildings.mjs `
  --name building-pixel-<camelCaseName>-<level>.png `
  --prompt-file <prompt.txt>
```

For short single-line prompts, `--prompt "<text>"` works inline instead of
`--prompt-file`. Naming convention matches the existing set:
`building-pixel-<camelCaseName>-<level>.png` in `src/resources/buildings/`
(the script warns if the name deviates). Output always lands in
`src/resources/buildings/`.

Useful flags:

| Flag | Meaning |
|---|---|
| `--name <file>` | output file name (required) |
| `--prompt <text>` | the prompt inline — mutually exclusive with `--prompt-file` |
| `--prompt-file <path>` | read the prompt from a UTF-8 text file |
| `--ref <path>` | override the style-reference PNG (default: the granary sprite) |
| `--no-strip` | skip the automatic checkerboard strip after generation |
| `--dry-run` | print jobs, output path, reference, prompt size — no API call, no billing |
| `--help` | full flag list |

**Always `--dry-run` first** to verify the name, output path, and prompt
resolved correctly before spending a billed generation.

Because the script stores no prompts and each run is fully argument-driven,
several agents can generate different sprites at the same time — no shared
file is ever edited.

### 3. Strip the fake checkerboard (automatic)

Gemini renders "transparent background" as a literal gray checkerboard baked
into the pixels. The generator already runs
`strip-checkerboard.mjs` on every output automatically (opt out with
`--no-strip`). Run it manually only when cleaning a file some other way:

```
node .kilo/skills/building-sprite-gen/scripts/strip-checkerboard.mjs src/resources/buildings/<file>.png
```

If small white/gray specks survive afterwards (isolated islands the border
flood-fill cannot reach), clean them with:

```
node .kilo/skills/building-sprite-gen/scripts/remove-specks.mjs src/resources/buildings/<file>.png
```

### 4. Repair alpha seams (automatic)

Stripping can over-erode: 1-5px transparent seams along art boundaries that
shatter the sprite into disconnected opaque fragments with see-through slits
(this happened to the drake commander sprites, which needed a manual repair —
one came out in 95 disconnected pieces). `gemini-buildings.mjs` therefore runs
`repair-alpha.mjs` on every output right after the strip pass (opt out with
`--no-repair`). It seals transparent channels up to 3px wide that have art on
both sides, re-opens any legit background pocket the bridging accidentally
enclosed (wing scallops, under-belly windows), fills remaining enclosed holes
above the under-belly line, and snaps interior partial-alpha pixels to opaque.
Existing opaque pixels' RGB is never modified, and a file with no detected
defects is left byte-identical — it is safe to run repeatedly.

Run it manually on any PNG that was hand-edited or cleaned by other means:

```
node .kilo/skills/building-sprite-gen/scripts/repair-alpha.mjs src/resources/buildings/<file>.png
```

`--check` reports defects without writing and exits 1 when it finds any
(enclosed holes above the under-belly line, interior partial-alpha pixels, or
heavy fragmentation), so it works as a CI-able gate:

```
node .kilo/skills/building-sprite-gen/scripts/repair-alpha.mjs src/resources/buildings/*.png --check
```

Small detached islands (foot-claw highlights etc.) and enclosed pockets in the
bottom third of the sprite are reported but are never touched.

### 5. Verify visually

Open the PNG (or have the agent read it as an image) and check: all requested
elements present, no checker remnants, background actually transparent, sprite
intact at the edges.

## Not covered here (separate code task)

A generated PNG is just a file until it is wired into the game. That requires
touching `src/render/assetDescriptors.ts` (descriptor + key), the
`BuildingKind` type in the city-building code, and possibly the FLUX-era
`manifest.mjs`. Check how `building-pixel-granary-*.png` is (or is not yet)
referenced and follow that pattern. Also note `docs` (`src/render/docs/
technical-spec.md` §5) lists the sprite tools and may deserve an entry for the
new scripts.
