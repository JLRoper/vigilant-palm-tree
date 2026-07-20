import { Axial } from "../core/hex";
import { Camera } from "../render/camera";
import { GameMap } from "../map/gameMap";
import type { GameState } from "../state/gameState";
import type { Hero } from "../entities/hero";
import type { Castle } from "../entities/settlement";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface HudHandles {
  textSpan: HTMLSpanElement;
}

export function buildHud(buttonContainer: HTMLElement): HudHandles {
  const textSpan = document.createElement("span");
  textSpan.id = "hud-text";
  buttonContainer.appendChild(textSpan);
  return { textSpan };
}

export function updateHud(
  _hud: HTMLElement,
  state: GameState,
  heroes: Record<string, Hero>,
  settlements: Record<string, Castle>,
  hover: Axial | null,
  map: GameMap,
  camera: Camera,
  backendOk: boolean,
  saveStatus: SaveStatus,
  lastSavedAt: string | null,
  handles: HudHandles
): void {
  const base = `Drag to pan · Wheel to zoom · Zoom ${camera.zoom.toFixed(2)}x`;
  const phase = phaseLabel(state);
  const roundLine = `Round ${state.round}`;
  const selected = state.selectedHeroId ? state.heroes[state.selectedHeroId] : null;
  const movementLine = selected
    ? ` · Movement: ${selected.movementRemaining.toFixed(1)}/7`
    : "";
  const playerHero = Object.values(heroes).find((h) => h.ownerId === 0);
  const heroInfo = playerHero
    ? `Hero (${playerHero.tile.q}, ${playerHero.tile.r})${playerHero.moving ? " moving" : ""}`
    : "No hero";
  const enemyCount = Object.values(heroes).filter((h) => h.ownerId !== 0).length;
  const enemiesLine = `${enemyCount} enemy hero${enemyCount === 1 ? "" : "s"}`;
  const player0 = state.players[0];
  const goldLine = player0 ? `${player0.gold}g` : "0g";
  const status = `${phase} · ${roundLine} · ${goldLine} · ${enemiesLine}${movementLine}`;
  const dbInfo = backendOk ? `DB ${saveStatus}` : "DB offline";
  const savedInfo = lastSavedAt ? ` · Last saved ${formatTime(lastSavedAt)}` : "";
  const text = !hover
    ? `${heroInfo} · ${status} · ${dbInfo}${savedInfo} · ${base}`
    : (() => {
        const t = map.get(hover.q, hover.r);
        const tile = `Tile (${hover.q}, ${hover.r}) · ${t ?? "void"}`;
        const resourceInfo = map.resourceTileAt(hover.q, hover.r);
        const resourceLine = resourceInfo ? ` · Resource: ${resourceInfo.resource}` : "";
        const settle = Object.values(settlements).find(
          (s) => s.tile.q === hover.q && s.tile.r === hover.r
        );
        const settleLine = settle ? ` · Castle L${settle.level}` : "";
        return `${tile}${resourceLine}${settleLine} · ${heroInfo} · ${status} · ${dbInfo}${savedInfo} · ${base}`;
      })();
  handles.textSpan.textContent = text;
}

export function canEndTurn(state: GameState): boolean {
  if (state.phase.kind !== "PLAYER_TURN") return false;
  const phase = state.phase;
  const p = state.players.find((pl) => pl.id === phase.playerId);
  return p?.faction === "player";
}

function phaseLabel(state: GameState): string {
  switch (state.phase.kind) {
    case "PLAYER_TURN": {
      const phase = state.phase;
      const p = state.players.find((pl) => pl.id === phase.playerId);
      return `Turn: ${p?.name ?? `Player ${phase.playerId + 1}`}`;
    }
    case "AI_TURN": {
      const phase = state.phase;
      const p = state.players.find((pl) => pl.id === phase.playerId);
      return `${p?.name ?? "AI"}'s Turn`;
    }
    case "BATTLE":
      return "Battle!";
    case "ROUND_END": {
      const phase = state.phase;
      return `Round End → ${phase.nextRound}`;
    }
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}
