// The uncharted-mode reveal the renderer draws: (the seat's CURRENT persisted
// reveal) ∪ (everything this session has seen).
//
// The persisted half is re-read on EVERY call, never snapshotted at game load.
// `seed` is the client's `players[].revealedTiles` -- a projection the
// TurnController keeps in step with the server (src/state/turnController.ts's
// revealReconciled) -- so the drawn set has to follow the CURRENT value: a
// snapshot taken on the first frame is exactly what hid that projection going
// stale for the rest of the session (playthrough round 3, F1: 36 keys behind
// the server, invisible only because the union below compensated for it).
//
// The session half is a live-vision accumulator. It covers what the persisted
// reveal cannot: the optimistic window between a command and its server ack,
// and client-only vision sources such as the seat's own caravans, whose rings
// the server never persists.
let cachedName = "";
let sessionSeen = new Set<string>();
let seenVersion = 0;
let memoSeed: readonly string[] | null = null;
let memoVersion = -1;
let memoDrawn: Set<string> | null = null;

export function revealTilesFor(name: string, seed: readonly string[], visible: ReadonlySet<string>): ReadonlySet<string> {
  if (name !== cachedName) {
    sessionSeen = new Set<string>();
    cachedName = name;
    seenVersion++;
  }
  for (const key of visible) {
    if (!sessionSeen.has(key)) {
      sessionSeen.add(key);
      seenVersion++;
    }
  }
  if (seed.length === 0) return sessionSeen;
  if (memoDrawn !== null && memoSeed === seed && memoVersion === seenVersion) return memoDrawn;
  const drawn = new Set<string>(seed);
  for (const key of sessionSeen) drawn.add(key);
  memoSeed = seed;
  memoVersion = seenVersion;
  memoDrawn = drawn;
  return drawn;
}

export function resetReveal(): void {
  cachedName = "";
  sessionSeen = new Set<string>();
  seenVersion++;
  memoSeed = null;
  memoVersion = -1;
  memoDrawn = null;
}
