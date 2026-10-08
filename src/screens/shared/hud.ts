import type { GameState, PlayerId } from "../../state/gameState";
import {
  buildingUpkeepRequired,
  foodRequired,
  moraleDecay,
  playerEffectiveSettlementIncome,
  playerIncome,
  playerWealth,
} from "@heroes/engine";
import {
  empireUpkeepLabel,
  empireUpkeepTitleClause,
  liveEmpireUpkeepCost,
} from "./heroUpkeepCost";

export { canEndTurn } from "@heroes/engine";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface HudHandles {
  textSpan: HTMLSpanElement;
}

export interface PathCostReadout {
  costToSplit: number;
  totalCost: number;
  destinationReachable: boolean;
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
  pathReadout: PathCostReadout | null = null,
): void {
  const roundLine = `Round ${state.round}`;
  const selected = state.selectedHeroId ? state.heroes[state.selectedHeroId] : null;
  const movementLine = selected
    ? ` · Movement: ${Math.round(Math.max(0, selected.movementRemaining))}/7${formatPathReadout(pathReadout)}`
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
  handles.textSpan.title = economyBreakdown(state, ownerId);
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
  const total = playerEffectiveSettlementIncome(state, ownerId);
  const base = playerIncome(state, ownerId);
  return `Empire Income: ${fmtNum(total)}/${fmtNum(base)}g`;
}

function playerUpkeep(state: GameState, ownerId: PlayerId): string {
  const owned = Object.values(state.heroes).filter((h) => h.ownerId === ownerId);
  return empireUpkeepLabel(liveEmpireUpkeepCost(owned));
}

// F10 (playtest fixes 2026-09-29): "· Path 4.6/7" while the previewed
// destination is reachable this turn, "· Path 4.6 of 9.8" while the path is
// clamped by remaining movement. Empty string when no path is previewed.
function formatPathReadout(readout: PathCostReadout | null): string {
  if (!readout) return "";
  return readout.destinationReachable
    ? ` · Path ${readout.costToSplit.toFixed(1)}/7`
    : ` · Path ${readout.costToSplit.toFixed(1)} of ${readout.totalCost.toFixed(1)}`;
}

// F11 (playtest fixes 2026-09-29): hover breakdown for the HUD economy row.
// Presentation only -- every number comes from @heroes/engine's exported
// formulas, mirroring what the round pipeline (applyEndOfTurn) actually does.
// Set as the hud-text title attribute; newlines render as line breaks in the
// native tooltip. "Empire Income" (playerEffectiveSettlementIncome) is the
// morale-scaled population tax plus building goldPerTurn — matching what
// applyEndOfTurn pays (produceSettlementResources pays building gold;
// applyEffectiveIncome pays the morale-scaled tax). next-turn gold
// (playerIncome) is the same figure without morale scaling on the tax half.
function economyBreakdown(state: GameState, ownerId: PlayerId): string {
  const owned = Object.values(state.settlements).filter((s) => s.ownerId === ownerId);
  if (owned.length === 0) return "Empire Income: 0g — you own no settlements.";
  const popTax = owned.reduce((acc, s) => acc + (s.population ?? 0) * (s.goldTax ?? 0), 0);
  const eff = playerEffectiveSettlementIncome(state, ownerId);
  const morale = Math.round(owned.reduce((acc, s) => acc + (s.morale ?? 100), 0) / owned.length);
  const nextGold = playerIncome(state, ownerId);
  const buildingGold = nextGold - popTax;
  const foodHave = owned.reduce((acc, s) => acc + (s.warehouse.food ?? 0), 0);
  const foodNeed = owned.reduce((acc, s) => acc + foodRequired(s), 0);
  const upkeep = owned.reduce(
    (acc, s) => {
      const u = buildingUpkeepRequired(s);
      return { wood: acc.wood + u.wood, stone: acc.stone + u.stone };
    },
    { wood: 0, stone: 0 },
  );
  const decay = owned.reduce((acc, s) => acc + moraleDecay(s), 0);
  const troopBill = liveEmpireUpkeepCost(Object.values(state.heroes).filter((h) => h.ownerId === ownerId));
  const moraleTrend = decay > 0 ? `morale −${fmtNum(decay)}/round` : "morale stable";
  return [
    `Income: settlements ${fmtNum(popTax)}g pop-tax + ${fmtNum(buildingGold)}g buildings → morale ${morale}% on tax → ${fmtNum(eff)}g/round to treasuries`,
    `${empireUpkeepTitleClause(troopBill)} · buildings ${fmtNum(upkeep.wood)} wood + ${fmtNum(upkeep.stone)} stone/wk · food ${fmtNum(foodHave)}/${fmtNum(foodNeed)} → ${moraleTrend}`,
    `${fmtNum(buildingGold)}g building gold is morale-stable and counted in both Empire Income (${fmtNum(eff)}g) and next-turn gold (${fmtNum(nextGold)}g)`,
  ].join("\n");
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}
