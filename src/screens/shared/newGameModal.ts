import { CASTLE_COUNT_MAX } from "../../map/castlePlacement";
import { menuTheme, openCenteredModal, styleButton, styleInput } from "./menu";
import type { FactionId } from "@heroes/contracts";
import { seatFactionChoices } from "./factionChoices";

export type NewGameHandler = (opts: {
  name: string;
  seed: number;
  castleSeed?: number;
  castleCount?: number;
  mapSize?: "small" | "medium" | "large";
  enemyCount?: 0 | 1 | 2 | 3;
  factionId?: FactionId;
}) => void | Promise<void>;

export interface NewGameModalOptions {
  onNew: NewGameHandler;
}

function randomSuffix(): string {
  return Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
}

function defaultName(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `user-${ymd}-${randomSuffix()}`;
}

export function openNewGameModal(opts: NewGameModalOptions): void {
  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "6px";

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name";
  nameLabel.style.opacity = "0.7";
  content.appendChild(nameLabel);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = defaultName();
  styleInput(nameInput);
  content.appendChild(nameInput);

  const seedLabel = document.createElement("label");
  seedLabel.textContent = "Seed (random if blank)";
  seedLabel.style.opacity = "0.7";
  content.appendChild(seedLabel);

  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.placeholder = "random";
  styleInput(seedInput);
  content.appendChild(seedInput);

  const castleSeedLabel = document.createElement("label");
  castleSeedLabel.textContent = "Castle seed (random if blank)";
  castleSeedLabel.style.opacity = "0.7";
  content.appendChild(castleSeedLabel);

  const castleSeedInput = document.createElement("input");
  castleSeedInput.type = "number";
  castleSeedInput.placeholder = "random";
  styleInput(castleSeedInput);
  content.appendChild(castleSeedInput);

  const castleCountLabel = document.createElement("label");
  castleCountLabel.textContent = `Castle count (2-${CASTLE_COUNT_MAX})`;
  castleCountLabel.style.opacity = "0.7";
  content.appendChild(castleCountLabel);

  const castleCountInput = document.createElement("input");
  castleCountInput.type = "number";
  castleCountInput.min = "2";
  castleCountInput.max = String(CASTLE_COUNT_MAX);
  castleCountInput.value = "3";
  styleInput(castleCountInput);
  content.appendChild(castleCountInput);

  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = "Map size";
  sizeLabel.style.opacity = "0.7";
  content.appendChild(sizeLabel);

  const sizeSelect = document.createElement("select");
  sizeSelect.style.width = "100%";
  sizeSelect.style.padding = "8px";
  sizeSelect.style.fontSize = "12px";
  sizeSelect.style.border = "1px solid #444";
  sizeSelect.style.borderRadius = "4px";
  sizeSelect.style.backgroundColor = "#1a1a1a";
  sizeSelect.style.color = "#eee";
  const sizes: Array<{ value: string; label: string }> = [
    { value: "small", label: "Small (24x18)" },
    { value: "medium", label: "Medium (36x27)" },
    { value: "large", label: "Large (48x36)" },
  ];
  for (const s of sizes) {
    const opt = document.createElement("option");
    opt.value = s.value;
    opt.textContent = s.label;
    sizeSelect.appendChild(opt);
  }
  sizeSelect.value = "small";
  content.appendChild(sizeSelect);

  const enemyLabel = document.createElement("label");
  enemyLabel.textContent = "AI enemies";
  enemyLabel.style.opacity = "0.7";
  content.appendChild(enemyLabel);

  const enemyWrap = document.createElement("div");
  enemyWrap.style.display = "flex";
  enemyWrap.style.gap = "8px";
  let enemyCount: 0 | 1 | 2 | 3 = 0;
  const enemyButtons: Array<{ value: 0 | 1 | 2 | 3; btn: HTMLButtonElement }> = [];
  function refreshEnemies(): void {
    for (const { value, btn } of enemyButtons) {
      const active = value === enemyCount;
      btn.style.background = active
        ? "linear-gradient(180deg, #c9a227 0%, #a6801a 100%)"
        : "#1a1a1a";
      btn.style.color = active ? "#241a05" : "#eee";
      btn.style.borderColor = active ? "#e9cf7d" : "#444";
      btn.style.fontWeight = active ? "700" : "400";
    }
  }
  for (const n of [0, 1, 2, 3] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(n);
    Object.assign(btn.style, {
      flex: "1",
      padding: "8px",
      fontSize: "12px",
      border: "1px solid #444",
      borderRadius: "4px",
      backgroundColor: "#1a1a1a",
      color: "#eee",
      cursor: "pointer",
    });
    btn.addEventListener("click", () => {
      enemyCount = n;
      refreshEnemies();
    });
    enemyButtons.push({ value: n, btn });
    enemyWrap.appendChild(btn);
  }
  content.appendChild(enemyWrap);
  refreshEnemies();

  const factionLabel = document.createElement("label");
  factionLabel.textContent = "Your faction";
  factionLabel.style.opacity = "0.7";
  content.appendChild(factionLabel);

  const factionWrap = document.createElement("div");
  factionWrap.style.display = "flex";
  factionWrap.style.gap = "8px";
  const factionChoices = seatFactionChoices();
  let factionId: FactionId = factionChoices[0]?.id ?? "human";
  const factionButtons: Array<{ id: FactionId; btn: HTMLButtonElement }> = [];
  function refreshFactions(): void {
    for (const { id, btn } of factionButtons) {
      const choice = factionChoices.find((c) => c.id === id);
      const active = id === factionId;
      btn.style.background = active
        ? `linear-gradient(180deg, ${choice?.def.palette.primary ?? "#c9a227"} 0%, ${choice?.def.palette.accent ?? "#a6801a"} 160%)`
        : "#1a1a1a";
      btn.style.color = "#eee";
      btn.style.borderColor = active ? (choice?.def.palette.accent ?? "#e9cf7d") : "#444";
      btn.style.fontWeight = active ? "700" : "400";
    }
  }
  for (const choice of factionChoices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = choice.def.motto;
    Object.assign(btn.style, {
      flex: "1",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
      padding: "6px 8px",
      fontSize: "12px",
      border: "1px solid #444",
      borderRadius: "4px",
      backgroundColor: "#1a1a1a",
      color: "#eee",
      cursor: "pointer",
    });
    if (choice.banner) {
      const img = document.createElement("img");
      img.src = choice.banner;
      img.alt = choice.def.label;
      Object.assign(img.style, {
        height: "20px",
        maxWidth: "14px",
        objectFit: "contain",
        imageRendering: "pixelated",
      });
      btn.appendChild(img);
    }
    const label = document.createElement("span");
    label.textContent = choice.def.label;
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      factionId = choice.id;
      refreshFactions();
    });
    factionButtons.push({ id: choice.id, btn });
    factionWrap.appendChild(btn);
  }
  content.appendChild(factionWrap);
  refreshFactions();

  const errorLine = document.createElement("div");
  Object.assign(errorLine.style, { ...menuTheme.error, minHeight: "14px", marginTop: "4px" });
  content.appendChild(errorLine);

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.gap = "8px";
  row.style.marginTop = "10px";

  const modal = openCenteredModal(document.body, "New Game", 400);
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  styleButton(cancel);
  cancel.addEventListener("click", () => modal.close());
  row.appendChild(cancel);

  const confirm = document.createElement("button");
  confirm.textContent = "Create";
  styleButton(confirm, true);
  confirm.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorLine.textContent = "Name required.";
      return;
    }
    let seed: number;
    if (seedInput.value.trim() === "") {
      seed = Math.floor(Math.random() * 0x7fffffff);
    } else {
      seed = Number(seedInput.value);
      if (!Number.isFinite(seed)) {
        errorLine.textContent = "Seed must be a number.";
        return;
      }
    }
    let castleSeed: number | undefined;
    if (castleSeedInput.value.trim() !== "") {
      const v = Number(castleSeedInput.value);
      if (!Number.isFinite(v)) {
        errorLine.textContent = "Castle seed must be a number.";
        return;
      }
      castleSeed = v;
    }
    const castleCountRaw = Number(castleCountInput.value);
    if (!Number.isFinite(castleCountRaw)) {
      errorLine.textContent = "Castle count must be a number.";
      return;
    }
    const castleCount = Math.max(2, Math.min(CASTLE_COUNT_MAX, Math.floor(castleCountRaw)));
    const mapSize = (sizeSelect.value || "small") as "small" | "medium" | "large";
    confirm.disabled = true;
    cancel.disabled = true;
    errorLine.textContent = "Creating…";
    try {
      await opts.onNew({ name, seed, castleSeed, castleCount, mapSize, enemyCount, factionId });
      modal.close();
    } catch (e) {
      confirm.disabled = false;
      cancel.disabled = false;
      const msg = e instanceof Error ? e.message : String(e);
      errorLine.textContent = `Failed: ${msg}`;
      console.error("[toolbar] new game failed:", e);
    }
  });
  row.appendChild(confirm);

  content.appendChild(row);
  modal.setContent(content);
  nameInput.focus();
  nameInput.select();
}
