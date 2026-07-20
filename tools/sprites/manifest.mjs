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

export const SPRITE_FILES = [
  ...Object.values(CASTLE_SPRITES),
  ...Object.values(RESOURCE_SPRITES),
];
