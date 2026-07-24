import { openCenteredModal, menuTheme, styleButton } from "./menu";
import {
  settings,
  updateSettings,
  settingsBounds,
  borderWidthBounds,
  resourceStyleOptions,
  type GameSettings,
  type HorseVariant,
  type ResourceStyle,
} from "../state/settings";

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

export function openSettingsMenu(opts: SettingsMenuOptions = {}): void {
  const parent = opts.parent ?? document.body;
  const bounds = settingsBounds();
  const current = settings();
  const mapInfo = opts.getMapInfo?.() ?? null;

  const modal = openCenteredModal(parent, "Settings", 420);

  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "14px";

  const intro = document.createElement("div");
  intro.textContent = "Adjust how the game feels. Changes apply instantly.";
  intro.style.opacity = "0.65";
  intro.style.fontSize = "11px";
  content.appendChild(intro);

  if (mapInfo) {
    const infoFrame = document.createElement("div");
    Object.assign(infoFrame.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      padding: "10px",
      border: "1px solid #444",
      borderRadius: "4px",
      backgroundColor: "#1a1a1a",
      fontSize: "11px",
    });

    let expanded = false;
    const infoHeader = document.createElement("button");
    infoHeader.type = "button";
    infoHeader.textContent = `\u25b6 Map info`;
    infoHeader.style.all = "unset";
    infoHeader.style.fontWeight = "bold";
    infoHeader.style.opacity = "0.8";
    infoHeader.style.cursor = "pointer";
    infoHeader.style.display = "flex";
    infoHeader.style.alignItems = "center";
    infoHeader.style.gap = "4px";
    infoFrame.appendChild(infoHeader);

    const fields: Array<[string, string]> = [
      ["Name", mapInfo.name],
      ["Size", `${mapInfo.mapSize} (${mapInfo.width}\u00d7${mapInfo.height})`],
      ["Seed", String(mapInfo.seed)],
      ["Castle seed", String(mapInfo.castleSeed)],
      ["Castle count", String(mapInfo.castleCount)],
      ["Hero start", `${mapInfo.heroQ}, ${mapInfo.heroR}`],
      ["Round / Day", `${mapInfo.round} / ${mapInfo.day}`],
      ["Active player", mapInfo.activePlayerName],
    ];

    const infoRows: HTMLDivElement[] = [];
    for (const [label, value] of fields) {
      const row = document.createElement("div");
      row.style.display = "none";
      row.style.justifyContent = "space-between";
      row.style.gap = "12px";
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      labelEl.style.opacity = "0.55";
      const valEl = document.createElement("span");
      valEl.textContent = value ?? "—";
      valEl.style.fontVariantNumeric = "tabular-nums";
      valEl.style.textAlign = "right";
      row.appendChild(labelEl);
      row.appendChild(valEl);
      infoFrame.appendChild(row);
      infoRows.push(row);
    }

    infoHeader.addEventListener("click", () => {
      expanded = !expanded;
      infoHeader.textContent = expanded ? "\u25bc Map info" : "\u25b6 Map info";
      for (const row of infoRows) {
        row.style.display = expanded ? "flex" : "none";
      }
    });

    content.appendChild(infoFrame);
  }

  // Movement speed slider
  const heroRow = document.createElement("div");
  heroRow.style.display = "flex";
  heroRow.style.flexDirection = "column";
  heroRow.style.gap = "6px";

  const heroLabelRow = document.createElement("div");
  heroRow.appendChild(heroLabelRow);
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
    const ms = Number(slider.value);
    const next = updateSettings({ moveDurationMs: ms });
    refresh(next);
  });

  content.appendChild(heroRow);

  const borderBounds = borderWidthBounds();

  const borderRow = document.createElement("div");
  borderRow.style.display = "flex";
  borderRow.style.flexDirection = "column";
  borderRow.style.gap = "6px";

  const borderLabelRow = document.createElement("div");
  borderRow.appendChild(borderLabelRow);
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
    const w = Number(borderSlider.value);
    const next = updateSettings({ territoryBorderWidth: w });
    refreshBorder(next);
  });

  content.appendChild(borderRow);

  // Horse variant selector
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

  const bubblyOption = document.createElement("option");
  bubblyOption.value = "bubbly";
  bubblyOption.textContent = "Bubbly cartoon horse";
  select.appendChild(bubblyOption);

  const heroOption = document.createElement("option");
  heroOption.value = "hero";
  heroOption.textContent = "Detailed knight on horse";
  select.appendChild(heroOption);

  const shadowOption = document.createElement("option");
  shadowOption.value = "shadow";
  shadowOption.textContent = "Shadow knight on horse";
  select.appendChild(shadowOption);

  const paladinOption = document.createElement("option");
  paladinOption.value = "paladin";
  paladinOption.textContent = "Golden paladin on horse";
  select.appendChild(paladinOption);

  const rangerOption = document.createElement("option");
  rangerOption.value = "ranger";
  rangerOption.textContent = "Forest ranger on horse";
  select.appendChild(rangerOption);

  const arcaneOption = document.createElement("option");
  arcaneOption.value = "arcane";
  arcaneOption.textContent = "Arcane spellrider";
  select.appendChild(arcaneOption);

  const unicornOption = document.createElement("option");
  unicornOption.value = "unicorn";
  unicornOption.textContent = "Dark unicorn";
  select.appendChild(unicornOption);

  const samuraiOption = document.createElement("option");
  samuraiOption.value = "samurai";
  samuraiOption.textContent = "Samurai warrior";
  select.appendChild(samuraiOption);

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

  content.appendChild(horseRow);

  // Resource icon style selector
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
  styleHint.textContent = "Map pin = parchment disc + woodcut symbol. Painted pin = FLUX-illustrated. Constellation + Heraldic crest = parked directions.";
  styleHint.style.fontSize = "10px";
  styleHint.style.opacity = "0.55";
  styleRow.appendChild(styleHint);

  styleSelect.addEventListener("change", () => {
    updateSettings({ resourceStyle: styleSelect.value as ResourceStyle });
  });

  function refreshStyle(next: GameSettings): void {
    styleSelect.value = next.resourceStyle;
  }

  content.appendChild(styleRow);

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset to default";
  styleButton(resetBtn);
  resetBtn.style.alignSelf = "flex-end";
  resetBtn.addEventListener("click", () => {
    const next = updateSettings({ moveDurationMs: bounds.default, horseVariant: "bubbly", resourceStyle: "rune-stone", territoryBorderWidth: borderBounds.default });
    refresh(next);
    refreshBorder(next);
    refreshStyle(next);
    select.value = "bubbly";
  });
  content.appendChild(resetBtn);

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
