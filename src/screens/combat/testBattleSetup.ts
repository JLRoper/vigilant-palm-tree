// Setup panel for the "Test Battle" dev feature (opened from Developer
// Settings). Player side is a fixed preset; AI side is randomized with a
// Reroll button. "Start Battle" jumps straight into the manual-fight arena —
// this sandbox intentionally skips the auto-resolve step of the real battle
// flow so the arena itself can be exercised directly.

import { fixedTestPlayerPlatoons, randomAiPlatoons } from "../../combat/testArmies";
import { catalogFailed, loadUnitCatalog } from "../../data/unitCatalog";
import type { BattleSide } from "../../../shared/combat/types";
import type { Platoon, UnitType } from "../../../shared/units";
import { menuTheme, openCenteredModal, styleButton } from "@screens/shared/menu";
import { launchView, registerView } from "@screens/shared/viewLauncher";

registerView("testBattleSetup", () => openTestBattleSetup());

const BLUE_ACCENT = "#3070c0";
const RED_ACCENT = "#c04040";

function rosterList(title: string, platoons: Platoon[], unitTypes: Record<string, UnitType>): HTMLElement {
  const col = document.createElement("div");
  col.style.flex = "1";

  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.fontWeight = "600";
  heading.style.marginBottom = "6px";
  col.appendChild(heading);

  for (const platoon of platoons) {
    if (platoon.entries.length === 0) continue;
    const row = document.createElement("div");
    row.style.fontSize = "11px";
    row.style.padding = "3px 0";
    row.textContent = platoon.entries.map((e) => `${unitTypes[e.unitTypeId]?.name ?? e.unitTypeId} x${e.count}`).join(", ");
    col.appendChild(row);
  }

  return col;
}

export function openTestBattleSetup(): void {
  const modal = openCenteredModal(document.body, "Test Battle Setup", 480);

  const status = document.createElement("div");
  status.textContent = "Loading unit catalog...";
  status.style.opacity = "0.7";
  status.style.fontSize = "11px";
  modal.appendContent(status);

  loadUnitCatalog()
    .then((units) => {
      if (catalogFailed() || units.length === 0) {
        status.textContent = "Failed to load the unit catalog — can't set up a test battle.";
        status.style.color = "#f88";
        return;
      }
      status.remove();
      buildSetup(modal, units);
    })
    .catch(() => {
      status.textContent = "Failed to load the unit catalog — can't set up a test battle.";
      status.style.color = "#f88";
    });
}

function buildSetup(modal: ReturnType<typeof openCenteredModal>, units: UnitType[]): void {
  const unitTypes: Record<string, UnitType> = Object.fromEntries(units.map((u) => [u.id, u]));
  const playerPlatoons = fixedTestPlayerPlatoons();
  let aiPlatoons = randomAiPlatoons(unitTypes);
  // Which engine role (and thus grid color — attacker is always blue,
  // defender always red) the human controls. The AI always takes whichever
  // role the human didn't pick, so red isn't hardcoded to "the opponent"
  // anymore — it's whatever role you didn't choose to play.
  let humanSide: BattleSide = "attacker";

  const intro = document.createElement("div");
  intro.textContent = "Player uses a fixed roster. Reroll the AI's roster until you're happy, then start.";
  intro.style.fontSize = "11px";
  intro.style.opacity = "0.65";
  intro.style.marginBottom = "6px";
  modal.appendContent(intro);

  const sideRow = document.createElement("div");
  Object.assign(sideRow.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "10px",
    fontSize: "11px",
  });
  const sideLabel = document.createElement("span");
  sideLabel.textContent = "Play as:";
  sideLabel.style.opacity = "0.7";
  sideRow.appendChild(sideLabel);

  const blueBtn = document.createElement("button");
  blueBtn.textContent = "Blue (attacker — moves first)";
  const redBtn = document.createElement("button");
  redBtn.textContent = "Red (defender)";

  function updateSideButtons(): void {
    styleButton(blueBtn, humanSide === "attacker");
    styleButton(redBtn, humanSide === "defender");
    blueBtn.style.borderColor = humanSide === "attacker" ? BLUE_ACCENT : "rgba(255,255,255,0.2)";
    blueBtn.style.background = humanSide === "attacker"
      ? "rgba(48, 112, 192, 0.35)"
      : menuTheme.button.background;
    redBtn.style.borderColor = humanSide === "defender" ? RED_ACCENT : "rgba(255,255,255,0.2)";
    redBtn.style.background = humanSide === "defender"
      ? "rgba(192, 64, 64, 0.35)"
      : menuTheme.button.background;
    blueBtn.style.color = "#fff";
    redBtn.style.color = "#fff";
  }
  blueBtn.addEventListener("click", () => {
    humanSide = "attacker";
    updateSideButtons();
  });
  redBtn.addEventListener("click", () => {
    humanSide = "defender";
    updateSideButtons();
  });
  updateSideButtons();
  sideRow.appendChild(blueBtn);
  sideRow.appendChild(redBtn);
  modal.appendContent(sideRow);

  const columns = document.createElement("div");
  columns.style.display = "flex";
  columns.style.gap = "14px";
  columns.style.fontFamily = menuTheme.font;
  modal.appendContent(columns);

  const playerCol = rosterList("Player (fixed)", playerPlatoons, unitTypes);
  columns.appendChild(playerCol);

  const aiColContainer = document.createElement("div");
  aiColContainer.style.flex = "1";
  columns.appendChild(aiColContainer);

  function renderAiCol(): void {
    aiColContainer.replaceChildren(rosterList("AI Opponent (random)", aiPlatoons, unitTypes));
  }
  renderAiCol();

  const buttonRow = document.createElement("div");
  buttonRow.style.display = "flex";
  buttonRow.style.justifyContent = "space-between";
  buttonRow.style.marginTop = "14px";

  const rerollBtn = document.createElement("button");
  rerollBtn.textContent = "Reroll AI";
  styleButton(rerollBtn);
  rerollBtn.addEventListener("click", () => {
    aiPlatoons = randomAiPlatoons(unitTypes);
    renderAiCol();
  });
  buttonRow.appendChild(rerollBtn);

  const startBtn = document.createElement("button");
  startBtn.textContent = "Start Battle";
  styleButton(startBtn, true);
  startBtn.addEventListener("click", () => {
    modal.close();
    launchView("manualBattleArena", { playerPlatoons, aiPlatoons, unitTypes, humanSide });
  });
  buttonRow.appendChild(startBtn);

  modal.appendContent(buttonRow);
}
