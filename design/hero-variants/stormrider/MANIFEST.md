# Hero variant wave — `stormrider` ("Storm Rider")

Per-file provenance for the `stormrider` mounted-hero variant, following the
"Metadata for Future Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `stormrider` / `Storm Rider` / `commander-14` |
| Base character | a repaint of the existing `ranger` (`commander-5`) — same pose, silhouette, hood and bow |
| Generation date | 2026-10-19 (local; requests finished 2026-10-19T04:50Z) |
| Provider / model | OpenRouter `google/gemini-3.1-flash-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` (image-in → image-out, argument-driven, stores no prompts) |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `8d0ecc3fb3fdd07f6f5bd68a4a737fa61d50d8ca92873e67bb07be4553f9fa8d` |
| `ne` prompt override | [`prompt-ne.txt`](./prompt-ne.txt) — `prompt.txt` plus an explicit "head on the RIGHT" composition rule, sha256 `53200d19bfaab572100a261421ecd2eb75dbf0975ce341af23cb83863d0213af` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `1f56675ae79639f5ee5c129943eab002f3f82b7673a070e9e2cfe2cfcdf2ba83` |
| Masters (1024²) | `design/hero-variants/stormrider/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-14/stormrider-{n,ne,e,se,s,sw,w,nw}.png` (512×512 RGBA), `src/resources/hero-banner-stormrider.png` (320×100) |

## Reference images handed to the model

| Output | Reference | sha256 |
|---|---|---|
| `stormrider-n.png`, `stormrider-ne.png`, `stormrider-nw.png` | `commander-5/ranger-n.png` | `02d892d94063fdf2baf71cafdd8f04347296eb8b474cc577b2ccc54e06b29e57` |
| `stormrider-e.png` | `commander-5/ranger-e.png` | `1d361cfb5ca4697f533b6bba8cea67ffcd13ff31bf6bcaf3cbb19e019ea8a6d3` |
| `stormrider-s.png`, `stormrider-se.png`, `stormrider-sw.png` | `commander-5/ranger-s.png` | `f96872043ec9ef056dca6ee655db11de5f25e4aafb75816f4a419cdf73413700` |
| `stormrider-w.png` | `commander-5/ranger-w.png` | `97e60c225f6e5a1a2d5ac9cf706f15edceb4d66ac9a20c4e969f3e182cab26a7` |
| `hero-banner-stormrider.png` | `src/resources/hero-banner-ranger.png` | `8abc7c04a0f40a228e0d72a90a92c791fb22046c88f28f713ea887839dda27e1` |

**`ne` correction.** The first `ne` came out mirrored (head on the left, a
rear-LEFT three-quarter that would read as heading northwest). Regenerated with
the explicit head-side rule; the committed file passes the head-side check
(`ne`/`e`/`se` head right, `sw`/`w`/`nw` head left).

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the flat
grey model background (RGB distance tolerance 26), soft 2px boundary matte, then a
trim and Lanczos3 resize copying the *reference* sprite's alpha bounding box —
same content height, same bottom edge, same centre x on a 512×512 canvas.

| Output | Alpha bbox (x,y,w,h) | Transparent |
|---|---|---|
| `stormrider-n.png` | 168,33 215×457 | 81.8% |
| `stormrider-ne.png` | 112,33 327×457 | 72.6% |
| `stormrider-e.png` | 41,43 428×451 | 66.7% |
| `stormrider-se.png` | 72,23 367×470 | 67.0% |
| `stormrider-s.png` | 112,23 287×470 | 75.3% |
| `stormrider-sw.png` | 79,23 353×470 | 70.0% |
| `stormrider-w.png` | 57,29 424×446 | 68.6% |
| `stormrider-nw.png` | 127,33 298×457 | 73.1% |

The banner is a full painted scene (no alpha): the model output is cover-cropped
to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — legacy manifest, generated building keys/anchors,
  horse run-frame gate (no `-2` files ship for this variant).
- `npm run build` + `npm run test:unit` — registry/contracts/descriptor wiring.
- `npm run test:heroVariants` — recruits the variant in a real game, resolves all
  eight descriptors + the banner, and A/B diffs the same map tile against the
  original `ranger` sprite set to prove the sprite paints and is distinct.
