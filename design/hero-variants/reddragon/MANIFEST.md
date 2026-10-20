# Hero variant wave — `reddragon` ("Red Dragon Rider")

Per-file provenance for the `reddragon` mounted-hero variant, following the
"Metadata for Future Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `reddragon` / `Red Dragon Rider` / `commander-16` |
| Base character | a repaint of the existing `drake` (`commander-9/drake-{n,e,s,w}.png`) — same chunky pixel-art dragon and rider, same saddle, helmet and pose |
| Generation date | 2026-10-19–20 (local; requests finished 2026-10-20T05:05Z) |
| Provider / model | OpenRouter `google/gemini-3.1-flash-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` with `--subject dragon` and `--pose-ref` |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `93ecc6780a174d7a4c8e45d0214d1b00f57f1f3389d0a774803b20ac054d97ad` |
| Front-diagonal prompt | [`prompt-front-diagonal.txt`](./prompt-front-diagonal.txt) — `prompt.txt` plus the explicit three-quarter composition rule, sha256 `7398d5b5f3ad0d7eb1958963ca101be5afc0570c2192bb1e78b75a4d5d292301` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `74774d047da34567bb67ce3f85846bf2806023695e47e68d10cb5919675692ec` |
| Masters (1024²) | `design/hero-variants/reddragon/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-16/reddragon-{n,ne,e,se,s,sw,w,nw}.png` (512×512 RGBA), `src/resources/hero-banner-reddragon.png` (320×100) |

## Reference images handed to the model

| Output | Reference | sha256 |
|---|---|---|
| `reddragon-n.png` | `commander-9/drake-n.png` | `a4d40fa4cb1c830d01f1f41a786d9ee59f9c63238db933bfbd8ed0a664c20aee` |
| `reddragon-e.png` | `commander-9/drake-e.png` | `94c4239232c7277b93fdd8ef7d278d6bca35f92956f1f6e9e7c0ec088a04caaf` |
| `reddragon-s.png` | `commander-9/drake-s.png` | `c1bf0986add9873bfd7fe75dfaca924b2233852752c756d2b41c2febb5623344` |
| `reddragon-w.png` | `commander-9/drake-w.png` | `711b4b5fa370bc930b30bb273f19679084d104d9789958e975d29bd2d09d376e` |
| `reddragon-ne.png` | `commander-16/reddragon-e.png` (pose-ref `e`) | `ccbc10771d4989fa27c98fd4b6d882b37ca542ed071906d819dea278653ca216` |
| `reddragon-nw.png` | `commander-16/reddragon-w.png` (pose-ref `w`) | `e1deb8c7aaf64705d479048f4d3aa7fe5dc56d9bc324ca6d4375ac7b7e7e0a3f` |
| `reddragon-se.png` (committed) | `commander-16/reddragon-s.png` (pose-ref `s`) | `17216fb40013b9ddc53a6603c044bba732ea73417c56e487ee9ca7a7006db060` |
| `reddragon-sw.png` (committed) | `commander-16/reddragon-s.png` (pose-ref `s`) | `17216fb40013b9ddc53a6603c044bba732ea73417c56e487ee9ca7a7006db060` |
| `hero-banner-reddragon.png` | `src/resources/hero-banner-drake.png` | `291cb688909e78dfc072b02053815bb667d898b5c766d03d485ce32dd8553051` |

**`se`/`sw` correction.** The first diagonals were re-posed from the east and
west profiles, but at 64×64 their mean absolute error against `e`/`w` was only
~4.0 and ~4.9 — the same side pose at map size. Both were regenerated from the
front (`s`) reference with the explicit three-quarter composition rule; the
committed `se` is head-right and `sw` is head-left, and the closest remaining
pair (`w`/`nw`, 10.0) is the expected rear-quarter overlap, not a duplicate.

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the
flat grey model background (RGB distance tolerance 26), soft 2px boundary
matte, then a trim and Lanczos3 resize copying the *reference* sprite's alpha
bounding box — same content height, same bottom edge, same centre x on a
512×512 canvas. This variant ships base frames only (no `-2` gallop files, like
lionheart/paladin2/frostwarden); both run frames resolve to the base sprite.

| Output | Alpha bbox (x,y,w,h) |
|---|---|
| `reddragon-n.png` | 106,67 304×399 |
| `reddragon-ne.png` | 28,56 413×402 |
| `reddragon-e.png` | 19,57 431×402 |
| `reddragon-se.png` | 63,46 385×415 |
| `reddragon-s.png` | 38,47 435×415 |
| `reddragon-sw.png` | 38,46 434×415 |
| `reddragon-w.png` | 73,85 402×376 |
| `reddragon-nw.png` | 75,84 398×376 |

The banner is a full painted scene (no alpha): the model output is
cover-cropped to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — legacy manifest/buildings and the horse
  run-frame gate (this variant has none).
- `npm run build` + `npm run test:unit` — registry, contracts, descriptors,
  and `test/render/dragonRiderArt.test.ts` (eight distinct 512px files).
- `npm run test:heroVariants` — recruits the variant in a real game, resolves
  all eight descriptors plus the banner, and A/B diffs the same map tile
  against the drake (`reddened` palette signal).
