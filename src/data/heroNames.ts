const HERO_NAMES: readonly string[] = [
  "Sylvan Moonshadow",
  "Alaric Ironheart",
  "Lyra Stormwind",
  "Thorne Blackwood",
  "Zara Emberblade",
  "Cassian Duskvale",
  "Dorian Frostwind",
  "Selene Silverbrook",
  "Magnus Grimward",
  "Elara Dawnweaver",
  "Fenris Shadowmere",
  "Aria Firebrand",
  "Kael Thornbriar",
  "Mira Wolfsbane",
  "Valdus Starfall",
  "Isolde Ravencrest",
  "Ronan Swiftarrow",
  "Celeste Nightwhisper",
  "Bram Ironmantle",
  "Vesna Brightforge",
  "Orin Steelwill",
  "Lyana Frostveil",
  "Tiberius Ashwalk",
  "Nyssa Darkwater",
  "Garrick Flameheart",
  "Rowan Wildstride",
  "Kestrel Hawkwind",
  "Petra Stoneward",
  "Aldric Dawnshield",
  "Freya Stormrider",
  "Corvax Shadeborn",
  "Ilara Moonbrook",
  "Tarric Goldmantle",
  "Yara Deepforge",
  "Lorik Windwalker",
  "Seraphine Lightcaller",
  "Gareth Sunreaver",
  "Morwyn Earthsong",
  "Talon Swiftblade",
  "Ophelia Darkrose",
  "Baelor Firewarden",
  "Lucia Stargazer",
  "Edric Thornwall",
  "Sanna Frostwind",
  "Jorath Dreadbane",
  "Arwen Mistweaver",
  "Harkon Grimblade",
  "Tessa Brightwater",
  "Ulric Stonebreaker",
  "Kira Nightfall",
];

let usedNames: Set<string> | null = null;

export function pickHeroName(): string | null {
  if (!usedNames) usedNames = new Set();
  const available = HERO_NAMES.filter((n) => !usedNames!.has(n));
  if (available.length === 0) {
    // Fallback: generate numeric names
    const idx = usedNames.size + 1;
    const name = `Commander #${idx}`;
    usedNames.add(name);
    return name;
  }
  const idx = Math.floor(Math.random() * available.length);
  const name = available[idx];
  usedNames.add(name);
  return name;
}

export function releaseHeroName(name: string): void {
  usedNames?.delete(name);
}
