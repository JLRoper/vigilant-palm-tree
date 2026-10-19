import type { GameState, ReorderResult, SettlementId } from "@heroes/contracts";
import { settlementStacks } from "../units";

// The garrison's 8 platoon slots are FIXED positions on the battlefield, the
// same rule the hero army follows in hero/stacks.ts -- the user can only SWAP
// the contents of two slots. Same from/to is a no-op success, and dragging onto
// an empty slot moves the stack there (swap with empty). Marks the state dirty
// so the next save/turn boundary persists it.
export function reorderGarrisonStacks(
  state: GameState,
  settlementId: SettlementId,
  fromIdx: number,
  toIdx: number,
): ReorderResult {
  const settlement = state.settlements[settlementId];
  if (!settlement) return { state, ok: false, reason: "no_settlement" };
  const stacks = settlementStacks(settlement).map((p) => ({ entries: p.entries.map((e) => ({ ...e })) }));
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
      settlements: { ...state.settlements, [settlementId]: { ...settlement, stacks } },
      dirty: true,
    },
    ok: true,
    reason: "",
  };
}
