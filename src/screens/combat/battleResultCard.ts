// Reusable end-of-battle summary card: winner banner + per-platoon casualties
// for both sides. Used today only by the Test Battle sandbox (manualBattleArena.ts),
// but shaped generically (BattleResult + a single onCarryOn callback) so a
// future production flow can reuse it with an additional "Manual Fight" retry
// button without reshaping this component.

import type { BattleResult, CombatantResult } from "@heroes/engine";
import { getCachedUnit } from "../../data/unitCatalog";
import { menuTheme, openCenteredModal, styleButton } from "@screens/shared/menu";

export interface BattleResultCardOptions {
  result: BattleResult;
  attackerLabel: string;
  defenderLabel: string;
  onCarryOn: () => void;
}

function unitName(unitTypeId: string): string {
  return getCachedUnit(unitTypeId)?.name ?? unitTypeId;
}

function renderSideResults(title: string, results: CombatantResult[]): HTMLElement {
  const col = document.createElement("div");
  col.style.flex = "1";
  col.style.minWidth = "0";

  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.fontWeight = "600";
  heading.style.marginBottom = "6px";
  col.appendChild(heading);

  const withTroops = results.filter((r) => r.platoon.entries.length > 0 || r.casualties.length > 0);
  if (withTroops.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No platoons fielded.";
    empty.style.opacity = "0.6";
    empty.style.fontSize = "11px";
    col.appendChild(empty);
    return col;
  }

  for (const r of withTroops) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "3px",
      padding: "4px 8px",
      marginBottom: "4px",
      fontSize: "11px",
      backgroundColor: "#1a1a1a",
    });

    const survivors = r.platoon.entries.map((e) => `${unitName(e.unitTypeId)} x${e.count}`).join(", ") || "wiped out";
    const survivorLine = document.createElement("div");
    survivorLine.textContent = `Survivors: ${survivors}`;
    row.appendChild(survivorLine);

    if (r.casualties.length > 0) {
      const casLine = document.createElement("div");
      casLine.textContent = `Lost: ${r.casualties.map((c) => `${unitName(c.unitTypeId)} x${c.count}`).join(", ")}`;
      casLine.style.color = "#f88";
      casLine.style.marginTop = "2px";
      row.appendChild(casLine);
    }

    col.appendChild(row);
  }

  return col;
}

export function showBattleResultCard(opts: BattleResultCardOptions): void {
  const modal = openCenteredModal(document.body, "Battle Results", 480, false, false);

  modal.setOnClose(() => {
    modal.root.parentElement?.remove();
    opts.onCarryOn();
  });

  const banner = document.createElement("div");
  const winnerText =
    opts.result.winner === "attacker"
      ? `${opts.attackerLabel} wins!`
      : opts.result.winner === "defender"
        ? `${opts.defenderLabel} wins!`
        : "Draw — both sides fell.";
  banner.textContent = winnerText;
  banner.style.fontSize = "16px";
  banner.style.fontWeight = "700";
  banner.style.textAlign = "center";
  banner.style.margin = "4px 0 4px";
  modal.appendContent(banner);

  const roundsLine = document.createElement("div");
  roundsLine.textContent = `Resolved in ${opts.result.rounds} round${opts.result.rounds === 1 ? "" : "s"}.`;
  roundsLine.style.opacity = "0.65";
  roundsLine.style.fontSize = "11px";
  roundsLine.style.textAlign = "center";
  roundsLine.style.marginBottom = "10px";
  modal.appendContent(roundsLine);

  const columns = document.createElement("div");
  columns.style.display = "flex";
  columns.style.gap = "14px";
  columns.style.fontFamily = menuTheme.font;
  columns.appendChild(renderSideResults(opts.attackerLabel, opts.result.attackerResults));
  columns.appendChild(renderSideResults(opts.defenderLabel, opts.result.defenderResults));
  modal.appendContent(columns);

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.marginTop = "12px";

  const carryOnBtn = document.createElement("button");
  carryOnBtn.textContent = "Carry On";
  styleButton(carryOnBtn, true);
  carryOnBtn.addEventListener("click", () => {
    modal.close();
  });
  row.appendChild(carryOnBtn);
  modal.appendContent(row);
}
