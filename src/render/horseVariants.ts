export const HORSE_VARIANT_REGISTRY = [
  { id: "bubbly", label: "Bubbly", commanderDir: 2 },
  { id: "shadow", label: "Shadow Knight", commanderDir: 3 },
  { id: "paladin", label: "Paladin", commanderDir: 4 },
  { id: "ranger", label: "Ranger", commanderDir: 5 },
  { id: "arcane", label: "Arcane Spellrider", commanderDir: 6 },
  { id: "unicorn", label: "Dark Unicorn", commanderDir: 7 },
  { id: "samurai", label: "Samurai Warrior", commanderDir: 8 },
  { id: "hero", label: "Knight", commanderDir: 1 },
] as const;

export type HorseVariantId = (typeof HORSE_VARIANT_REGISTRY)[number]["id"];

export const VALID_HORSE_VARIANTS = HORSE_VARIANT_REGISTRY.map((v) => v.id);
