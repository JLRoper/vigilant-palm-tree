# Art Style

> Status: ✅ Implemented. Canonical reference for sprite art direction. Rune stone resource icons, procedural castle sprites, and hero/knight sprites have been generated.

Canonical reference for sprite art direction in heroes-js. Update this file when the direction changes; the next art agent will read it first.

## Current direction: Alchemical Rune Stones

All resource icons are small carved stone tablets, each bearing a glowing alchemical rune glyph at center. Same silhouette across all five; differentiated by stone color, rune glyph, and rune glow color.

### Why this direction

- **Distinct from the castle sprites** — castles are warm brown/yellow cottage architecture with thatched roofs. Rune stones are cool, ancient, and ritual. They will not read as miniature castles.
- **Cohesive yet distinct** — the shared silhouette + frame ties the set together visually so they look like a curated in-game item set. Each rune is geometrically different (sun vs. leaf vs. square vs. arrow vs. star) so they remain distinguishable at 24 px and at the hex-map scale (~11 px effective at 0.45x).
- **Reads well tiny** — a single central glyph + stone frame is the highest-contrast composition possible. No detail that disappears at small sizes.
- **Fits HoMM fantasy canon** — rune stones are a familiar fantasy trope; players will grok "I can pick that up."

### Composition rules

- Canvas is **32×32 px**, transparent background.
- Stone tablet is **24×24** centered at (4,4)–(27,27).
- **1 px outline** around the tablet (per-resource `outline` color), traced even through the chip pixels.
- **1 px chip** at top-left (4,4) and bottom-right (27,27) corners gives a hand-carved feel — not a clean rectangle.
- **1 px top highlight + 1 px bottom shadow** = subtle bevel.
- **1 px carved inner frame**, inset 3 px, in `stoneDk` — looks like an engraved border around the glyph area.
- Rune is centered at (16,16) and bounded by **x ∈ [10..22], y ∈ [10..22]** to leave breathing room from the inner frame.
- Each rune has 1–2 px "glow tip" pixels in `glow` color just outside the rune to suggest emitted light.
- An optional 1 px bright core (`#ffffff`) at the rune's center for arcane and gold only.

### Palette (per resource)

| Resource | Stone       | Stone Dark | Stone Hi  | Outline   | Rune     | Glow      |
|----------|-------------|------------|-----------|-----------|----------|-----------|
| Gold     | `#c8a868`   | `#7a5a30`  | `#ecd49a` | `#1a1208` | `#ffd84a`| `#fff200` |
| Wood     | `#8aa66c`   | `#4a5a30`  | `#b8c898` | `#10180a` | `#a8e860`| `#e8ffb0` |
| Stone    | `#a8a8a0`   | `#585850`  | `#d0d0c8` | `#101010` | `#e8e8e0`| `#ffffff` |
| Iron     | `#787886`   | `#383848`  | `#a0a0b0` | `#0a0a0e` | `#e87a5a`| `#ffb070` |
| Arcane   | `#5a4878`   | `#2a1838`  | `#8870a0` | `#08040a` | `#d098ff`| `#f8d8ff` |

### Rune glyph vocabulary

| Resource | Glyph                          | Alchemical reading     |
|----------|--------------------------------|------------------------|
| Gold     | filled disc + 4 cardinal rays  | Sun (☉) — alchemical gold |
| Wood     | 5-wide leaf with 4-px stem     | Sapling / leaf — alchemical wood |
| Stone    | square outline + interior cross| Earth (⊕) — alchemical earth |
| Iron     | upward arrow + crossbar        | Mars (♂) — alchemical iron |
| Arcane   | plus-sign with diamond core    | Star (✦) — quintessence |

### How to extend (adding a new resource)

1. Add an entry to `RESOURCE_PAL` with `stone`, `stoneDk`, `stoneHi`, `outline`, `rune`, `glow` colors.
2. Implement a `drawResource<Name>(ctx)` that calls `drawStone(ctx, p)` then draws the rune inside x ∈ [10..22], y ∈ [10..22].
3. Add `<canvas id="resource-<name>" width="32" height="32">` to the grid in `pixel-art.html`.
4. Add the new id to the `sprites` array in `tools/sprites/pixel-gen.mjs`.
5. Add the new `drawResource<Name>(makeCtx(...))` call in the run block of `pixel-art.html`.
6. Re-run `node tools/sprites/pixel-gen.mjs`.

### Anti-patterns

- Don't make runes fill the whole inner frame — keep the 3 px margin.
- Don't use gradients or anti-aliasing — solid pixels only.
- Don't add an opaque background — the icons need transparency to overlay the hex terrain.
- Don't drop the 1 px outline — it makes the icon legible against any terrain color.
- Don't break the shared silhouette too much — the visual cohesion comes from the shared stone shape.
- Don't draw runes that look the same at 11 px — silhouette + color is what reads, not fine detail.

## Future directions (parked)

If the alchemical-stone direction needs to evolve, here are alternative directions that were considered but not chosen:

- **Old cartography map pins** — parchment-circle tokens with hand-drawn symbols, woodcut feel.
- **Mystical constellation tokens** — star-map medallions, one per constellation.
- **Heraldic animal crests** — banner shields with stylized animals.
- **Botanical dioramas** — tiny framed cross-sections (wheat ear, pine cone, crystal cluster, rusted nails, glowing mushroom).

These can be revisited; the rune-stone theme was chosen because it has the highest silhouette distinctiveness at the smallest playable scale.
