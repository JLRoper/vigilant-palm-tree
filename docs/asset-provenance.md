# Asset Provenance

<!-- docs:verified 2026-10-11 -->

This page indexes the available asset workflows and records what provenance can and cannot currently be reconstructed. A generator's current default is not evidence of the model, prompt, or seed used for an older PNG. Do not invent missing history.

## Asset Locations and Workflows

| Family | Source/output locations | Workflow and checks |
|---|---|---|
| Pixel buildings | `src/resources/buildings/`; generation notes in `design/building-pixel-wave/` | [`building-sprite-gen` skill](../.kilo/skills/building-sprite-gen/SKILL.md) uses a reference sprite, Gemini/OpenRouter generation, checkerboard stripping, and optional speck cleanup. `tools/sprites/gen-building-sprite-keys.mjs` generates the key map; `gen-building-anchors.mjs` generates alpha-bound offsets. The **shipyard** (2026-10-18) is the one exception: `tools/sprites/gen-shipyard-sprite.mjs` rasterises `building-pixel-shipyard-{1,2,3}.png` deterministically (no model, no API, byte-stable), so those three files have exact committed provenance — script, palette and geometry — rather than an inferred one. |
| Arena units and hero-panel icons | `src/resources/units/arena/`, `src/resources/units/icons/`; wave prompts/helpers under `design/arena-unit-sprites/` | Arena descriptors are glob-driven. The committed 128×128 outputs have catalog/art coverage tests; helper scripts document the downscale and alpha-border gates. Some 1024px masters are gitignored. |
| Castles and resources | `src/resources/`; procedural and FLUX generator scripts under `tools/sprites/` | `tools/sprites/manifest.mjs`, generator scripts, and `tools/sprites/validate-assets.mjs` cover the legacy manifest and current drift gates. |
| Faction banners | `src/resources/factions/` | `assetDescriptors.ts` discovers banner files with a glob; roster/banner parity is checked by `test/data/unitCatalogParity.test.ts`. |
| Hero banners | `src/resources/` | One 320×100 `hero-banner-<id>.png` per `HORSE_VARIANT_REGISTRY` variant, hand-wired in `HERO_BANNERS` (`src/render/assetDescriptors.ts`). Lionheart banner (2026-10-11): OpenRouter `google/gemini-3.1-flash-image` pinned to `google-vertex/global`, `hero-banner-hero.png` as style reference. Paladin 2 banner (2026-10-18): same model/provider, `hero-banner-paladin.png` as the composition/style reference; full record in [`design/hero-variants/paladin-2/MANIFEST.md`](../design/hero-variants/paladin-2/MANIFEST.md). |
| Horse variants and run frames | `src/resources/units/horse/commander-*/` | Registry-driven descriptors; `tools/sprites/tune-run-frames.mjs --check` verifies base/frame existence and alignment. Lionheart (2026-10-11, `commander-10/lionheart-{n,e,s,w}.png`): OpenRouter `google/gemini-3.1-flash-image` pinned to `google-vertex/global` (Nano Banana line; `google/gemini-nano-banana-2.1` is only offered on Google AI Studio and quota-blocked), samurai/drake sprites as style references, four cardinal directions, base frames only (no `-2` files). Paladin 2 (2026-10-18, `commander-11/paladin2-{n,ne,e,se,s,sw,w,nw}.png`): same model/provider, the existing paladin's per-direction sprites as pose/style references, all eight directions, base frames only; prompts, reference hashes and per-file alpha bounds in [`design/hero-variants/paladin-2/MANIFEST.md`](../design/hero-variants/paladin-2/MANIFEST.md), generated with `tools/sprites/gemini-hero-sprite.mjs`. |
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
