import { openCenteredModal, menuTheme, styleButton } from "./menu";
import {
  settings,
  updateSettings,
  settingsBounds,
  borderWidthBounds,
  resourceStyleOptions,
  growthRateBounds,
  upgradeGateBounds,
  type GameSettings,
  type HorseVariant,
  type ResourceStyle,
} from "../state/settings";
import { openDeveloperSettingsMenu } from "./developerSettingsMenu";

const SPEED_LABELS: Array<{ min: number; label: string }> = [
  { min: 800, label: "Very slow (1s/hex)" },
  { min: 500, label: "Slow" },
  { min: 200, label: "Normal" },
  { min: 100, label: "Fast" },
  { min: 0, label: "Instant" },
];

const RESOURCE_STYLE_LABELS: Record<ResourceStyle, string> = {
  "rune-stone": "Rune stone",
  "cartography-pin": "Map pin",
  "illustrated-pin": "Painted pin",
  "constellation": "Constellation",
  "heraldic-crest": "Heraldic crest",
  "isometric-pile": "Iso pile",
  "iso-pile-smol": "Iso pile (smol)",
  "iso-bubbly": "Iso bubbly",
};

function labelFor(ms: number): string {
  for (const tier of SPEED_LABELS) {
    if (ms >= tier.min) return tier.label;
  }
  return SPEED_LABELS[SPEED_LABELS.length - 1].label;
}

export interface MapInfo {
  name: string;
  seed: number;
  mapSize: "small" | "medium" | "large";
  width: number;
  height: number;
  castleSeed: number;
  castleCount: number;
  heroQ: number;
  heroR: number;
  round: number;
  day: number;
  activePlayerName: string;
}

export interface SettingsMenuOptions {
  parent?: HTMLElement;
  getMapInfo?: () => MapInfo | null;
}

function makeFoldableSection(
  parent: HTMLElement,
  title: string,
  children: HTMLElement[],
  collapsed = true,
): HTMLElement {
  const frame = document.createElement("div");
  Object.assign(frame.style, {
    display: "flex",
    flexDirection: "column",
    border: "1px solid #444",
    borderRadius: "4px",
    backgroundColor: "#1a1a1a",
    overflow: "hidden",
  });

  const header = document.createElement("button");
  header.type = "button";
  header.textContent = collapsed ? `\u25b6 ${title}` : `\u25bc ${title}`;
  Object.assign(header.style, {
    all: "unset",
    fontWeight: "600",
    opacity: "0.85",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 10px",
    fontSize: "12px",
    fontFamily: menuTheme.font,
    color: menuTheme.panel.color,
    userSelect: "none",
  });
  frame.appendChild(header);

  const body = document.createElement("div");
  Object.assign(body.style, {
    display: collapsed ? "none" : "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "0 10px 10px 10px",
  });
  for (const child of children) {
    body.appendChild(child);
  }
  frame.appendChild(body);

  header.addEventListener("click", () => {
    const isCollapsed = body.style.display === "none";
    body.style.display = isCollapsed ? "flex" : "none";
    header.textContent = isCollapsed ? `\u25bc ${title}` : `\u25b6 ${title}`;
  });

  parent.appendChild(frame);
  return frame;
}

export function openSettingsMenu(opts: SettingsMenuOptions = {}): void {
  const parent = opts.parent ?? document.body;
  const bounds = settingsBounds();
  const borderBounds = borderWidthBounds();
  const growthBounds = growthRateBounds();
  const gateBounds = upgradeGateBounds();
  const current = settings();
  const mapInfo = opts.getMapInfo?.() ?? null;
  const refreshList: Array<() => void> = [];

  const modal = openCenteredModal(parent, "Settings", 420, true);

  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "10px";

  const intro = document.createElement("div");
  intro.textContent = "Adjust how the game feels. Changes apply instantly. Click a section to expand.";
  intro.style.opacity = "0.65";
  intro.style.fontSize = "11px";
  content.appendChild(intro);

  // ─── Map Info ──────────────────────────────────────────────────────────

  if (mapInfo) {
    const infoFields: Array<[string, string]> = [
      ["Name", mapInfo.name],
      ["Size", `${mapInfo.mapSize} (${mapInfo.width}\u00d7${mapInfo.height})`],
      ["Seed", String(mapInfo.seed)],
      ["Castle seed", String(mapInfo.castleSeed)],
      ["Castle count", String(mapInfo.castleCount)],
      ["Hero start", `${mapInfo.heroQ}, ${mapInfo.heroR}`],
      ["Round / Day", `${mapInfo.round} / ${mapInfo.day}`],
      ["Active player", mapInfo.activePlayerName],
    ];
    const children: HTMLElement[] = [];
    for (const [label, value] of infoFields) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.gap = "12px";
      row.style.fontSize = "11px";
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      labelEl.style.opacity = "0.55";
      const valEl = document.createElement("span");
      valEl.textContent = value ?? "\u2014";
      valEl.style.fontVariantNumeric = "tabular-nums";
      valEl.style.textAlign = "right";
      row.appendChild(labelEl);
      row.appendChild(valEl);
      children.push(row);
    }
    makeFoldableSection(content, "Map info", children, true);
  }

  // ─── Game Section ──────────────────────────────────────────────────────

  {
    const children: HTMLElement[] = [];

    // Movement speed
    const heroRow = document.createElement("div");
    heroRow.style.display = "flex";
    heroRow.style.flexDirection = "column";
    heroRow.style.gap = "6px";

    const heroLabelRow = document.createElement("div");
    heroLabelRow.style.display = "flex";
    heroLabelRow.style.justifyContent = "space-between";
    heroLabelRow.style.alignItems = "baseline";

    const heroLabel = document.createElement("span");
    heroLabel.textContent = "Hero movement speed";
    heroLabelRow.appendChild(heroLabel);

    const heroValue = document.createElement("span");
    heroValue.style.fontVariantNumeric = "tabular-nums";
    heroLabelRow.appendChild(heroValue);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(bounds.min);
    slider.max = String(bounds.max);
    slider.step = "10";
    slider.style.width = "100%";
    slider.style.accentColor = "#f77f00";
    heroRow.appendChild(slider);

    const hint = document.createElement("div");
    hint.style.fontSize = "10px";
    hint.style.opacity = "0.55";
    heroRow.appendChild(hint);

    function refresh(next: GameSettings): void {
      slider.value = String(next.moveDurationMs);
      heroValue.textContent = `${next.moveDurationMs}ms \u00b7 ${labelFor(next.moveDurationMs)}`;
      hint.textContent = `Lower = snappier. Higher = easier to follow along. (Range ${bounds.min}\u2013${bounds.max}ms)`;
    }
    refresh(current);
    slider.addEventListener("input", () => {
      updateSettings({ moveDurationMs: Number(slider.value) });
    });
    refreshList.push(() => refresh(settings()));

    children.push(heroRow);

    // Border thickness
    const borderRow = document.createElement("div");
    borderRow.style.display = "flex";
    borderRow.style.flexDirection = "column";
    borderRow.style.gap = "6px";

    const borderLabelRow = document.createElement("div");
    borderLabelRow.style.display = "flex";
    borderLabelRow.style.justifyContent = "space-between";
    borderLabelRow.style.alignItems = "baseline";

    const borderLabel = document.createElement("span");
    borderLabel.textContent = "Territory border thickness";
    borderLabelRow.appendChild(borderLabel);

    const borderValue = document.createElement("span");
    borderValue.style.fontVariantNumeric = "tabular-nums";
    borderLabelRow.appendChild(borderValue);

    const borderSlider = document.createElement("input");
    borderSlider.type = "range";
    borderSlider.min = String(borderBounds.min);
    borderSlider.max = String(borderBounds.max);
    borderSlider.step = "0.1";
    borderSlider.style.width = "100%";
    borderSlider.style.accentColor = "#f77f00";
    borderRow.appendChild(borderSlider);

    const borderHint = document.createElement("div");
    borderHint.style.fontSize = "10px";
    borderHint.style.opacity = "0.55";
    borderRow.appendChild(borderHint);

    function refreshBorder(next: GameSettings): void {
      borderSlider.value = String(next.territoryBorderWidth);
      borderValue.textContent = `${next.territoryBorderWidth}px`;
      borderHint.textContent = `Controls the thickness of colored territory outlines on the map. (Range ${borderBounds.min}\u2013${borderBounds.max}px)`;
    }
    refreshBorder(current);
    borderSlider.addEventListener("input", () => {
      updateSettings({ territoryBorderWidth: Number(borderSlider.value) });
    });
    refreshList.push(() => refreshBorder(settings()));

    children.push(borderRow);

    makeFoldableSection(content, "Game", children, true);
  }

  // ─── Population Section ────────────────────────────────────────────────

  {
    const children: HTMLElement[] = [];

    // Growth rate
    const growthRow = document.createElement("div");
    growthRow.style.display = "flex";
    growthRow.style.flexDirection = "column";
    growthRow.style.gap = "6px";

    const growthLabelRow = document.createElement("div");
    growthLabelRow.style.display = "flex";
    growthLabelRow.style.justifyContent = "space-between";
    growthLabelRow.style.alignItems = "baseline";

    const growthLabel = document.createElement("span");
    growthLabel.textContent = "Population growth rate";
    growthLabelRow.appendChild(growthLabel);

    const growthValue = document.createElement("span");
    growthValue.style.fontVariantNumeric = "tabular-nums";
    growthLabelRow.appendChild(growthValue);

    const growthSlider = document.createElement("input");
    growthSlider.type = "range";
    growthSlider.min = String(growthBounds.min);
    growthSlider.max = String(growthBounds.max);
    growthSlider.step = "0.01";
    growthSlider.style.width = "100%";
    growthSlider.style.accentColor = "#f77f00";
    growthRow.appendChild(growthSlider);

    const growthHint = document.createElement("div");
    growthHint.style.fontSize = "10px";
    growthHint.style.opacity = "0.55";
    growthRow.appendChild(growthHint);

    function refreshGrowth(next: GameSettings): void {
      growthSlider.value = String(next.populationGrowthRate);
      growthValue.textContent = `${Math.round(next.populationGrowthRate * 100)}%`;
      growthHint.textContent = `Weekly pop increase. Low = slow growth, High = fast expansion. (Range ${Math.round(growthBounds.min * 100)}\u2013${Math.round(growthBounds.max * 100)}%)`;
    }
    refreshGrowth(current);
    growthSlider.addEventListener("input", () => {
      updateSettings({ populationGrowthRate: Number(growthSlider.value) });
    });
    refreshList.push(() => refreshGrowth(settings()));

    children.push(growthRow);

    // Upgrade gate
    const gateRow = document.createElement("div");
    gateRow.style.display = "flex";
    gateRow.style.flexDirection = "column";
    gateRow.style.gap = "6px";

    const gateLabelRow = document.createElement("div");
    gateLabelRow.style.display = "flex";
    gateLabelRow.style.justifyContent = "space-between";
    gateLabelRow.style.alignItems = "baseline";

    const gateLabel = document.createElement("span");
    gateLabel.textContent = "Upgrade population gate";
    gateLabelRow.appendChild(gateLabel);

    const gateValue = document.createElement("span");
    gateValue.style.fontVariantNumeric = "tabular-nums";
    gateLabelRow.appendChild(gateValue);

    const gateSlider = document.createElement("input");
    gateSlider.type = "range";
    gateSlider.min = String(gateBounds.min);
    gateSlider.max = String(gateBounds.max);
    gateSlider.step = "0.05";
    gateSlider.style.width = "100%";
    gateSlider.style.accentColor = "#f77f00";
    gateRow.appendChild(gateSlider);

    const gateHint = document.createElement("div");
    gateHint.style.fontSize = "10px";
    gateHint.style.opacity = "0.55";
    gateRow.appendChild(gateHint);

    function refreshGate(next: GameSettings): void {
      gateSlider.value = String(next.upgradePopulationGate);
      gateValue.textContent = `${Math.round(next.upgradePopulationGate * 100)}%`;
      gateHint.textContent = `% of level cap needed before upgrading a settlement. (Range ${Math.round(gateBounds.min * 100)}\u2013${Math.round(gateBounds.max * 100)}%)`;
    }
    refreshGate(current);
    gateSlider.addEventListener("input", () => {
      updateSettings({ upgradePopulationGate: Number(gateSlider.value) });
    });
    refreshList.push(() => refreshGate(settings()));

    children.push(gateRow);

    makeFoldableSection(content, "Population", children, true);
  }

  // ─── Visual Section ────────────────────────────────────────────────────

  {
    const children: HTMLElement[] = [];

    // Horse variant
    const horseRow = document.createElement("div");
    horseRow.style.display = "flex";
    horseRow.style.flexDirection = "column";
    horseRow.style.gap = "6px";

    const horseLabel = document.createElement("span");
    horseLabel.textContent = "Horse sprite style";
    horseRow.appendChild(horseLabel);

    const select = document.createElement("select");
    select.style.width = "100%";
    select.style.padding = "8px";
    select.style.fontSize = "12px";
    select.style.border = "1px solid #444";
    select.style.borderRadius = "4px";
    select.style.backgroundColor = "#1a1a1a";
    select.style.color = "#eee";
    select.style.accentColor = "#f77f00";

    const horseOptions: Array<[HorseVariant, string]> = [
      ["bubbly", "Bubbly cartoon horse"],
      ["hero", "Detailed knight on horse"],
      ["shadow", "Shadow knight on horse"],
      ["paladin", "Golden paladin on horse"],
      ["ranger", "Forest ranger on horse"],
      ["arcane", "Arcane spellrider"],
      ["unicorn", "Dark unicorn"],
      ["samurai", "Samurai warrior"],
    ];
    for (const [val, label] of horseOptions) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      select.appendChild(opt);
    }
    select.value = current.horseVariant;
    horseRow.appendChild(select);

    const horseHint = document.createElement("div");
    horseHint.style.fontSize = "10px";
    horseHint.style.opacity = "0.55";
    horseHint.textContent = "Choose between cute bubbly pixel art, detailed knight, shadow knight, golden paladin, forest ranger, arcane spellrider, dark unicorn, or samurai warrior.";
    horseRow.appendChild(horseHint);

    select.addEventListener("change", () => {
      updateSettings({ horseVariant: select.value as HorseVariant });
    });
    refreshList.push(() => {
      select.value = settings().horseVariant;
    });

    children.push(horseRow);

    // Resource icon style
    const styleRow = document.createElement("div");
    styleRow.style.display = "flex";
    styleRow.style.flexDirection = "column";
    styleRow.style.gap = "6px";

    const styleLabel = document.createElement("span");
    styleLabel.textContent = "Resource icon style";
    styleRow.appendChild(styleLabel);

    const styleSelect = document.createElement("select");
    styleSelect.style.width = "100%";
    styleSelect.style.padding = "8px";
    styleSelect.style.fontSize = "12px";
    styleSelect.style.border = "1px solid #444";
    styleSelect.style.borderRadius = "4px";
    styleSelect.style.backgroundColor = "#1a1a1a";
    styleSelect.style.color = "#eee";
    styleSelect.style.accentColor = "#f77f00";

    for (const style of resourceStyleOptions()) {
      const opt = document.createElement("option");
      opt.value = style;
      opt.textContent = RESOURCE_STYLE_LABELS[style];
      styleSelect.appendChild(opt);
    }
    styleSelect.value = current.resourceStyle;
    styleRow.appendChild(styleSelect);

    const styleHint = document.createElement("div");
    styleHint.style.fontSize = "10px";
    styleHint.style.opacity = "0.55";
    styleHint.textContent = "Map pin = parchment disc + woodcut symbol. Painted pin = FLUX-illustrated. Constellation + Heraldic crest = parked directions.";
    styleRow.appendChild(styleHint);

    styleSelect.addEventListener("change", () => {
      updateSettings({ resourceStyle: styleSelect.value as ResourceStyle });
    });
    refreshList.push(() => {
      styleSelect.value = settings().resourceStyle;
    });

    children.push(styleRow);

    makeFoldableSection(content, "Visual", children, true);
  }

  // ─── Buttons ───────────────────────────────────────────────────────────

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset to default";
  styleButton(resetBtn);
  resetBtn.style.alignSelf = "flex-end";
  resetBtn.addEventListener("click", () => {
    updateSettings({
      moveDurationMs: bounds.default,
      horseVariant: "bubbly",
      resourceStyle: "rune-stone",
      territoryBorderWidth: borderBounds.default,
      populationGrowthRate: growthBounds.default,
      upgradePopulationGate: gateBounds.default,
    });
    for (const fn of refreshList) fn();
  });
  content.appendChild(resetBtn);

  const devBtn = document.createElement("button");
  devBtn.textContent = "Developer Settings";
  styleButton(devBtn);
  devBtn.style.alignSelf = "flex-end";
  devBtn.style.opacity = "0.6";
  devBtn.style.fontSize = "10px";
  devBtn.addEventListener("click", () => openDeveloperSettingsMenu());
  content.appendChild(devBtn);

  const closeRow = document.createElement("div");
  closeRow.style.display = "flex";
  closeRow.style.justifyContent = "flex-end";
  closeRow.style.marginTop = "6px";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  styleButton(closeBtn, true);
  closeBtn.addEventListener("click", () => modal.close());
  closeRow.appendChild(closeBtn);
  content.appendChild(closeRow);

  modal.setContent(content);
}
