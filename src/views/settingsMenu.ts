import { openCenteredModal, menuTheme, styleButton } from "./menu";
import {
  settings,
  updateSettings,
  settingsBounds,
  type GameSettings,
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

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset to default";
  styleButton(resetBtn);
  resetBtn.style.alignSelf = "flex-end";
  resetBtn.addEventListener("click", () => {
    const next = updateSettings({ moveDurationMs: bounds.default });
    refresh(next);
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
