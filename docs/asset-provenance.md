# Asset Provenance

<!-- docs:verified 2026-10-11 -->

This page indexes the available asset workflows and records what provenance can and cannot currently be reconstructed. A generator's current default is not evidence of the model, prompt, or seed used for an older PNG. Do not invent missing history.

## Asset Locations and Workflows

| Family | Source/output locations | Workflow and checks |
|---|---|---|
| Pixel buildings | `src/resources/buildings/`; generation notes in `design/building-pixel-wave/` | [`building-sprite-gen` skill](../.kilo/skills/building-sprite-gen/SKILL.md) uses a reference sprite, Gemini/OpenRouter generation, checkerboard stripping, and optional speck cleanup. `tools/sprites/gen-building-sprite-keys.mjs` generates the key map; `gen-building-anchors.mjs` generates alpha-bound offsets. |
| Arena units and hero-panel icons | `src/resources/units/arena/`, `src/resources/units/icons/`; wave prompts/helpers under `design/arena-unit-sprites/` | Arena descriptors are glob-driven. The committed 128×128 outputs have catalog/art coverage tests; helper scripts document the downscale and alpha-border gates. Some 1024px masters are gitignored. |
| Castles and resources | `src/resources/`; procedural and FLUX generator scripts under `tools/sprites/` | `tools/sprites/manifest.mjs`, generator scripts, and `tools/sprites/validate-assets.mjs` cover the legacy manifest and current drift gates. |
| Faction banners | `src/resources/factions/` | `assetDescriptors.ts` discovers banner files with a glob; roster/banner parity is checked by `test/data/unitCatalogParity.test.ts`. |
| Horse variants and run frames | `src/resources/units/horse/commander-*/` | Registry-driven descriptors; `tools/sprites/tune-run-frames.mjs --check` verifies base/frame existence and alignment. |
| Skyboxes | `src/resources/skybox/` | Generation/splitting workflow is documented in [`src/render/docs/technical-spec.md`](../src/render/docs/technical-spec.md); `src/render/skybox.ts` owns URLs and caches. |

Additional design references: [`sprite-pipelines.md`](./sprite-pipelines.md), [`isometric-building-prompts.md`](./isometric-building-prompts.md), and the [render technical spec](../src/render/docs/technical-spec.md). `npm run validate-assets` checks the legacy manifest, generated building keys/anchors, and horse run-frame gates. BuildingKind level coverage is a separate exhaustive declaration/test, not codegen.

## Provenance Gaps

Existing assets do not have a complete committed per-file manifest connecting every final PNG to its exact prompt, provider/model, request date, seed, reference image, and post-processing run. Some prompt folders and helper scripts are present; some masters and local logs are ignored. The current skill's default model or a neighboring prompt must not be attributed to a historical image without evidence.

## Metadata for Future Art

For each new asset, record these fields in a committed per-wave manifest or adjacent metadata file. Use `unknown` when unavailable; do not infer values from current defaults.

- Final asset path and registry/family key.
- Generation date and provider/model identifier; request/job ID and seed if exposed.
- Exact prompt text or a committed prompt-file path, plus the prompt file hash if it may change.
- Reference-image path and content hash; state whether the model received it.
- Source/master image path and whether it is committed or intentionally gitignored.
- Downscale, alpha repair, crop, padding, outline, and other post-processing commands/tool versions.
- Output dimensions, projection/style requirements, transparency/edge acceptance result, and validation command/result.
- Any known attribution/license restrictions supplied with the generation service or source art.
