import type { GameState } from "@heroes/contracts";
import { controlRange } from "./control";

export const HERO_VISION_RANGE = 4;

function addRingTo(set: Set<string>, q: number, r: number, range: number): void {
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (Math.abs(dq + dr) > range) continue;
      set.add(`${q + dq},${r + dr}`);
    }
  }
}

export function visionKeysAroundPoints(
  points: readonly { q: number; r: number }[],
  range: number = HERO_VISION_RANGE,
): Set<string> {
  const set = new Set<string>();
  for (const point of points) addRingTo(set, point.q, point.r, range);
  return set;
}

export function visionKeysForPlayer(state: GameState, playerId: number): Set<string> {
  const keys = new Set<string>();
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId !== playerId) continue;
    addRingTo(keys, hero.q, hero.r, HERO_VISION_RANGE);
  }
  for (const settlement of Object.values(state.settlements)) {
    if (settlement.ownerId !== playerId) continue;
    addRingTo(keys, settlement.q, settlement.r, controlRange(settlement.level, settlement.buildings));
  }
  return keys;
}

export function sortedRevealKeys(keys: Iterable<string>): string[] {
  const arr = Array.from(keys);
  arr.sort((a, b) => {
    const [aq, ar] = a.split(",");
    const [bq, br] = b.split(",");
    const qd = parseInt(aq, 10) - parseInt(bq, 10);
    if (qd !== 0) return qd;
    return parseInt(ar, 10) - parseInt(br, 10);
  });
  return arr;
}

export function mergePlayerReveal(
  state: GameState,
  playerId: number,
  keys: Iterable<string>,
): GameState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return state;
  const merged = new Set<string>(player.revealedTiles ?? []);
  let added = false;
  for (const key of keys) {
    if (!merged.has(key)) {
      merged.add(key);
      added = true;
    }
  }
  if (!added) return state;
  const revealedTiles = sortedRevealKeys(merged);
  const players = state.players.map((p) =>
    p.id === playerId ? { ...p, revealedTiles } : p,
  );
  return { ...state, players };
}

/**
 * The ONE uncharted-mode reveal rule: union a seat's current vision -- hero
 * rings (HERO_VISION_RANGE) plus its owned settlements' controlRange -- into its
 * persisted `players[].revealedTiles`. `extraPoints` adds its rings too, which
 * is how a multi-hex move reveals the corridor it walked rather than only the
 * tile it landed on.
 *
 * Both writers call THIS function, so the persisted reveal and the client's
 * copy of it cannot disagree: the server applies it after every command
 * (server/app/commandHandler.ts) and persists the result, and the client applies
 * it to its own optimistic state on the same commands.
 *
 * Gated on the seat MAINTAINING a reveal -- a human (`faction === "player"`)
 * seat of an uncharted game, which is exactly the set init.ts's
 * `seedInitialReveal` stamps with the `revealedTiles` key. AI seats are never
 * stamped (their reveal is never rendered or maintained), and no seat of a
 * classic game is, so for those this is a no-op and their persisted rows stay
 * byte-identical.
 */
export function revealForPlayer(
  state: GameState,
  playerId: number,
  extraPoints?: readonly { q: number; r: number }[],
): GameState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.faction !== "player" || player.revealedTiles === undefined) {
    return state;
  }
  const keys = visionKeysForPlayer(state, playerId);
  if (extraPoints) {
    for (const key of visionKeysAroundPoints(extraPoints)) keys.add(key);
  }
  return mergePlayerReveal(state, playerId, keys);
}
