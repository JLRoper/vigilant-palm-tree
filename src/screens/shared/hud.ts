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
  handles.context.textContent = clauses.join(" · ");

  const ownedHeroes = Object.values(state.heroes).filter((h) => h.ownerId === ownerId);
  const upkeepBill = liveEmpireUpkeepCost(ownedHeroes);

  handles.round.textContent = String(state.round);
  handles.wealth.textContent = `${playerWealth(state, ownerId)}g`;
  handles.income.textContent = `${fmtNum(playerEffectiveSettlementIncome(state, ownerId))}/${fmtNum(playerIncome(state, ownerId))}g`;
  handles.upkeep.textContent = `${fmtNum(upkeepBill.gold)}g + ${fmtNum(upkeepBill.food)} food`;
  handles.morale.textContent = playerMoraleValue(state, ownerId);
  handles.root.title = economyBreakdown(state, ownerId);
}

function playerMoraleValue(state: GameState, ownerId: PlayerId): string {
  const owned = Object.values(state.settlements).filter((s) => s.ownerId === ownerId);
  if (owned.length === 0) return "n/a";
  const sum = owned.reduce((acc, s) => acc + (s.morale ?? 100), 0);
  return `${Math.round(sum / owned.length)}%`;
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

// F11 (playtest fixes 2026-09-29): hover breakdown for the HUD economy pills.
// Presentation only -- every number comes from @heroes/engine's exported
// formulas, mirroring what the round pipeline (applyEndOfTurn) actually does.
// Newlines render as line breaks in the native tooltip. "Empire Income"
// (playerEffectiveSettlementIncome) is the morale-scaled population tax plus
// building goldPerTurn — matching what applyEndOfTurn pays
// (produceSettlementResources pays building gold; applyEffectiveIncome pays
// the morale-scaled tax). next-turn gold (playerIncome) is the same figure
// without morale scaling on the tax half.
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
