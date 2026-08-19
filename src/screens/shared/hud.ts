import type { GameState, PlayerId } from "../../state/gameState";
import { effectiveIncome, playerWealth } from "@heroes/engine";

export { canEndTurn } from "@heroes/engine";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface HudHandles {
  textSpan: HTMLSpanElement;
}

export function buildHud(container: HTMLElement): HudHandles {
  const hudEl = document.createElement("div");
  hudEl.id = "hud";
  const textSpan = document.createElement("span");
  textSpan.id = "hud-text";
  hudEl.appendChild(textSpan);
  container.appendChild(hudEl);
  return { textSpan };
}

export function updateHud(
  _hud: HTMLElement,
  state: GameState,
  lastSavedAt: string | null,
  handles: HudHandles,
  localPlayerId: PlayerId | null,
): void {
  const roundLine = `Round ${state.round}`;
  const selected = state.selectedHeroId ? state.heroes[state.selectedHeroId] : null;
  const movementLine = selected
    ? ` · Movement: ${Math.round(Math.max(0, selected.movementRemaining))}/7`
    : "";
  const charterLine = selected?.isChartering ? (() => {
    const ch = state.activeCharters.find((c) => c.id === selected.charterId);
    if (!ch) return "";
    if (ch.phase === "traveling") return ` · Chartering: traveling to ${ch.settlementName}`;
    return ` · Chartering: ${ch.daysRemaining} days remaining`;
  })() : "";
  const ownerId = localPlayerId ?? 0;
  const wealthLine = `Empire Wealth: ${playerWealth(state, ownerId)}g`;
  const moraleLine = playerMorale(state, ownerId);
  const effectiveIncomeLine = playerEffectiveIncome(state, ownerId);
  const upkeepLine = playerUpkeep(state, ownerId);
  const status = `${roundLine} · ${wealthLine}${movementLine}${charterLine}`;
  const savedInfo = lastSavedAt ? ` · Last saved ${formatTime(lastSavedAt)}` : "";
  const econLine = `${effectiveIncomeLine} · ${upkeepLine} · ${moraleLine}`;
  const text = `${status} · ${econLine}${savedInfo}`;
  handles.textSpan.textContent = text;
}

function playerMorale(state: GameState, ownerId: PlayerId): string {
  const owned = Object.values(state.settlements).filter((s) => s.ownerId === ownerId);
  if (owned.length === 0) return "Empire Morale: n/a";
  const sum = owned.reduce((acc, s) => acc + (s.morale ?? 100), 0);
  const avg = Math.round(sum / owned.length);
  return `Empire Morale: ${avg}%`;
}

function playerEffectiveIncome(state: GameState, ownerId: PlayerId): string {
  const owned = Object.values(state.settlements).filter((s) => s.ownerId === ownerId);
  if (owned.length === 0) return "Empire Income: 0g";
  const total = owned.reduce((acc, s) => acc + effectiveIncome(s), 0);
  const base = owned.reduce((acc, s) => acc + (s.population ?? 0) * (s.goldTax ?? 0), 0);
  return `Empire Income: ${total}/${base}g`;
}

function playerUpkeep(state: GameState, ownerId: PlayerId): string {
  const owned = Object.values(state.heroes).filter((h) => h.ownerId === ownerId);
  const cost = owned.reduce((acc, h) => acc + h.troops, 0);
  return `Empire Upkeep: ${cost}g/week`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}
