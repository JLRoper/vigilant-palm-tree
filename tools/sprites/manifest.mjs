export const ASSETS_DIR = "src/resources";

export const CASTLE_SPRITES = {
  1: "castle-l1.png",
  2: "castle-l2.png",
  3: "castle-l3.png",
};

export const CASTLE_ALT_SPRITES = {
  1: "castle-l1-alt.png",
  2: "castle-l2-alt.png",
  3: "castle-l3-alt.png",
};

export const RESOURCE_SPRITES = {
  gold: "resource-gold.png",
  wood: "resource-wood.png",
  stone: "resource-stone.png",
  iron: "resource-iron.png",
  arcane: "resource-arcane.png",
};

// Cartography-pin variant (parked direction per docs/art-style.md "Future directions").
// Same silhouette across the set, differentiated by woodcut symbol + accent.
export const RESOURCE_CART_SPRITES = {
  gold: "resource-gold-cart.png",
  wood: "resource-wood-cart.png",
  stone: "resource-stone-cart.png",
  iron: "resource-iron-cart.png",
  arcane: "resource-arcane-cart.png",
};

// FLUX-illustrated variant of the cartography pin (higher fidelity).
export const RESOURCE_ILLUST_SPRITES = {
  gold: "resource-gold-illust.png",
  wood: "resource-wood-illust.png",
  stone: "resource-stone-illust.png",
  iron: "resource-iron-illust.png",
  arcane: "resource-arcane-illust.png",
};

// Constellation medallions (parked direction per docs/art-style.md).
export const RESOURCE_CONSTELLATION_SPRITES = {
  gold: "resource-gold-constellation.png",
  wood: "resource-wood-constellation.png",
  stone: "resource-stone-constellation.png",
  iron: "resource-iron-constellation.png",
  arcane: "resource-arcane-constellation.png",
};

// Heraldic animal crests (parked direction per docs/art-style.md).
export const RESOURCE_CREST_SPRITES = {
  gold: "resource-gold-crest.png",
  wood: "resource-wood-crest.png",
  stone: "resource-stone-crest.png",
  iron: "resource-iron-crest.png",
  arcane: "resource-arcane-crest.png",
};

export const CARAVAN_SPRITES = {
  resource: "caravan-supply.png",
  gold: "caravan-treasury.png",
};

// River overlay tiles (map-gen v5), baked by tools/sprites/gen-river-tiles.mjs.
export const RIVER_SPRITES = {
  "small-end": "rivers/river-small-end.png",
  "small-straight": "rivers/river-small-straight.png",
  "small-curveC": "rivers/river-small-curveC.png",
  "small-curveCC": "rivers/river-small-curveCC.png",
  "wide-end": "rivers/river-wide-end.png",
  "wide-straight": "rivers/river-wide-straight.png",
  "wide-curveC": "rivers/river-wide-curveC.png",
  "wide-curveCC": "rivers/river-wide-curveCC.png",
  "wide-bridge": "rivers/river-wide-bridge.png",
};

export const SPRITE_FILES = [
  ...Object.values(CASTLE_SPRITES),
  ...Object.values(CASTLE_ALT_SPRITES),
  ...Object.values(RESOURCE_SPRITES),
  ...Object.values(RESOURCE_CART_SPRITES),
  ...Object.values(RESOURCE_ILLUST_SPRITES),
  ...Object.values(RESOURCE_CONSTELLATION_SPRITES),
  ...Object.values(RESOURCE_CREST_SPRITES),
  ...Object.values(CARAVAN_SPRITES),
  ...Object.values(RIVER_SPRITES),
];
