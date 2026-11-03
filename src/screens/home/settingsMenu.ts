import { panelTheme, styleButton } from "@screens/shared/panel";
import { openDialog } from "@screens/shared/dialog";
import type { MapSize } from "../../map/gameMap";
import type { GameMode } from "@heroes/contracts";
import { settings, updateSettings, DEFAULT_SETTINGS, settingsBounds, enemyMoveDurationBounds, arenaMoveMsPerHexBounds, borderWidthBounds, resourceStyleOptions, growthRateBounds, spriteVariantOptions, cityBackdropOptions, clampCityBackdrop, bgOffsetBounds, parallaxLayerCountBounds, maxZoomOutHexesWideBounds, clampMaxZoomOutHexesWide, PARALLAX_SPEEDS, gameModeOptions, gameModeHint, type GameSettings, type ResourceStyle } from "../../state/settings";
import {
  clampToolbarStyle,
  TOOLBAR_THEMES,
  toolbarStyleOptions,
} from "../../state/toolbarThemes";
import { openView, registerView } from "@screens/shared/viewLauncher";

registerView("settingsMenu", (opts) => openSettingsMenu(opts as Parameters<typeof openSettingsMenu>[0]));

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

/**
 * The panel's one channel for a control it cannot honestly offer right now --
 * the same shape the logistics panel gives a refusal: the control is disabled
 * AND it carries the reason, so a dead control is never a bare dead control.
 * `title` is the hover half of the reason; the row's own notice line is the
 * half a player reads without hovering.
 */
function setUnavailable(control: HTMLInputElement, reason: string): void {
  control.disabled = true;
  control.title = reason;
}

/** The other half of {@link setUnavailable}: the row is live again, so it stops saying it is not. */
function setAvailable(control: HTMLInputElement): void {
  control.disabled = false;
  control.title = "";
}

/**
 * Why the four skybox-only rows are dead, in the player's words. Exported so
 * the panel's own test asserts the prose the panel renders rather than a copy
 * of it that can drift.
 */
export const SKYBOX_DEPENDENCY =
  "Inert while City view backdrop is the Settlement diorama \u2014 this row only applies to the Watercolor skybox. Switch the backdrop above to make it take effect.";

export interface MapInfo {
  name: string;
  seed: number;
  mapSize: MapSize;
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
    fontFamily: panelTheme.font,
    color: panelTheme.panel.color,
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
  const enemyBounds = enemyMoveDurationBounds();
  const arenaBounds = arenaMoveMsPerHexBounds();
  const borderBounds = borderWidthBounds();
  const growthBounds = growthRateBounds();
  const zoomOutBounds = maxZoomOutHexesWideBounds();
  const current = settings();
  const mapInfo = opts.getMapInfo?.() ?? null;
  const refreshList: Array<() => void> = [];

  const modal = openDialog(parent, "Settings", 420, true);

  const content = document.createElement("div");
  content.style.fontFamily = panelTheme.font;
  content.style.fontSize = panelTheme.fontSize;
  content.style.color = panelTheme.panel.color;
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

  // ─── New game Section ──────────────────────────────────────────────────

  {
    const children: HTMLElement[] = [];

    // The new-game DEFAULT mode (SETTLERS-PLAN.md §1/§4 W4). The store's
    // gameMode key is a PREFERENCE: it is what the New Game form pre-selects
    // on both surfaces, and it never rewrites an existing game's mode (that
    // lives per game, in games.lobby). Until this row existed the key was
    // persisted and read but had no writer a player could reach -- only
    // __gameDebug.settings.update could set it (playthrough round 4, F2).
    const modeRow = document.createElement("div");
    modeRow.style.display = "flex";
    modeRow.style.flexDirection = "column";
    modeRow.style.gap = "6px";

    const modeLabel = document.createElement("span");
    modeLabel.textContent = "Default mode for a new game";
    modeRow.appendChild(modeLabel);

    const modeSelect = document.createElement("select");
    modeSelect.setAttribute("data-setting", "gameMode");
    modeSelect.style.width = "100%";
    modeSelect.style.padding = "8px";
    modeSelect.style.fontSize = "12px";
    modeSelect.style.border = "1px solid #444";
    modeSelect.style.borderRadius = "4px";
    modeSelect.style.backgroundColor = "#1a1a1a";
    modeSelect.style.color = "#eee";
    modeSelect.style.accentColor = "#f77f00";

    for (const option of gameModeOptions()) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      modeSelect.appendChild(opt);
    }
    modeSelect.value = current.gameMode;
    modeRow.appendChild(modeSelect);

    const modeHint = document.createElement("div");
    modeHint.setAttribute("data-setting-hint", "gameMode");
    modeHint.style.fontSize = "10px";
    modeHint.style.opacity = "0.55";
    modeRow.appendChild(modeHint);

    function refreshMode(next: GameSettings): void {
      modeSelect.value = next.gameMode;
      modeHint.textContent = `${gameModeHint(next.gameMode)}. The New Game form starts on this mode; it never changes the mode of an existing game.`;
    }
    refreshMode(current);
    modeSelect.addEventListener("change", () => {
      refreshMode(updateSettings({ gameMode: modeSelect.value as GameMode }));
    });
    refreshList.push(() => refreshMode(settings()));

    children.push(modeRow);

    makeFoldableSection(content, "New game", children, true);
  }

  // ─── Game Section ──────────────────────────────────────────────────────

  {
    const children: HTMLElement[] = [];
    // Every slider row in this panel shows a player its own name and its
    // current value: the label row is appended WITH the slider. Building that
    // row and never appending it is the round-4 F1 defect -- seven sliders
    // rendered as a bare number with no name and no value.

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
    slider.setAttribute("data-setting", "moveDurationMs");
    heroRow.append(heroLabelRow, slider);

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
      refresh(updateSettings({ moveDurationMs: Number(slider.value) }));
    });
    refreshList.push(() => refresh(settings()));

    children.push(heroRow);

    const enemyRow = document.createElement("div");
    enemyRow.style.display = "flex";
    enemyRow.style.flexDirection = "column";
    enemyRow.style.gap = "6px";

    const enemyLabelRow = document.createElement("div");
    enemyLabelRow.style.display = "flex";
    enemyLabelRow.style.justifyContent = "space-between";
    enemyLabelRow.style.alignItems = "baseline";

    const enemyLabel = document.createElement("span");
    enemyLabel.textContent = "Enemy movement speed";
    enemyLabelRow.appendChild(enemyLabel);

    const enemyValue = document.createElement("span");
    enemyValue.style.fontVariantNumeric = "tabular-nums";
    enemyLabelRow.appendChild(enemyValue);

    const enemySlider = document.createElement("input");
    enemySlider.type = "range";
    enemySlider.min = String(enemyBounds.min);
    enemySlider.max = String(enemyBounds.max);
    enemySlider.step = "10";
    enemySlider.style.width = "100%";
    enemySlider.style.accentColor = "#f77f00";
    enemySlider.setAttribute("data-setting", "enemyMoveDurationMs");
    enemyRow.append(enemyLabelRow, enemySlider);

    const enemyHint = document.createElement("div");
    enemyHint.style.fontSize = "10px";
    enemyHint.style.opacity = "0.55";
    enemyRow.appendChild(enemyHint);

    function refreshEnemy(next: GameSettings): void {
      enemySlider.value = String(next.enemyMoveDurationMs);
      enemyValue.textContent = `${next.enemyMoveDurationMs}ms \u00b7 ${labelFor(next.enemyMoveDurationMs)}`;
      enemyHint.textContent = `Heroes of other seats (AI enemies and remote players), animated in this browser. (Range ${enemyBounds.min}\u2013${enemyBounds.max}ms)`;
    }
    refreshEnemy(current);
    enemySlider.addEventListener("input", () => {
      refreshEnemy(updateSettings({ enemyMoveDurationMs: Number(enemySlider.value) }));
    });
    refreshList.push(() => refreshEnemy(settings()));

    children.push(enemyRow);

    // Battle arena move animation speed (also covers the player's own
    // platoons — they glide like the AI's now). 0 = instant.
    const arenaRow = document.createElement("div");
    arenaRow.style.display = "flex";
    arenaRow.style.flexDirection = "column";
    arenaRow.style.gap = "6px";

    const arenaLabelRow = document.createElement("div");
    arenaLabelRow.style.display = "flex";
    arenaLabelRow.style.justifyContent = "space-between";
    arenaLabelRow.style.alignItems = "baseline";

    const arenaLabel = document.createElement("span");
    arenaLabel.textContent = "Battle move animation speed";
    arenaLabelRow.appendChild(arenaLabel);

    const arenaValue = document.createElement("span");
    arenaValue.style.fontVariantNumeric = "tabular-nums";
    arenaLabelRow.appendChild(arenaValue);

    const arenaSlider = document.createElement("input");
    arenaSlider.type = "range";
    arenaSlider.min = String(arenaBounds.min);
    arenaSlider.max = String(arenaBounds.max);
    arenaSlider.step = "10";
    arenaSlider.style.width = "100%";
    arenaSlider.style.accentColor = "#f77f00";
    arenaSlider.setAttribute("data-setting", "arenaMoveMsPerHex");
    arenaRow.append(arenaLabelRow, arenaSlider);

    const arenaHint = document.createElement("div");
    arenaHint.style.fontSize = "10px";
    arenaHint.style.opacity = "0.55";
    arenaRow.appendChild(arenaHint);

    function refreshArena(next: GameSettings): void {
      arenaSlider.value = String(next.arenaMoveMsPerHex);
      arenaValue.textContent = `${next.arenaMoveMsPerHex}ms/hex \u00b7 ${labelFor(next.arenaMoveMsPerHex)}`;
      arenaHint.textContent = `Walk animations in the battle arena — yours and the AI's. 0 = instant. (Range ${arenaBounds.min}\u2013${arenaBounds.max}ms per hex)`;
    }
    refreshArena(current);
    arenaSlider.addEventListener("input", () => {
      refreshArena(updateSettings({ arenaMoveMsPerHex: Number(arenaSlider.value) }));
    });
    refreshList.push(() => refreshArena(settings()));

    children.push(arenaRow);

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
    borderSlider.setAttribute("data-setting", "territoryBorderWidth");
    borderRow.append(borderLabelRow, borderSlider);

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
      refreshBorder(updateSettings({ territoryBorderWidth: Number(borderSlider.value) }));
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
    growthSlider.setAttribute("data-setting", "populationGrowthRate");
    growthRow.append(growthLabelRow, growthSlider);

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
      refreshGrowth(updateSettings({ populationGrowthRate: Number(growthSlider.value) }));
    });
    refreshList.push(() => refreshGrowth(settings()));

    children.push(growthRow);

    makeFoldableSection(content, "Population", children, true);
  }

  // ─── Confirmations Section ──────────────────────────────────────────────

  {
    const children: HTMLElement[] = [];

    const confirmRow = document.createElement("div");
    confirmRow.style.display = "flex";
    confirmRow.style.alignItems = "center";
    confirmRow.style.justifyContent = "space-between";
    confirmRow.style.gap = "8px";

    const confirmLabelWrap = document.createElement("div");
    confirmLabelWrap.style.display = "flex";
    confirmLabelWrap.style.flexDirection = "column";
    confirmLabelWrap.style.gap = "2px";

    const confirmLabel = document.createElement("span");
    confirmLabel.textContent = "Confirm building upgrades";
    confirmLabelWrap.appendChild(confirmLabel);

    const confirmHint = document.createElement("div");
    confirmHint.textContent = "Show a confirmation dialog before paying for selected building upgrades. Toggle off to skip the prompt.";
    confirmHint.style.fontSize = "10px";
    confirmHint.style.opacity = "0.55";
    confirmLabelWrap.appendChild(confirmHint);

    confirmRow.appendChild(confirmLabelWrap);

    const confirmToggle = document.createElement("input");
    confirmToggle.type = "checkbox";
    confirmToggle.checked = current.buildingUpgradeConfirm;
    confirmToggle.style.accentColor = "#f77f00";
    confirmToggle.setAttribute("data-setting", "buildingUpgradeConfirm");
    confirmToggle.style.transform = "scale(1.2)";
    confirmToggle.style.cursor = "pointer";
    confirmRow.appendChild(confirmToggle);

    confirmToggle.addEventListener("change", () => {
      updateSettings({ buildingUpgradeConfirm: confirmToggle.checked });
    });
    refreshList.push(() => {
      confirmToggle.checked = settings().buildingUpgradeConfirm;
    });

    children.push(confirmRow);

    makeFoldableSection(content, "Confirmations", children, true);
  }

  // ─── Visual Section ────────────────────────────────────────────────────

  {
    const children: HTMLElement[] = [];

    const toolbarStyleRow = document.createElement("div");
    toolbarStyleRow.style.display = "flex";
    toolbarStyleRow.style.flexDirection = "column";
    toolbarStyleRow.style.gap = "6px";

    const toolbarStyleLabel = document.createElement("span");
    toolbarStyleLabel.textContent = "Toolbar style";
    toolbarStyleRow.appendChild(toolbarStyleLabel);

    const toolbarStyleSelect = document.createElement("select");
    toolbarStyleSelect.setAttribute("data-testid", "toolbar-style-select");
    toolbarStyleSelect.setAttribute("data-setting", "toolbarStyle");
    toolbarStyleSelect.style.width = "100%";
    toolbarStyleSelect.style.padding = "8px";
    toolbarStyleSelect.style.fontSize = "12px";
    toolbarStyleSelect.style.border = "1px solid #444";
    toolbarStyleSelect.style.borderRadius = "4px";
    toolbarStyleSelect.style.backgroundColor = "#1a1a1a";
    toolbarStyleSelect.style.color = "#eee";
    toolbarStyleSelect.style.accentColor = "#f77f00";

    for (const style of toolbarStyleOptions()) {
      const opt = document.createElement("option");
      opt.value = style;
      opt.textContent = TOOLBAR_THEMES[style].label;
      toolbarStyleSelect.appendChild(opt);
    }
    toolbarStyleSelect.value = current.toolbarStyle;
    toolbarStyleRow.appendChild(toolbarStyleSelect);

    const toolbarStyleHint = document.createElement("div");
    toolbarStyleHint.style.fontSize = "10px";
    toolbarStyleHint.style.opacity = "0.55";
    toolbarStyleHint.textContent = "Changes the toolbar palette and typography immediately.";
    toolbarStyleRow.appendChild(toolbarStyleHint);

    toolbarStyleSelect.addEventListener("change", () => {
      updateSettings({ toolbarStyle: clampToolbarStyle(toolbarStyleSelect.value) });
    });
    refreshList.push(() => {
      toolbarStyleSelect.value = settings().toolbarStyle;
    });

    children.push(toolbarStyleRow);

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
    styleSelect.setAttribute("data-setting", "resourceStyle");

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

    // Sprite variant
    const variantRow = document.createElement("div");
    variantRow.style.display = "flex";
    variantRow.style.flexDirection = "column";
    variantRow.style.gap = "6px";

    const variantLabel = document.createElement("span");
    variantLabel.textContent = "Sprite variant";
    variantRow.appendChild(variantLabel);

    const variantSelect = document.createElement("select");
    variantSelect.style.width = "100%";
    variantSelect.style.padding = "8px";
    variantSelect.style.fontSize = "12px";
    variantSelect.style.border = "1px solid #444";
    variantSelect.style.borderRadius = "4px";
    variantSelect.style.backgroundColor = "#1a1a1a";
    variantSelect.style.color = "#eee";
    variantSelect.style.accentColor = "#f77f00";
    variantSelect.setAttribute("data-setting", "spriteVariant");

    for (const v of spriteVariantOptions()) {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = `Variant ${v}`;
      variantSelect.appendChild(opt);
    }
    variantSelect.value = String(current.spriteVariant);
    variantRow.appendChild(variantSelect);

    const variantHint = document.createElement("div");
    variantHint.style.fontSize = "10px";
    variantHint.style.opacity = "0.55";
    variantHint.textContent = "Switches sprite variants globally. Falls back to base image if the selected variant does not exist for a sprite.";
    variantRow.appendChild(variantHint);

    variantSelect.addEventListener("change", () => {
      updateSettings({ spriteVariant: Number(variantSelect.value) });
    });
    refreshList.push(() => {
      variantSelect.value = String(settings().spriteVariant);
    });

    children.push(variantRow);

    // City view backdrop
    const backdropRow = document.createElement("div");
    backdropRow.style.display = "flex";
    backdropRow.style.flexDirection = "column";
    backdropRow.style.gap = "6px";

    const backdropLabel = document.createElement("span");
    backdropLabel.textContent = "City view backdrop";
    backdropLabel.id = "city-backdrop-label";
    backdropRow.appendChild(backdropLabel);

    const backdropSelect = document.createElement("select");
    backdropSelect.id = "city-backdrop-mode";
    backdropSelect.setAttribute("aria-labelledby", "city-backdrop-label");
    backdropSelect.style.width = "100%";
    backdropSelect.style.padding = "8px";
    backdropSelect.style.fontSize = "12px";
    backdropSelect.style.border = "1px solid #444";
    backdropSelect.style.borderRadius = "4px";
    backdropSelect.style.backgroundColor = "#1a1a1a";
    backdropSelect.style.color = "#eee";
    backdropSelect.style.accentColor = "#f77f00";
    backdropSelect.setAttribute("data-setting", "cityBackdrop");

    for (const option of cityBackdropOptions()) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      backdropSelect.appendChild(opt);
    }
    backdropSelect.value = current.cityBackdrop;
    backdropRow.appendChild(backdropSelect);

    const backdropHint = document.createElement("div");
    backdropHint.id = "city-backdrop-hint";
    backdropHint.style.fontSize = "10px";
    backdropHint.style.opacity = "0.55";
    backdropHint.textContent = "Diorama derives its terrain palette from the settlement tile and its six neighbors. Watercolor skybox uses the Sprite variant above.";
    backdropRow.appendChild(backdropHint);
    backdropSelect.setAttribute("aria-describedby", "city-backdrop-hint");

    backdropSelect.addEventListener("change", () => {
      updateSettings({ cityBackdrop: clampCityBackdrop(backdropSelect.value) });
      refreshSkyboxOnlyRows();
    });
    refreshList.push(() => {
      backdropSelect.value = settings().cityBackdrop;
    });

    children.push(backdropRow);

    const gridLinesRow = document.createElement("label");
    gridLinesRow.htmlFor = "city-grid-lines";
    gridLinesRow.style.display = "flex";
    gridLinesRow.style.alignItems = "center";
    gridLinesRow.style.justifyContent = "space-between";
    gridLinesRow.style.gap = "8px";

    const gridLinesLabelWrap = document.createElement("div");
    const gridLinesLabel = document.createElement("span");
    gridLinesLabel.textContent = "City grid lines";
    gridLinesLabelWrap.appendChild(gridLinesLabel);

    const gridLinesHint = document.createElement("div");
    gridLinesHint.id = "city-grid-lines-hint";
    gridLinesHint.textContent = "Outline the isometric cells in city view. The grid floor is transparent either way.";
    gridLinesHint.style.fontSize = "10px";
    gridLinesHint.style.opacity = "0.55";
    gridLinesLabelWrap.appendChild(gridLinesHint);
    gridLinesRow.appendChild(gridLinesLabelWrap);

    const gridLinesToggle = document.createElement("input");
    gridLinesToggle.id = "city-grid-lines";
    gridLinesToggle.type = "checkbox";
    gridLinesToggle.setAttribute("aria-describedby", "city-grid-lines-hint");
    gridLinesToggle.checked = current.cityGridLines;
    gridLinesToggle.style.accentColor = "#f77f00";
    gridLinesToggle.setAttribute("data-setting", "cityGridLines");
    gridLinesToggle.style.transform = "scale(1.2)";
    gridLinesToggle.style.cursor = "pointer";
    gridLinesRow.appendChild(gridLinesToggle);

    gridLinesToggle.addEventListener("change", () => {
      updateSettings({ cityGridLines: gridLinesToggle.checked });
    });
    refreshList.push(() => {
      gridLinesToggle.checked = settings().cityGridLines;
    });

    children.push(gridLinesRow);

    // ── The skybox-only rows ─────────────────────────────────────────────
    //
    // FOUR persisted settings are written by the controls below but change
    // nothing at the DEFAULT backdrop: `paintCitySkybox` returns into the
    // diorama painter before it ever reads the background offset, the parallax
    // toggle or the layer count, and the default backdrop IS the diorama. So
    // the slider really does write its value while nothing the player can see
    // in city view moves.
    //
    // The state was honest and the WORDS were not: the rows were dimmed with no
    // explanation on them anywhere, which reads as a live control that does
    // nothing. Each such row therefore gets a notice line naming the
    // dependency, the same way the logistics panel names a shortfall beside the
    // control it refuses. The notice is filled only while the row really is
    // dead, and empties the moment the skybox makes it live, so state and words
    // stay true together. Nothing here hides a row, adds a second idiom for an
    // unavailable control, or touches a setting's behaviour or default.
    const skyboxOnly: Array<{
      controls: HTMLInputElement[];
      notice: HTMLElement;
    }> = [];

    function markSkyboxOnly(
      row: HTMLElement,
      keys: Array<keyof GameSettings>,
      controls: HTMLInputElement[],
    ): void {
      const notice = document.createElement("div");
      // The keys this row's notice speaks for. One row can carry two of them
      // (the parallax toggle and its layer count share a row), so the hook
      // holds a space-separated list. The panel's test reads this hook to prove
      // the four rows are annotated and the other fourteen are not.
      notice.setAttribute("data-setting-unavailable", keys.join(" "));
      notice.style.fontSize = "10px";
      notice.style.color = "#f9a03f";
      notice.style.display = "none";
      row.appendChild(notice);
      skyboxOnly.push({ controls, notice });
    }

    const bgBounds = bgOffsetBounds();

    // City background X offset
    const bgXRow = document.createElement("div");
    bgXRow.style.display = "flex";
    bgXRow.style.flexDirection = "column";
    bgXRow.style.gap = "6px";

    const bgXLabelRow = document.createElement("div");
    bgXLabelRow.style.display = "flex";
    bgXLabelRow.style.justifyContent = "space-between";
    bgXLabelRow.style.alignItems = "baseline";

    const bgXLabel = document.createElement("span");
    bgXLabel.textContent = "City background X offset";
    bgXLabelRow.appendChild(bgXLabel);

    const bgXValue = document.createElement("span");
    bgXValue.style.fontVariantNumeric = "tabular-nums";
    bgXLabelRow.appendChild(bgXValue);

    const bgXSlider = document.createElement("input");
    bgXSlider.type = "range";
    bgXSlider.min = String(bgBounds.min);
    bgXSlider.max = String(bgBounds.max);
    bgXSlider.step = "1";
    bgXSlider.style.width = "100%";
    bgXSlider.style.accentColor = "#f77f00";
    bgXSlider.setAttribute("data-setting", "cityBgOffsetX");
    bgXRow.append(bgXLabelRow, bgXSlider);

    const bgXHint = document.createElement("div");
    bgXHint.style.fontSize = "10px";
    bgXHint.style.opacity = "0.55";
    bgXRow.appendChild(bgXHint);

    function refreshBgX(next: GameSettings): void {
      bgXSlider.value = String(next.cityBgOffsetX);
      bgXValue.textContent = `${next.cityBgOffsetX}px`;
      bgXHint.textContent = `Shift the city view background horizontally. (Range ${bgBounds.min}\u2013${bgBounds.max}px)`;
    }
    refreshBgX(current);
    bgXSlider.addEventListener("input", () => {
      refreshBgX(updateSettings({ cityBgOffsetX: Number(bgXSlider.value) }));
    });
    refreshList.push(() => refreshBgX(settings()));

    markSkyboxOnly(bgXRow, ["cityBgOffsetX"], [bgXSlider]);

    children.push(bgXRow);

    // City background Y offset
    const bgYRow = document.createElement("div");
    bgYRow.style.display = "flex";
    bgYRow.style.flexDirection = "column";
    bgYRow.style.gap = "6px";

    const bgYLabelRow = document.createElement("div");
    bgYLabelRow.style.display = "flex";
    bgYLabelRow.style.justifyContent = "space-between";
    bgYLabelRow.style.alignItems = "baseline";

    const bgYLabel = document.createElement("span");
    bgYLabel.textContent = "City background Y offset";
    bgYLabelRow.appendChild(bgYLabel);

    const bgYValue = document.createElement("span");
    bgYValue.style.fontVariantNumeric = "tabular-nums";
    bgYLabelRow.appendChild(bgYValue);

    const bgYSlider = document.createElement("input");
    bgYSlider.type = "range";
    bgYSlider.min = String(bgBounds.min);
    bgYSlider.max = String(bgBounds.max);
    bgYSlider.step = "1";
    bgYSlider.style.width = "100%";
    bgYSlider.style.accentColor = "#f77f00";
    bgYSlider.setAttribute("data-setting", "cityBgOffsetY");
    bgYRow.append(bgYLabelRow, bgYSlider);

    const bgYHint = document.createElement("div");
    bgYHint.style.fontSize = "10px";
    bgYHint.style.opacity = "0.55";
    bgYRow.appendChild(bgYHint);

    function refreshBgY(next: GameSettings): void {
      bgYSlider.value = String(next.cityBgOffsetY);
      bgYValue.textContent = `${next.cityBgOffsetY}px`;
      bgYHint.textContent = `Shift the city view background vertically. (Range ${bgBounds.min}\u2013${bgBounds.max}px)`;
    }
    refreshBgY(current);
    bgYSlider.addEventListener("input", () => {
      refreshBgY(updateSettings({ cityBgOffsetY: Number(bgYSlider.value) }));
    });
    refreshList.push(() => refreshBgY(settings()));

    markSkyboxOnly(bgYRow, ["cityBgOffsetY"], [bgYSlider]);

    children.push(bgYRow);

    const pBounds = parallaxLayerCountBounds();

    const parallaxToggleRow = document.createElement("div");
    parallaxToggleRow.style.display = "flex";
    parallaxToggleRow.style.flexDirection = "column";
    parallaxToggleRow.style.gap = "6px";

    const parallaxToggleLabel = document.createElement("span");
    parallaxToggleLabel.textContent = "Parallax background";
    parallaxToggleRow.appendChild(parallaxToggleLabel);

    const parallaxToggleRow2 = document.createElement("div");
    parallaxToggleRow2.style.display = "flex";
    parallaxToggleRow2.style.alignItems = "center";
    parallaxToggleRow2.style.gap = "8px";

    const parallaxCheck = document.createElement("input");
    parallaxCheck.type = "checkbox";
    parallaxCheck.style.accentColor = "#f77f00";
    parallaxCheck.setAttribute("data-setting", "parallaxEnabled");
    parallaxCheck.checked = current.parallaxEnabled;
    parallaxToggleRow2.appendChild(parallaxCheck);

    const parallaxCheckLabel = document.createElement("span");
    parallaxCheckLabel.textContent = "Enable parallax scrolling (splits background into depth layers)";
    parallaxCheckLabel.style.fontSize = "12px";
    parallaxToggleRow2.appendChild(parallaxCheckLabel);

    parallaxToggleRow.appendChild(parallaxToggleRow2);

    const parallaxLayerCountLabel = document.createElement("span");
    parallaxLayerCountLabel.style.fontSize = "11px";
    parallaxLayerCountLabel.style.opacity = "0.7";
    parallaxLayerCountLabel.style.marginTop = "4px";
    parallaxToggleRow.appendChild(parallaxLayerCountLabel);

    function refreshParallaxLayerLabel(next: GameSettings): void {
      const speeds = PARALLAX_SPEEDS[next.parallaxLayerCount] ?? PARALLAX_SPEEDS[4];
      parallaxLayerCountLabel.textContent = `${next.parallaxLayerCount} layers \u2014 speeds: ${speeds.map(s => s.toFixed(2)).join(", ")}`;
    }
    refreshParallaxLayerLabel(current);

    const parallaxLayerSlider = document.createElement("input");
    parallaxLayerSlider.type = "range";
    parallaxLayerSlider.min = String(pBounds.min);
    parallaxLayerSlider.max = String(pBounds.max);
    parallaxLayerSlider.step = "1";
    parallaxLayerSlider.value = String(current.parallaxLayerCount);
    parallaxLayerSlider.style.width = "100%";
    parallaxLayerSlider.style.accentColor = "#f77f00";
    parallaxLayerSlider.setAttribute("data-setting", "parallaxLayerCount");
    parallaxLayerSlider.style.display = parallaxCheck.checked ? "" : "none";
    parallaxLayerCountLabel.style.display = parallaxCheck.checked ? "" : "none";
    parallaxToggleRow.appendChild(parallaxLayerSlider);

    parallaxCheck.addEventListener("change", () => {
      updateSettings({ parallaxEnabled: parallaxCheck.checked });
      parallaxLayerSlider.style.display = parallaxCheck.checked ? "" : "none";
      parallaxLayerCountLabel.style.display = parallaxCheck.checked ? "" : "none";
    });

    parallaxLayerSlider.addEventListener("input", () => {
      updateSettings({ parallaxLayerCount: Number(parallaxLayerSlider.value) });
    });

    refreshList.push(() => {
      const s = settings();
      parallaxCheck.checked = s.parallaxEnabled;
      parallaxLayerSlider.value = String(s.parallaxLayerCount);
      parallaxLayerSlider.style.display = s.parallaxEnabled ? "" : "none";
      parallaxLayerCountLabel.style.display = s.parallaxEnabled ? "" : "none";
      refreshParallaxLayerLabel(s);
    });

    // The parallax toggle and its layer count share this row, so one notice
    // speaks for both keys.
    markSkyboxOnly(parallaxToggleRow, ["parallaxEnabled", "parallaxLayerCount"], [
      parallaxCheck,
      parallaxLayerSlider,
    ]);

    function refreshSkyboxOnlyRows(): void {
      const diorama = settings().cityBackdrop === "diorama";
      for (const row of [bgXRow, bgYRow, parallaxToggleRow]) {
        row.style.opacity = diorama ? "0.45" : "1";
        row.style.pointerEvents = diorama ? "none" : "auto";
      }
      for (const { controls, notice } of skyboxOnly) {
        for (const control of controls) {
          if (diorama) setUnavailable(control, SKYBOX_DEPENDENCY);
          else setAvailable(control);
        }
        notice.textContent = diorama ? SKYBOX_DEPENDENCY : "";
        notice.style.display = diorama ? "" : "none";
      }
    }
    refreshList.push(refreshSkyboxOnlyRows);
    refreshSkyboxOnlyRows();

    children.push(parallaxToggleRow);

    const logPanelToggleRow = document.createElement("div");
    logPanelToggleRow.style.display = "flex";
    logPanelToggleRow.style.flexDirection = "column";
    logPanelToggleRow.style.gap = "6px";

    const logPanelToggleLabel = document.createElement("span");
    logPanelToggleLabel.textContent = "Game log panel";
    logPanelToggleRow.appendChild(logPanelToggleLabel);

    const logPanelToggleRow2 = document.createElement("div");
    logPanelToggleRow2.style.display = "flex";
    logPanelToggleRow2.style.alignItems = "center";
    logPanelToggleRow2.style.gap = "8px";

    const logPanelCheck = document.createElement("input");
    logPanelCheck.type = "checkbox";
    logPanelCheck.style.accentColor = "#f77f00";
    logPanelCheck.setAttribute("data-setting", "showLogPanel");
    logPanelCheck.checked = current.showLogPanel;
    logPanelToggleRow2.appendChild(logPanelCheck);

    const logPanelCheckLabel = document.createElement("span");
    logPanelCheckLabel.textContent = "Show the game log panel (streams every event row for the current game)";
    logPanelCheckLabel.style.fontSize = "12px";
    logPanelToggleRow2.appendChild(logPanelCheckLabel);

    logPanelToggleRow.appendChild(logPanelToggleRow2);

    logPanelCheck.addEventListener("change", () => {
      updateSettings({ showLogPanel: logPanelCheck.checked });
    });

    refreshList.push(() => {
      logPanelCheck.checked = settings().showLogPanel;
    });

    children.push(logPanelToggleRow);

    // Max zoom-out width (20–34 hexes wide)
    const zoomOutRow = document.createElement("div");
    zoomOutRow.style.display = "flex";
    zoomOutRow.style.flexDirection = "column";
    zoomOutRow.style.gap = "6px";

    const zoomOutLabelRow = document.createElement("div");
    zoomOutLabelRow.style.display = "flex";
    zoomOutLabelRow.style.justifyContent = "space-between";
    zoomOutLabelRow.style.alignItems = "baseline";

    const zoomOutLabel = document.createElement("span");
    zoomOutLabel.textContent = "Max zoom-out width";
    zoomOutLabelRow.appendChild(zoomOutLabel);

    const zoomOutValue = document.createElement("span");
    zoomOutValue.setAttribute("data-testid", "max-zoom-out-hexes-value");
    zoomOutValue.style.fontVariantNumeric = "tabular-nums";
    zoomOutLabelRow.appendChild(zoomOutValue);
    zoomOutRow.appendChild(zoomOutLabelRow);

    const zoomOutSlider = document.createElement("input");
    zoomOutSlider.type = "range";
    zoomOutSlider.setAttribute("data-testid", "max-zoom-out-hexes-slider");
    zoomOutSlider.min = String(zoomOutBounds.min);
    zoomOutSlider.max = String(zoomOutBounds.max);
    zoomOutSlider.step = "1";
    zoomOutSlider.style.width = "100%";
    zoomOutSlider.style.accentColor = "#f77f00";
    zoomOutSlider.setAttribute("data-setting", "maxZoomOutHexesWide");
    zoomOutRow.appendChild(zoomOutSlider);

    const zoomOutHint = document.createElement("div");
    zoomOutHint.style.fontSize = "10px";
    zoomOutHint.style.opacity = "0.55";
    zoomOutHint.textContent =
      "Caps how far out you can scroll on the adventure map (20 hexes wide default, up to 34 hexes wide) to keep rendering fast on large maps.";
    zoomOutRow.appendChild(zoomOutHint);

    function refreshZoomOut(next: GameSettings): void {
      zoomOutSlider.value = String(next.maxZoomOutHexesWide);
      zoomOutValue.textContent = `${next.maxZoomOutHexesWide} hexes wide`;
    }
    refreshZoomOut(current);
    zoomOutSlider.addEventListener("input", () => {
      const next = updateSettings({ maxZoomOutHexesWide: clampMaxZoomOutHexesWide(Number(zoomOutSlider.value)) });
      refreshZoomOut(next);
    });
    refreshList.push(() => refreshZoomOut(settings()));

    children.push(zoomOutRow);

    makeFoldableSection(content, "Visual", children, true);
  }

  // ─── Buttons ───────────────────────────────────────────────────────────

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset to default";
  styleButton(resetBtn);
  resetBtn.style.alignSelf = "flex-end";
  resetBtn.addEventListener("click", () => {
    // Reset is EVERY key the store owns, read off the one exported default
    // object rather than a hand-kept list. The list this replaces named 16 of
    // the 18 keys, so gameMode and buildingUpgradeConfirm stayed at the
    // player's value while the button claimed the defaults were restored
    // (playthrough round 4, F2).
    updateSettings({ ...DEFAULT_SETTINGS });
    for (const fn of refreshList) fn();
  });
  content.appendChild(resetBtn);

  const devBtn = document.createElement("button");
  devBtn.textContent = "Developer Settings";
  styleButton(devBtn);
  devBtn.style.alignSelf = "flex-end";
  devBtn.style.opacity = "0.6";
  devBtn.style.fontSize = "10px";
  devBtn.addEventListener("click", () => {
    void openView("developerSettingsMenu");
  });
  content.appendChild(devBtn);

  const closeRow = document.createElement("div");
  closeRow.style.display = "flex";
  closeRow.style.justifyContent = "flex-end";
  closeRow.style.alignItems = "center";
  closeRow.style.marginTop = "6px";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  styleButton(closeBtn, true);
  closeBtn.addEventListener("click", () => modal.close());
  closeRow.appendChild(closeBtn);
  content.appendChild(closeRow);

  modal.setContent(content);
}
