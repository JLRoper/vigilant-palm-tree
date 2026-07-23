import { openCenteredModal, menuTheme, styleButton } from "./menu";
import {
  settings,
  updateSettings,
  settingsBounds,
  type GameSettings,
  type HorseVariant,
} from "../state/settings";

const SPEED_LABELS: Array<{ min: number; label: string }> = [
  { min: 800, label: "Very slow (1s/hex)" },
  { min: 500, label: "Slow" },
  { min: 200, label: "Normal" },
  { min: 100, label: "Fast" },
  { min: 0, label: "Instant" },
];

function labelFor(ms: number): string {
  for (const tier of SPEED_LABELS) {
    if (ms >= tier.min) return tier.label;
  }
  return SPEED_LABELS[SPEED_LABELS.length - 1].label;
}

export function openSettingsMenu(parent: HTMLElement = document.body): void {
  const bounds = settingsBounds();
  const current = settings();

  const modal = openCenteredModal(parent, "Settings", 380);

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
    heroValue.textContent = `${next.moveDurationMs}ms · ${labelFor(next.moveDurationMs)}`;
    hint.textContent = `Lower = snappier. Higher = easier to follow along. (Range ${bounds.min}–${bounds.max}ms)`;
  }
  refresh(current);

  slider.addEventListener("input", () => {
    const ms = Number(slider.value);
    const next = updateSettings({ moveDurationMs: ms });
    refresh(next);
  });

  content.appendChild(heroRow);

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

  select.value = current.horseVariant;
  horseRow.appendChild(select);

  const horseHint = document.createElement("div");
  horseHint.style.fontSize = "10px";
  horseHint.style.opacity = "0.55";
  horseHint.textContent = "Choose between cute bubbly pixel art or detailed isometric knight.";
  horseRow.appendChild(horseHint);

  select.addEventListener("change", () => {
    updateSettings({ horseVariant: select.value as HorseVariant });
  });

  content.appendChild(horseRow);

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset to default";
  styleButton(resetBtn);
  resetBtn.style.alignSelf = "flex-end";
  resetBtn.addEventListener("click", () => {
    const next = updateSettings({ moveDurationMs: bounds.default, horseVariant: "bubbly" });
    refresh(next);
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
