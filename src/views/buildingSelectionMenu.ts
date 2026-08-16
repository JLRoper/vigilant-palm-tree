import { PopupMenu, styleButton } from "./menu";
import type { BuildingDef, BuildingKind } from "../render/cityBuildingDraw";
import type { SettlementState } from "../state/gameState";
import {
  buildingLabel,
  buildingSettlementEffects,
  buildingPlayerEffects,
  buildingUpkeep,
  buildingUpgradeCost,
  combineUpgradeCosts,
  type BuildingUpgradeCost,
} from "@heroes/engine";
import { menuTheme } from "./menu";

export interface BuildingSelectionMenuOptions {
  onUpgrade: (combined: BuildingUpgradeCost) => void;
}

export interface SelectedBuildingEntry {
  key: string;
  building: BuildingDef;
}

function fmt(v: number, suffix: string): string {
  return `${v}${suffix}`;
}

function formatCost(cost: BuildingUpgradeCost): string {
  const parts: string[] = [];
  if (cost.gold > 0) parts.push(fmt(cost.gold, "g"));
  if (cost.wood > 0) parts.push(fmt(cost.wood, "w"));
  if (cost.stone > 0) parts.push(fmt(cost.stone, "s"));
  parts.push(`${cost.days}d`);
  return parts.join(" ");
}

function aggregateEffects(entries: SelectedBuildingEntry[]): {
  goldPerTurn: number;
  foodPerTurn: number;
  populationBonus: number;
  defenseBonus: number;
  resourceYieldBonus: Partial<Record<string, number>>;
  visionRangeBonus: number;
  controlRangeBonus: number;
  heroAttackBonus: number;
  upkeepWood: number;
  upkeepStone: number;
} {
  const acc = {
    goldPerTurn: 0,
    foodPerTurn: 0,
    populationBonus: 0,
    defenseBonus: 0,
    resourceYieldBonus: {} as Record<string, number>,
    visionRangeBonus: 0,
    controlRangeBonus: 0,
    heroAttackBonus: 0,
    upkeepWood: 0,
    upkeepStone: 0,
  };
  for (const e of entries) {
    const targetLevel = (e.building.level + 1) as 2 | 3;
    const se = buildingSettlementEffects(e.building.kind, targetLevel);
    const pe = buildingPlayerEffects(e.building.kind, targetLevel);
    const uk = buildingUpkeep(e.building.kind, targetLevel);
    acc.goldPerTurn += se.goldPerTurn ?? 0;
    acc.foodPerTurn += se.foodPerTurn ?? 0;
    acc.populationBonus += se.populationBonus ?? 0;
    acc.defenseBonus += se.defenseBonus ?? 0;
    acc.visionRangeBonus += pe.visionRangeBonus ?? 0;
    acc.controlRangeBonus += pe.controlRangeBonus ?? 0;
    acc.heroAttackBonus += pe.heroAttackBonus ?? 0;
    acc.upkeepWood += uk.wood;
    acc.upkeepStone += uk.stone;
    if (se.resourceYieldBonus) {
      for (const [r, v] of Object.entries(se.resourceYieldBonus)) {
        acc.resourceYieldBonus[r] = (acc.resourceYieldBonus[r] ?? 0) + (v ?? 0);
      }
    }
  }
  return acc;
}

export class BuildingSelectionMenu {
  private menu: PopupMenu | null = null;
  private entries: SelectedBuildingEntry[] = [];
  private settlement: SettlementState | null = null;
  private onUpgrade: (combined: BuildingUpgradeCost) => void;

  constructor(opts: BuildingSelectionMenuOptions) {
    this.onUpgrade = opts.onUpgrade;
  }

  show(
    entries: SelectedBuildingEntry[],
    settlement: SettlementState | null,
    screenX: number,
    screenY: number,
  ): void {
    this.hide();
    this.entries = entries;
    this.settlement = settlement;

    const counts = new Map<BuildingKind, number>();
    for (const e of this.entries) {
      counts.set(e.building.kind, (counts.get(e.building.kind) ?? 0) + 1);
    }
    const titleParts: string[] = [];
    for (const [kind, n] of counts) {
      titleParts.push(`${n}× ${buildingLabel(kind)}`);
    }
    const title = titleParts.length > 0 ? titleParts.join(", ") : "Selected Buildings";

    const width = 280;
    const x = Math.max(10, Math.min(screenX, window.innerWidth - width - 10));
    const y = Math.max(10, Math.min(screenY, window.innerHeight - 260));

    this.menu = new PopupMenu({
      parent: document.body,
      title,
      initialPosition: { x, y },
      width,
      zIndex: 75,
      onClose: () => { this.menu = null; },
    });

    const list = document.createElement("div");
    Object.assign(list.style, {
      fontSize: "11px",
      opacity: "0.85",
      maxHeight: "120px",
      overflowY: "auto",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "3px",
      padding: "4px 6px",
      marginBottom: "6px",
    });
    for (const e of entries) {
      const row = document.createElement("div");
      row.textContent = `${buildingLabel(e.building.kind)} L${e.building.level} \u2192 L${e.building.level + 1}  (${e.building.gx},${e.building.gy})`;
      Object.assign(row.style, {
        display: "flex",
        justifyContent: "space-between",
        padding: "2px 0",
        color: "#ccc",
      });
      list.appendChild(row);
    }
    this.menu.appendContent(list);

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No buildings selected.";
      empty.style.fontSize = "11px";
      empty.style.opacity = "0.6";
      this.menu.appendContent(empty);
      return;
    }

    const costs = entries
      .map((e) => buildingUpgradeCost(e.building.kind, e.building.level))
      .filter((c): c is BuildingUpgradeCost => c !== null);
    const combined = combineUpgradeCosts(costs);
    const effects = aggregateEffects(entries);

    const effectsDiv = document.createElement("div");
    Object.assign(effectsDiv.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      fontSize: "11px",
      color: "#8f8",
      marginBottom: "6px",
    });
    const lines: string[] = [];
    if (effects.goldPerTurn) lines.push(`+${effects.goldPerTurn} gold/turn`);
    if (effects.foodPerTurn) lines.push(`+${effects.foodPerTurn} food/turn`);
    if (effects.populationBonus) lines.push(`+${effects.populationBonus} population`);
    if (effects.defenseBonus) lines.push(`+${effects.defenseBonus} defense`);
    if (effects.visionRangeBonus) lines.push(`+${effects.visionRangeBonus} vision range`);
    if (effects.controlRangeBonus) lines.push(`+${effects.controlRangeBonus} control range`);
    if (effects.heroAttackBonus) lines.push(`+${effects.heroAttackBonus} hero attack`);
    for (const [r, v] of Object.entries(effects.resourceYieldBonus)) {
      if ((v ?? 0) > 0) lines.push(`+${v} ${r}/turn`);
    }
    if (effects.upkeepWood > 0 || effects.upkeepStone > 0) {
      const parts: string[] = [];
      if (effects.upkeepWood > 0) parts.push(`${effects.upkeepWood}w`);
      if (effects.upkeepStone > 0) parts.push(`${effects.upkeepStone}s`);
      lines.push(`Upkeep: ${parts.join(" ")}/turn`);
    }
    if (lines.length === 0) {
      lines.push("(no stat changes)");
    }
    for (const line of lines) {
      const el = document.createElement("div");
      el.textContent = line;
      effectsDiv.appendChild(el);
    }
    this.menu.appendContent(effectsDiv);

    const costDiv = document.createElement("div");
    costDiv.textContent = `Upgrade cost: ${formatCost(combined)}`;
    Object.assign(costDiv.style, {
      fontSize: "12px",
      color: "#eee",
      marginBottom: "8px",
    });
    this.menu.appendContent(costDiv);

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
    });

    const canAfford = this.settlement
      ? this.settlement.gold >= combined.gold
        && (this.settlement.warehouse.wood ?? 0) >= combined.wood
        && (this.settlement.warehouse.stone ?? 0) >= combined.stone
        && !this.settlement.upgrade
      : false;

    const upgradeBtn = document.createElement("button");
    upgradeBtn.textContent = `Upgrade ${entries.length}`;
    styleButton(upgradeBtn, true);
    if (!canAfford) {
      upgradeBtn.style.opacity = "0.4";
      upgradeBtn.style.cursor = "not-allowed";
    }
    upgradeBtn.disabled = !canAfford;
    upgradeBtn.addEventListener("click", () => {
      if (canAfford) {
        this.onUpgrade(combined);
        this.hide();
      }
    });
    row.appendChild(upgradeBtn);

    this.menu.appendContent(row);
    void menuTheme;
  }

  hide(): void {
    if (this.menu) {
      this.menu.close();
      this.menu = null;
    }
  }

  isOpen(): boolean {
    return this.menu !== null;
  }
}
