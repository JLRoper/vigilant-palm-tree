import { Axial, hexDistance } from "../core/hex";
import { api } from "../io/api";
import { GAME_NAME } from "../views/adventureView";
import { Hero } from "../entities/hero";

export interface ArrivalState {
  player: Hero;
  enemies: Hero[];
  path: Axial[];
  gold: number;
  turn: number;
  combat: boolean;
  combatTile: Axial | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  backendOk: boolean;
}

export interface ArrivalHooks {
  onHudUpdate: () => void;
}

export async function onHeroArrived(state: ArrivalState, hooks: ArrivalHooks): Promise<void> {
  const steps = state.path.length;
  const earned = Math.max(1, steps);
  state.gold += earned;
  state.turn += 1;
  state.combat = checkCombat(state);
  if (state.combat) {
    state.gold += 50;
    const idx = state.enemies.findIndex(
      (e) =>
        state.combatTile &&
        e.tile.q === state.combatTile.q &&
        e.tile.r === state.combatTile.r
    );
    if (idx >= 0) {
      state.enemies.splice(idx, 1);
    }
  }
  hooks.onHudUpdate();
  if (!state.backendOk) return;
  state.saveStatus = "saving";
  hooks.onHudUpdate();
  try {
    await api.patchGame(GAME_NAME, {
      hero_q: state.player.tile.q,
      hero_r: state.player.tile.r,
      turn: state.turn,
      gold: state.gold,
      enemy_positions: state.enemies.map((e) => ({ q: e.tile.q, r: e.tile.r })),
    });
    await api.logEvent(
      GAME_NAME,
      state.combat ? "combat_won" : "move_completed",
      {
        to: { q: state.player.tile.q, r: state.player.tile.r },
        steps,
        earned,
        turn: state.turn,
        gold: state.gold,
      }
    );
    state.saveStatus = "saved";
  } catch (e) {
    console.warn("save failed:", e);
    state.saveStatus = "error";
  }
  setTimeout(() => {
    if (state.saveStatus === "saved" || state.saveStatus === "error") state.saveStatus = "idle";
    hooks.onHudUpdate();
  }, 1500);
}

function checkCombat(state: ArrivalState): boolean {
  for (const e of state.enemies) {
    if (hexDistance(state.player.tile, e.tile) <= 1) {
      state.combatTile = { ...e.tile };
      return true;
    }
  }
  state.combatTile = null;
  return false;
}
