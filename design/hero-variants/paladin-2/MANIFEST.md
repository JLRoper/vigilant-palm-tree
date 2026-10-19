# Hero variant wave — `paladin2` ("Paladin 2")

Per-file provenance for the `paladin2` mounted-hero variant, following the
"Metadata for Future Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `paladin2` / `Paladin 2` / `commander-11` |
| Generation date | 2026-10-18 (local; requests finished 2026-10-19T03:25Z) |
| Provider / model | OpenRouter `google/gemini-3.1-flash-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` (image-in → image-out, argument-driven, stores no prompts) |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `2f51f1d92223ab581091b2ccf49e06ba5501381ca8164a7713a9d23331fe4a4b` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `2e82c58d8f6677d95ba1f77c7a0c711bdc5b011ca2ddcb8654a83ec441eb4004` |
| Masters (1024²) | `design/hero-variants/paladin-2/masters/*-master.png` — **gitignored** (see `.gitignore`), reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-11/paladin2-{n,ne,e,se,s,sw,w,nw}.png` (512×512 RGBA), `src/resources/hero-banner-paladin2.png` (320×100) |

## Reference images handed to the model

| Output | Reference | sha256 |
|---|---|---|
| `paladin2-e.png` | `src/resources/units/horse/commander-4/paladin-e.png` | `4e9b1936641783402b5a94bc0822e5b4fa881a0590a2bd2f8a73fafc82a4cd74` |
| `paladin2-w.png` | `src/resources/units/horse/commander-4/paladin-w.png` | `aee840e1af08a0c3b0665ad158f6921f85b19e11856771100ae88663dec69393` |
| `paladin2-n.png`, `paladin2-ne.png`, `paladin2-nw.png` | `src/resources/units/horse/commander-4/paladin-n.png` | `8cbab9e9501734a0a3dc4ad29fdf649ad1587e0e04b9608e46a7f0443915b71f` |
| `paladin2-s.png`, `paladin2-se.png`, `paladin2-sw.png` | `src/resources/units/horse/commander-4/paladin-s.png` | `a9f44f377ae774d03bf4790eefc3f8f9a3392184718137999aa48788c65224ea` |
| `hero-banner-paladin2.png` | `src/resources/hero-banner-paladin.png` | `074292f24bb7ec408f68b4d48e67f62e946cb747b5c4ede5d47493d4bfbc5b28` |

The diagonals repaint the nearest cardinal (rear view for `ne`/`nw`, front view
for `se`/`sw`) and are re-posed by the prompt, because a rear-view reference
cannot be turned into a front view by colour alone.

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the
flat grey model background (RGB distance tolerance 26 — only background
connected to the canvas edge is cleared, so the silver-white mane and steel
armour survive), a soft 2px boundary matte, then a trim and a Lanczos3 resize
that copies the *reference* sprite's alpha bounding box: same content height,
same bottom edge, same centre x on a 512×512 transparent canvas. Framing is
therefore the original paladin's, not the model's.

| Output | Alpha bbox (x,y,w,h) | Transparent |
|---|---|---|
| `paladin2-n.png` | 146,28 227×454 | 80.3% |
| `paladin2-ne.png` | 124,28 272×454 | 75.5% |
| `paladin2-e.png` | 60,49 385×420 | 73.0% |
| `paladin2-se.png` | 91,18 338×469 | 71.1% |
| `paladin2-s.png` | 142,18 236×469 | 77.5% |
| `paladin2-sw.png` | 91,18 338×469 | 72.8% |
| `paladin2-w.png` | 70,49 381×423 | 73.3% |
| `paladin2-nw.png` | 107,28 305×454 | 73.7% |

The banner is a full painted scene (no alpha): the 21:9-ish model output is
cover-cropped to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — legacy manifest, generated building keys/anchors,
  and the horse run-frame base/existence/alignment gate (no `-2` files ship for
  this variant, so both run frames resolve to the base sprite).
- `npm run build` + `npm run test:unit` — registry/contracts/descriptor wiring.
- Playwright (`test/heroVariants.e2e.ts`) — recruits the variant in a real game,
  asserts the persisted `horseVariant`, resolves all eight `horse.paladin2.*`
  descriptors in the page, and screenshots the hero on the adventure map.
