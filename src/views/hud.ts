import { Axial } from "../core/hex";
import { Camera } from "../render/camera";
import { GameMap } from "../map/gameMap";
import { Hero } from "../entities/hero";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function updateHud(
  hud: HTMLElement,
  player: Hero,
  enemies: Hero[],
  hover: Axial | null,
  map: GameMap,
  camera: Camera,
  turn: number,
  gold: number,
  combat: boolean,
  backendOk: boolean,
  saveStatus: SaveStatus,
  lastSavedAt: string | null = null
): void {
  const base = `Drag to pan · Wheel to zoom · Zoom ${camera.zoom.toFixed(2)}x`;
  const heroInfo = `Hero (${player.tile.q}, ${player.tile.r})${player.moving ? " moving" : ""}`;
  const enemiesLeft = `${enemies.length} enemy${enemies.length === 1 ? "" : "s"}`;
  const status = combat
    ? `COMBAT!`
    : `${turn} turn${turn === 1 ? "" : "s"} · ${gold}g · ${enemiesLeft}`;
  const dbInfo = backendOk ? `DB ${saveStatus}` : "DB offline";
  const savedInfo = lastSavedAt ? ` · Last saved ${formatTime(lastSavedAt)}` : "";
  if (!hover) {
    hud.textContent = `${heroInfo} · ${status} · ${dbInfo}${savedInfo} · ${base}`;
    return;
  }
  const t = map.get(hover.q, hover.r);
  const tile = `Tile (${hover.q}, ${hover.r}) · ${t ?? "void"}`;
  const resourceInfo = map.resourceTileAt(hover.q, hover.r);
  const resourceLine = resourceInfo ? ` · Resource: ${resourceInfo.resource}` : "";
  hud.textContent = `${tile}${resourceLine} · ${heroInfo} · ${status} · ${dbInfo}${savedInfo} · ${base}`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}
