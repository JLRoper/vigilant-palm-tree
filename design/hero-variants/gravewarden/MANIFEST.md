# Hero variant wave — `gravewarden` ("Grave Warden")

Per-file provenance for the `gravewarden` mounted-hero variant, following the
"Metadata for Future Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `gravewarden` / `Grave Warden` / `commander-13` |
| Base character | a repaint of the existing `shadow` ("Shadow Knight", `commander-3`) — same pose, silhouette and framing |
| Generation date | 2026-10-19 (local; requests finished 2026-10-19T04:50Z) |
| Provider / model | OpenRouter `google/gemini-3.1-flash-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` (image-in → image-out, argument-driven, stores no prompts) |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `5bf0e47ea3026c875041cc41de1e0c46fba2991ea604e6bbc33f5cab708c92eb` |
| `nw` prompt override | [`prompt-nw.txt`](./prompt-nw.txt) — `prompt.txt` plus an explicit "head on the LEFT" composition rule, sha256 `2ee0272642d301393e9759f43be0a46a42d18be260e3db29d4de7154e13c38bc` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `f5ccde0e57ff778df6e5473fb7963191da9937db35db67c1faa3bc991a2b2344` |
| Masters (1024²) | `design/hero-variants/gravewarden/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-13/gravewarden-{n,ne,e,se,s,sw,w,nw}.png` (512×512 RGBA), `src/resources/hero-banner-gravewarden.png` (320×100) |

## Reference images handed to the model

| Output | Reference | sha256 |
|---|---|---|
| `gravewarden-n.png`, `gravewarden-ne.png`, `gravewarden-nw.png` | `commander-3/shadow-n.png` | `6c59b1aff10226a3f4e714f8682cab91f028e5bfe0f14db6f24d01b4830c31ec` |
| `gravewarden-e.png` | `commander-3/shadow-e.png` | `0db39397be02eff2f4b9d7fdf574ea15ea81de99b39f71dde945f0a49a1688ef` |
| `gravewarden-s.png`, `gravewarden-se.png`, `gravewarden-sw.png` | `commander-3/shadow-s.png` | `efa84ad243c4afe31650efd654c28973c3cebe7216dca40a81fdd9d873ff1d71` |
| `gravewarden-w.png` | `commander-3/shadow-w.png` | `3a92ee6b62e5b6ce564b74eedd5d2a28ca382c8da3b9060aa3a3efc92160c2fa` |
| `hero-banner-gravewarden.png` | `src/resources/hero-banner-paladin.png` | `074292f24bb7ec408f68b4d48e67f62e946cb747b5c4ede5d47493d4bfbc5b28` |

**`nw` correction.** The first `nw` came out mirrored (head on the right, i.e. a
rear-RIGHT three-quarter that would read as heading northeast). Regenerated with
the explicit head-side rule; the committed file passes the head-side check
(`ne`/`e`/`se` head right, `sw`/`w`/`nw` head left).

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the flat
grey model background (RGB distance tolerance 26), soft 2px boundary matte, then a
trim and Lanczos3 resize copying the *reference* sprite's alpha bounding box —
same content height, same bottom edge, same centre x on a 512×512 canvas.

| Output | Alpha bbox (x,y,w,h) | Transparent |
|---|---|---|
| `gravewarden-n.png` | 132,26 212×462 | 78.3% |
| `gravewarden-ne.png` | 88,26 300×462 | 73.9% |
| `gravewarden-e.png` | 60,75 401×383 | 74.7% |
| `gravewarden-se.png` | 91,19 329×482 | 71.7% |
| `gravewarden-s.png` | 107,19 296×482 | 73.4% |
| `gravewarden-sw.png` | 113,19 285×482 | 73.2% |
| `gravewarden-w.png` | 53,41 409×429 | 73.0% |
| `gravewarden-nw.png` | 75,26 326×462 | 73.1% |

The banner is a full painted scene (no alpha): the model output is cover-cropped
to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — legacy manifest, generated building keys/anchors,
  horse run-frame gate (no `-2` files ship for this variant).
- `npm run build` + `npm run test:unit` — registry/contracts/descriptor wiring.
- `npm run test:heroVariants` — recruits the variant in a real game, resolves all
  eight descriptors + the banner, and A/B diffs the same map tile against the
  original `shadow` sprite set to prove the sprite paints and is distinct.
