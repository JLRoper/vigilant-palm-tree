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
  empireUpkeepTitleClause,
  liveEmpireUpkeepCost,
} from "./heroUpkeepCost";
import { makeStatPill } from "./statPill";

export { canEndTurn } from "@heroes/engine";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

// The HUD is now a row of labeled pills plus a trailing context segment, all
// inside the toolbar's status row. The economy breakdown stays one tooltip on
// the whole row, so no number is lost by dropping the run-on sentence.
export interface HudHandles {
  root: HTMLElement;
  round: HTMLElement;
  wealth: HTMLElement;
  income: HTMLElement;
  upkeep: HTMLElement;
  morale: HTMLElement;
  context: HTMLElement;
}

export interface PathCostReadout {
  costToSplit: number;
  totalCost: number;
  destinationReachable: boolean;
}

export function buildHud(container: HTMLElement): HudHandles {
  const hudEl = document.createElement("div");
  hudEl.id = "hud";
  const round = makeStatPill("Round");
  const wealth = makeStatPill("Wealth");
  const income = makeStatPill("Income");
  const upkeep = makeStatPill("Upkeep");
  const morale = makeStatPill("Morale");
  const context = document.createElement("span");
  context.id = "hud-context";
  Object.assign(context.style, {
    marginLeft: "auto",
    color: "var(--tb-text-dim, #b6c0d4)",
    fontSize: "11.5px",
    fontWeight: "500",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  });
  hudEl.append(round.chip, wealth.chip, income.chip, upkeep.chip, morale.chip, context);
  container.appendChild(hudEl);
  return {
    root: hudEl,
    round: round.value,
    wealth: wealth.value,
    income: income.value,
    upkeep: upkeep.value,
    morale: morale.value,
    context,
  };
}

interface EconomyHudSnapshot {
  state: GameState;
  ownerId: PlayerId;
  round: number;
  day: number;
  roundText: string;
  wealthText: string;
  incomeText: string;
  upkeepText: string;
  moraleText: string;
  breakdownTitle: string;
}

let lastEconSnapshot: EconomyHudSnapshot | null = null;
let lastFormattedIso: string | null = null;
let lastFormattedTime = "";

function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) {
    el.textContent = value;
  }
}

function setTitle(el: HTMLElement, value: string): void {
  if (el.title !== value) {
    el.title = value;
  }
}

export function updateHud(
  state: GameState,
  lastSavedAt: string | null,
  handles: HudHandles,
  localPlayerId: PlayerId | null,
  pathReadout: PathCostReadout | null = null,
): void {
  const ownerId = localPlayerId ?? 0;

  const clauses: string[] = [];
  const selected = state.selectedHeroId ? state.heroes[state.selectedHeroId] : null;
  if (selected) {
    if (selected.isChartering) {
      const ch = state.activeCharters.find((c) => c.id === selected.charterId);
      if (!ch) {
        clauses.push("Chartering");
      } else if (ch.phase === "traveling") {
        clauses.push(`Chartering: traveling to ${ch.settlementName}`);
      } else {
        clauses.push(`Chartering: ${ch.daysRemaining} days remaining`);
      }
    } else {
      clauses.push(`Movement ${Math.round(Math.max(0, selected.movementRemaining))}/7`);
      const path = formatPathReadout(pathReadout);
      if (path) clauses.push(path);
    }
  }
  if (lastSavedAt) clauses.push(`Last saved ${formatTime(lastSavedAt)}`);
  setText(handles.context, clauses.join(" · "));

  const econ = getEconomyHudSnapshot(state, ownerId);
  setText(handles.round, econ.roundText);
  setText(handles.wealth, econ.wealthText);
  setText(handles.income, econ.incomeText);
  setText(handles.upkeep, econ.upkeepText);
  setText(handles.morale, econ.moraleText);
  setTitle(handles.root, econ.breakdownTitle);
}

function getEconomyHudSnapshot(state: GameState, ownerId: PlayerId): EconomyHudSnapshot {
  if (
    lastEconSnapshot &&
    lastEconSnapshot.state === state &&
    lastEconSnapshot.ownerId === ownerId &&
    lastEconSnapshot.round === state.round &&
    lastEconSnapshot.day === state.day
  ) {
    return lastEconSnapshot;
  }

  const ownedHeroes = Object.values(state.heroes).filter((h) => h.ownerId === ownerId);
  const upkeepBill = liveEmpireUpkeepCost(ownedHeroes);
  const ownedSettlements = Object.values(state.settlements).filter((s) => s.ownerId === ownerId);
  const eff = playerEffectiveSettlementIncome(state, ownerId);
  const nextGold = playerIncome(state, ownerId);
  const moraleAvg =
    ownedSettlements.length === 0
      ? null
      : Math.round(ownedSettlements.reduce((acc, s) => acc + (s.morale ?? 100), 0) / ownedSettlements.length);

  let breakdownTitle: string;
  if (ownedSettlements.length === 0) {
    breakdownTitle = "Empire Income: 0g — you own no settlements.";
  } else {
    const popTax = ownedSettlements.reduce((acc, s) => acc + (s.population ?? 0) * (s.goldTax ?? 0), 0);
    const buildingGold = nextGold - popTax;
    const foodHave = ownedSettlements.reduce((acc, s) => acc + (s.warehouse.food ?? 0), 0);
    const foodNeed = ownedSettlements.reduce((acc, s) => acc + foodRequired(s), 0);
    const upkeep = ownedSettlements.reduce(
      (acc, s) => {
        const u = buildingUpkeepRequired(s);
        return { wood: acc.wood + u.wood, stone: acc.stone + u.stone };
      },
      { wood: 0, stone: 0 },
    );
    const decay = ownedSettlements.reduce((acc, s) => acc + moraleDecay(s), 0);
    const moraleTrend = decay > 0 ? `morale −${fmtNum(decay)}/round` : "morale stable";
    breakdownTitle = [
      `Income: settlements ${fmtNum(popTax)}g pop-tax + ${fmtNum(buildingGold)}g buildings → morale ${moraleAvg}% on tax → ${fmtNum(eff)}g/round to treasuries`,
      `${empireUpkeepTitleClause(upkeepBill)} · buildings ${fmtNum(upkeep.wood)} wood + ${fmtNum(upkeep.stone)} stone/wk · food ${fmtNum(foodHave)}/${fmtNum(foodNeed)} → ${moraleTrend}`,
      `${fmtNum(buildingGold)}g building gold is morale-stable and counted in both Empire Income (${fmtNum(eff)}g) and next-turn gold (${fmtNum(nextGold)}g)`,
    ].join("\n");
  }

  const snapshot: EconomyHudSnapshot = {
    state,
    ownerId,
    round: state.round,
    day: state.day,
    roundText: String(state.round),
    wealthText: `${playerWealth(state, ownerId)}g`,
    incomeText: `${fmtNum(eff)}/${fmtNum(nextGold)}g`,
    upkeepText: `${fmtNum(upkeepBill.gold)}g + ${fmtNum(upkeepBill.food)} food`,
    moraleText: moraleAvg === null ? "n/a" : `${moraleAvg}%`,
    breakdownTitle,
  };
  lastEconSnapshot = snapshot;
  return snapshot;
}

// F10 (playtest fixes 2026-09-29): "Path 4.6/7" while the previewed
// destination is reachable this turn, "Path 4.6 of 9.8" while the path is
// clamped by remaining movement. Empty string when no path is previewed.
function formatPathReadout(readout: PathCostReadout | null): string {
  if (!readout) return "";
  return readout.destinationReachable
    ? `Path ${readout.costToSplit.toFixed(1)}/7`
    : `Path ${readout.costToSplit.toFixed(1)} of ${readout.totalCost.toFixed(1)}`;
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function formatTime(iso: string): string {
  if (iso === lastFormattedIso) {
    return lastFormattedTime;
  }
  try {
    const d = new Date(iso);
    lastFormattedTime = d.toLocaleTimeString();
  } catch {
    lastFormattedTime = iso;
  }
  lastFormattedIso = iso;
  return lastFormattedTime;
}
