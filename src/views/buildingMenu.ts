import { PopupMenu, styleButton } from "./menu";
import type { BuildingDef, BuildingKind } from "../render/cityBuildingDraw";
import type { SettlementState } from "../state/gameState";

function buildingLabel(kind: BuildingKind, level: number): string {
  const names: Record<BuildingKind, string> = {
    townHall:    "Town Hall",
    house:       "House",
    tower:       "Tower",
    mageGuild:   "Mage Guild",
    mine:        "Mine",
    market:      "Market",
    barracks:    "Barracks",
    smithy:      "Smithy",
    apartment:   "Apartment",
    farmField:   "Farm Field",
    farmhouse:   "Farmhouse",
    archeryRange: "Archery Range",
  };
  const name = names[kind] ?? kind;
  return level > 1 ? `${name} (Lv ${level})` : name;
}

function buildingDescription(kind: BuildingKind): string {
  const descs: Record<BuildingKind, string> = {
    townHall:    "Center of settlement governance.",
    house:       "A humble dwelling.",
    tower:       "A tall defensive spire.",
    mageGuild:   "Arcane research and spellcraft.",
    mine:        "Extracts raw resources.",
    market:      "Trade goods and gold.",
    barracks:    "Trains melee infantry.",
    smithy:      "Forge weaponry and armor.",
    apartment:   "Multi-level living quarters.",
    farmField:   "Cultivated crop rows.",
    farmhouse:   "A small rural home.",
    archeryRange: "Train and recruit ranged units.",
  };
  return descs[kind] ?? "";
}

export interface BuildingMenuOptions {
  onRecruitArcher?: () => void;
  onUpgradeTownHall?: () => void;
}

const TOWN_HALL_UPGRADE_COSTS: Record<number, { gold: number; wood: number; stone: number; days: number }> = {
  1: { gold: 1500, wood: 15, stone: 10, days: 7 },
  2: { gold: 5000, wood: 40, stone: 25, days: 12 },
};

export class BuildingMenu {
  private menu: PopupMenu | null = null;
  private onRecruitArcher: (() => void) | undefined;
  private onUpgradeTownHall: (() => void) | undefined;

  constructor(opts: BuildingMenuOptions = {}) {
    this.onRecruitArcher = opts.onRecruitArcher;
    this.onUpgradeTownHall = opts.onUpgradeTownHall;
  }

  show(building: BuildingDef, screenX: number, screenY: number, settlement?: SettlementState): void {
    this.hide();

    const x = Math.max(10, Math.min(screenX, window.innerWidth - 240));
    const y = Math.max(10, Math.min(screenY, window.innerHeight - 180));

    this.menu = new PopupMenu({
      parent: document.body,
      title: buildingLabel(building.kind, building.level),
      initialPosition: { x, y },
      width: 220,
      zIndex: 75,
      onClose: () => { this.menu = null; },
    });

    const desc = document.createElement("div");
    desc.textContent = buildingDescription(building.kind);
    Object.assign(desc.style, {
      fontSize: "12px",
      opacity: "0.8",
      lineHeight: "1.4",
      marginBottom: "4px",
    });
    this.menu.appendContent(desc);

    if (building.kind === "townHall" && building.level < 3 && this.onUpgradeTownHall) {
      const cost = TOWN_HALL_UPGRADE_COSTS[building.level];
      if (cost) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.marginTop = "4px";
        row.style.marginBottom = "4px";

        const info = document.createElement("span");
        info.textContent = `L${building.level + 1}: ${cost.gold}g ${cost.wood}w ${cost.stone}s / ${cost.days}d`;
        info.style.fontSize = "10px";
        info.style.opacity = "0.75";
        row.appendChild(info);

        const canAfford = settlement && settlement.gold >= cost.gold
          && (settlement.warehouse.wood ?? 0) >= cost.wood
          && (settlement.warehouse.stone ?? 0) >= cost.stone
          && !settlement.upgrade;

        const upgradeBtn = document.createElement("button");
        upgradeBtn.textContent = "Upgrade";
        styleButton(upgradeBtn, true);
        upgradeBtn.style.padding = "2px 8px";
        upgradeBtn.style.fontSize = "11px";
        if (!canAfford) {
          upgradeBtn.style.opacity = "0.4";
          upgradeBtn.style.cursor = "not-allowed";
        }
        upgradeBtn.disabled = !canAfford;
        upgradeBtn.addEventListener("click", () => {
          if (canAfford) {
            this.onUpgradeTownHall?.();
            this.hide();
          }
        });
        row.appendChild(upgradeBtn);

        this.menu.appendContent(row);
      }
    }

    if (building.kind === "archeryRange") {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "flex-end";
      row.style.gap = "8px";

      const recruitBtn = document.createElement("button");
      recruitBtn.textContent = "Recruit Archer";
      styleButton(recruitBtn, true);
      recruitBtn.addEventListener("click", () => {
        this.onRecruitArcher?.();
        this.hide();
      });
      row.appendChild(recruitBtn);

      this.menu.appendContent(row);
    }
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
