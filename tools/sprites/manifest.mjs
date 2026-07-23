export const ASSETS_DIR = "src/resources";

export const CASTLE_SPRITES = {
  1: "castle-l1.png",
  2: "castle-l2.png",
  3: "castle-l3.png",
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

export const SPRITE_FILES = [
  ...Object.values(CASTLE_SPRITES),
  ...Object.values(RESOURCE_SPRITES),
  ...Object.values(RESOURCE_CART_SPRITES),
  ...Object.values(RESOURCE_ILLUST_SPRITES),
  ...Object.values(RESOURCE_CONSTELLATION_SPRITES),
  ...Object.values(RESOURCE_CREST_SPRITES),
];
