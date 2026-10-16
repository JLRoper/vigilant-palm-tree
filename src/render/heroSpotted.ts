const FADE_MS = 300;
const FADE_MIN_ALPHA = 0.25;
const SCENE_GRACE_MS = 1000;

let bootAt = -1;
const seenAt = new Map<string, number>();

export function resetHeroSpotted(): void {
  seenAt.clear();
  bootAt = -1;
}

export function observeHeroSightings(ids: readonly string[], nowMs: number): void {
  if (bootAt < 0) bootAt = nowMs;
  for (const id of ids) {
    if (!seenAt.has(id)) seenAt.set(id, nowMs);
  }
}

export function pruneHeroSightings(liveIds: ReadonlySet<string>): void {
  for (const id of [...seenAt.keys()]) {
    if (!liveIds.has(id)) seenAt.delete(id);
  }
}

export function heroFadeAlpha(heroId: string, nowMs: number): number {
  const t0 = seenAt.get(heroId);
  if (t0 === undefined) return 1;
  if (t0 - bootAt <= SCENE_GRACE_MS) return 1;
  const t = (nowMs - t0) / FADE_MS;
  return t >= 1 ? 1 : FADE_MIN_ALPHA + (1 - FADE_MIN_ALPHA) * t;
}
