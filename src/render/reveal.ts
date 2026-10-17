let cachedName = "";
let cached = new Set<string>();

export function revealTilesFor(name: string, seed: readonly string[], visible: ReadonlySet<string>): ReadonlySet<string> {
  if (name !== cachedName) {
    cached = new Set(seed);
    cachedName = name;
  }
  for (const key of visible) {
    cached.add(key);
  }
  return cached;
}

export function resetReveal(name?: string): void {
  cachedName = "";
  cached = new Set<string>();
  void name;
}