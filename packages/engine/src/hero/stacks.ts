import type { GameState, HeroId, ReorderResult } from "@heroes/contracts";

// The 8 army slots are FIXED positions on the battlefield (front line, back
// line, etc.), so the user can only SWAP the contents of two slots. Same
// from/to is a no-op success. Dragging onto an empty slot effectively moves
// the stack there while leaving the source empty (swap with empty). Marks the
// state dirty so the next save/turn boundary persists it.
export function reorderStack(
  state: GameState,
  heroId: HeroId,
  fromIdx: number,
  toIdx: number,
): ReorderResult {
  const hero = state.heroes[heroId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  const stacks = [...(hero.stacks ?? [])];
  if (
    !Number.isInteger(fromIdx) ||
    !Number.isInteger(toIdx) ||
    fromIdx < 0 ||
    fromIdx >= stacks.length ||
    toIdx < 0 ||
    toIdx >= stacks.length
  ) {
    return { state, ok: false, reason: "invalid_index" };
  }
  if (fromIdx === toIdx) return { state, ok: true, reason: "" };
  const tmp = stacks[fromIdx];
  stacks[fromIdx] = stacks[toIdx];
  stacks[toIdx] = tmp;
  return {
    state: {
      ...state,
      heroes: { ...state.heroes, [heroId]: { ...hero, stacks } },
      dirty: true,
    },
    ok: true,
    reason: "",
  };
}
