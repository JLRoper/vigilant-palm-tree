# Hero variant wave — `frostwarden` ("Frost Warden")

Per-file provenance for the `frostwarden` mounted-hero variant, following the
"Metadata for Future Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `frostwarden` / `Frost Warden` / `commander-12` |
| Base character | a repaint of the existing `paladin` (`commander-4`) — same pose, silhouette and framing |
| Generation date | 2026-10-19 (local; requests finished 2026-10-19T04:49Z) |
| Provider / model | OpenRouter `google/gemini-3.1-flash-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` (image-in → image-out, argument-driven, stores no prompts) |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `824b8cd249d2b0945e8372db5363d79b0a88b261e812388bac8381ff78046a04` |
| `ne` prompt override | [`prompt-ne.txt`](./prompt-ne.txt) — `prompt.txt` plus an explicit "head on the RIGHT" composition rule, sha256 `fd57e9ac48404477d08a0b5b6069c74251c6aa3b10220d672739ba8b6b2449c9` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `6f895933fc32ec2acd65f70d593fa851e144e801405327346b342733280f3fbc` |
| Masters (1024²) | `design/hero-variants/frostwarden/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-12/frostwarden-{n,ne,e,se,s,sw,w,nw}.png` (512×512 RGBA), `src/resources/hero-banner-frostwarden.png` (320×100) |

## Reference images handed to the model

| Output | Reference | sha256 |
|---|---|---|
| `frostwarden-n.png`, `frostwarden-ne.png` (1st attempt), `frostwarden-nw.png` | `commander-4/paladin-n.png` | `8cbab9e9501734a0a3dc4ad29fdf649ad1587e0e04b9608e46a7f0443915b71f` |
| `frostwarden-ne.png` (committed) | `commander-4/paladin-e.png` | `4e9b1936641783402b5a94bc0822e5b4fa881a0590a2bd2f8a73fafc82a4cd74` |
| `frostwarden-e.png` | `commander-4/paladin-e.png` | same as above |
| `frostwarden-s.png`, `frostwarden-se.png`, `frostwarden-sw.png` | `commander-4/paladin-s.png` | `a9f44f377ae774d03bf4790eefc3f8f9a3392184718137999aa48788c65224ea` |
| `frostwarden-w.png` | `commander-4/paladin-w.png` | `aee840e1af08a0c3b0665ad158f6921f85b19e11856771100ae88663dec69393` |
| `hero-banner-frostwarden.png` | `src/resources/hero-banner-shadow.png` | `21bc8ca762f90e2dd91186bba11952ae48a935ad6f7428b49a728b5da8e1cdc3` |

**`ne` correction.** The first `ne` (from the rear-view reference) came out mirrored — head on the left, i.e. a rear-LEFT three-quarter, which would have read as heading northwest while the hero moved northeast. It was regenerated from the east profile with an explicit head-side rule; the committed file passes the head-side check (`ne`/`e`/`se` head right, `sw`/`w`/`nw` head left), and its framing follows the east reference's bounding box (420px content height).

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the flat
grey model background (RGB distance tolerance 26), soft 2px boundary matte, then a
trim and Lanczos3 resize copying the *reference* sprite's alpha bounding box —
same content height, same bottom edge, same centre x on a 512×512 canvas.

| Output | Alpha bbox (x,y,w,h) | Transparent |
|---|---|---|
| `frostwarden-n.png` | 158,28 204×454 | 81.0% |
| `frostwarden-ne.png` | 59,49 387×420 | 72.7% |
| `frostwarden-e.png` | 64,49 377×420 | 73.8% |
| `frostwarden-se.png` | 97,18 326×469 | 73.8% |
| `frostwarden-s.png` | 141,18 238×469 | 76.9% |
| `frostwarden-sw.png` | 101,18 319×469 | 73.6% |
| `frostwarden-w.png` | 68,49 386×423 | 71.9% |
| `frostwarden-nw.png` | 116,28 288×454 | 75.3% |

The banner is a full painted scene (no alpha): the model output is cover-cropped
to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — legacy manifest, generated building keys/anchors,
  horse run-frame gate (no `-2` files ship for this variant).
- `npm run build` + `npm run test:unit` — registry/contracts/descriptor wiring.
- `npm run test:heroVariants` — recruits the variant in a real game, resolves all
  eight descriptors + the banner, and A/B diffs the same map tile against the
  original paladin to prove the sprite paints.
