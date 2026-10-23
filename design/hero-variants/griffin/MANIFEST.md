# Hero variant wave — `griffin` ("Griffin Rider")

Per-file provenance for the `griffin` mounted-hero variant, following the
"Metadata for Future Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `griffin` / `Griffin Rider` / `commander-17` |
| Base character | a repaint of the existing `drake` (`commander-9/drake-{n,e,s,w}.png`), re-speciated from a dragon into a griffin (eagle head and beak, feathered wings, lion hindquarters and talons) while keeping its wing span, leg gait, saddle and rider seat |
| Generation date | 2026-10-23 |
| Provider / model | OpenRouter `google/gemini-3-pro-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` with `--subject griffin` (griffin-facing wording in the pose clauses) |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `8f88233ec4ff0543ee0c6de1d553dd063bc78bc047a841ef441aae62e90511db` |
| Front-diagonal prompt | [`prompt-front-diagonal.txt`](./prompt-front-diagonal.txt) — `prompt.txt` plus the explicit three-quarter composition rule, sha256 `4c58469b1b54fe0f808f4d63e73957c5325629a34a422419c9d6b60548004c19` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `75331cc3cecfd089b892ba32e8bc092143112d73fa56ce918c5a16ceccaf3d34` |
| Masters (1024²+) | `design/hero-variants/griffin/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-17/griffin-{n,ne,e,se,s,sw,w,nw}.png` (512×512 RGBA), `src/resources/hero-banner-griffin.png` (320×100) |

## Model choice

Both candidate Gemini image models were run on the same prompt and the `e`
heading before the full set was generated. `google/gemini-3-pro-image` was
picked: it keeps the reference's pixel scale and outline weight while resolving
more of the new detail (the layered feather texture on the chest and wing coverts, the hooked ivory beak and the lion hindquarters), where `google/gemini-3.1-flash-image`
flattened those areas at the same framing. The production pipeline has to hand
the model the reference's own alpha bounding box either way, so the model swap
changed no post-processing.

## Reference images handed to the model

One image-in edit per heading: the cardinal headings repaint the base's own
cardinal, the rear diagonals (`ne`/`nw`) repaint its `n`, the front diagonals
(`se`/`sw`) its `s`.

| Output | Reference | Reference sha256 |
|---|---|---|
| `griffin-n.png` | `commander-9/drake-n.png` | `a4d40fa4cb1c830d01f1f41a786d9ee59f9c63238db933bfbd8ed0a664c20aee` |
| `griffin-ne.png` | `commander-9/drake-n.png (pose-ref n, first pass)` | `a4d40fa4cb1c830d01f1f41a786d9ee59f9c63238db933bfbd8ed0a664c20aee` |
| `griffin-e.png` | `commander-9/drake-e.png` | `94c4239232c7277b93fdd8ef7d278d6bca35f92956f1f6e9e7c0ec088a04caaf` |
| `griffin-se.png` | `commander-9/drake-s.png (pose-ref s)` | `c1bf0986add9873bfd7fe75dfaca924b2233852752c756d2b41c2febb5623344` |
| `griffin-s.png` | `commander-9/drake-s.png` | `c1bf0986add9873bfd7fe75dfaca924b2233852752c756d2b41c2febb5623344` |
| `griffin-sw.png` | `commander-9/drake-s.png (pose-ref s)` | `c1bf0986add9873bfd7fe75dfaca924b2233852752c756d2b41c2febb5623344` |
| `griffin-w.png` | `commander-9/drake-w.png` | `711b4b5fa370bc930b30bb273f19679084d104d9789958e975d29bd2d09d376e` |
| `griffin-nw.png` | `commander-9/drake-n.png (pose-ref n, first pass)` | `a4d40fa4cb1c830d01f1f41a786d9ee59f9c63238db933bfbd8ed0a664c20aee` |
| `hero-banner-griffin.png` | `src/resources/hero-banner-drake.png` | `291cb688909e78dfc072b02053815bb667d898b5c766d03d485ce32dd8553051` |

**No correction pass was needed.** All eight headings came back on the correct
side on the first attempt: `ne` is head-right with the rider seen from behind,
`nw` is head-left, `se` is a head-right front three-quarter and `sw` is
head-left — the same convention the `paladin2` set already ships.

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the
flat grey model background (RGB distance tolerance 26), soft 2px boundary
matte, then a trim and Lanczos3 resize copying the *reference* sprite's alpha
bounding box — same content height, same bottom edge, same centre x on a
512×512 canvas. This variant ships base frames only (no `-2` gallop files, like
lionheart/paladin2/frostwarden/blackdragon); both run frames resolve to the base
sprite.

| Output | Alpha bbox (x,y,w×h) | sha256 |
|---|---|---|
| `griffin-n.png` | 36,67 444×399 | `832dd93227cb2c7a3ece441b3cc8826002f9175e45f466010369c358a1753d5f` |
| `griffin-ne.png` | 34,67 447×399 | `9b213b56bb8c19c00c83185dd713732c1f070367ef333a7604df7d9661a55a95` |
| `griffin-e.png` | 26,57 418×402 | `11ac33dc53f6fc03174ebd1cfa011099557f0730d12ba5d182b621a53f074118` |
| `griffin-se.png` | 44,47 423×415 | `f55d5376b2200a18bb3b5e8476562dfcb480b4e69cfe926e0d33df126ee737be` |
| `griffin-s.png` | 16,47 479×415 | `78c3b8f9698284f9d81cc313dbd1fe28ad2bf825e527f452301e5c3f362a6caa` |
| `griffin-sw.png` | 35,47 442×415 | `c405309ef37bdd2090e7806dfc1a87ae54b77b6f5430d928cba764bfb315c531` |
| `griffin-w.png` | 81,85 385×376 | `5501132dc4e6b989ad6bfecf2978fae199f378fecd00e7faa4c2ceb75361bafa` |
| `griffin-nw.png` | 70,67 375×399 | `959cf9364778ee87546e0ba60eed2ac380c5691974ceecbad3985d88f31a5b1a` |

The banner is a full painted scene (no alpha): the model output is
cover-cropped to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — legacy manifest/buildings and the horse
  run-frame gate (this variant has none).
- `npm run build` + `npm run test:unit` — registry, contracts, descriptors,
  and `test/render/griffinNomadArt.test.ts` (eight distinct 512px files plus the
  banner).
- `npm run test:heroVariants` — recruits the variant in a real game, resolves
  all eight descriptors plus the banner, and A/B diffs the same map tile against
  the `drake` (gilded palette signal).
