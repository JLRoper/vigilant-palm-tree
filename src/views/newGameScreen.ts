// Full-screen "Create Game" panel. Hosted by homeView (replaces the landing
// button stack while the user is filling out the form). Owns Name + Map Size
// + Number of Players + Map Seed fields and a Create / Cancel action row.
//
// Map seed defaults to a fresh random 31-bit int; the user can edit it.
// "Number of players" is exposed as a small chip selector (2/3/4). Map size
// stays a dropdown because we ship three named presets.

import { styleButton } from "./menu";

export type NewGameFormValues = {
  name: string;
  seed: number;
  mapSize: "small" | "medium" | "large";
  playerCount: 2 | 3 | 4;
};

export interface NewGameScreenOptions {
  defaultName: string;
  defaultSeed: number;
  isBackendOk: () => boolean;
  busy: boolean;
  onCancel: () => void;
  onCreate: (values: NewGameFormValues) => Promise<void>;
}

export interface NewGameScreen {
  root: HTMLElement;
  setBusy: (value: boolean) => void;
  showError: (message: string) => void;
  clearError: () => void;
  destroy: () => void;
}

const PLAYER_CHOICES: Array<2 | 3 | 4> = [2, 3, 4];

export function createNewGameScreen(opts: NewGameScreenOptions): NewGameScreen {
  const root = document.createElement("div");
  Object.assign(root.style, {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    textAlign: "left",
    color: "#f1e4c3",
    fontFamily: "Georgia, 'Times New Roman', serif",
  });

  const heading = document.createElement("h2");
  heading.textContent = "Create a New Game";
  Object.assign(heading.style, {
    margin: "0 0 4px",
    fontSize: "22px",
    color: "#e9cf7d",
    letterSpacing: "1px",
    textAlign: "center",
  });
  root.appendChild(heading);

  const intro = document.createElement("div");
  intro.textContent =
    "Pick a map, choose how many players to seat, and seed the world. Leave the seed blank for a random one.";
  Object.assign(intro.style, {
    fontSize: "12px",
    opacity: "0.7",
    textAlign: "center",
    marginBottom: "6px",
  });
  root.appendChild(intro);

  const makeFieldRow = (labelText: string): {
    row: HTMLDivElement;
    label: HTMLLabelElement;
    control: HTMLDivElement;
  } => {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    });
    const label = document.createElement("label");
    label.textContent = labelText;
    Object.assign(label.style, {
      fontSize: "12px",
      opacity: "0.75",
      letterSpacing: "0.4px",
      textTransform: "uppercase",
    });
    row.appendChild(label);
    const control = document.createElement("div");
    control.style.display = "flex";
    control.style.gap = "6px";
    row.appendChild(control);
    root.appendChild(row);
    return { row, label, control };
  };

  const styleTextInput = (el: HTMLInputElement): void => {
    Object.assign(el.style, {
      width: "100%",
      padding: "8px 10px",
      fontSize: "13px",
      fontFamily: "Georgia, 'Times New Roman', serif",
      background: "rgba(0,0,0,0.45)",
      color: "#f1e4c3",
      border: "1px solid rgba(201,162,39,0.45)",
      borderRadius: "3px",
      boxSizing: "border-box",
    });
  };

  const nameField = makeFieldRow("Game name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = opts.defaultName;
  styleTextInput(nameInput);
  nameField.control.appendChild(nameInput);

  const sizeField = makeFieldRow("Map size");
  const sizeSelect = document.createElement("select");
  Object.assign(sizeSelect.style, {
    flex: "1",
    padding: "8px 10px",
    fontSize: "13px",
    fontFamily: "Georgia, 'Times New Roman', serif",
    background: "rgba(0,0,0,0.45)",
    color: "#f1e4c3",
    border: "1px solid rgba(201,162,39,0.45)",
    borderRadius: "3px",
  });
  for (const s of [
    { value: "small", label: "Small (24×18)" },
    { value: "medium", label: "Medium (36×27)" },
    { value: "large", label: "Large (48×36)" },
  ]) {
    const opt = document.createElement("option");
    opt.value = s.value;
    opt.textContent = s.label;
    sizeSelect.appendChild(opt);
  }
  sizeSelect.value = "small";
  sizeField.control.appendChild(sizeSelect);

  const playersField = makeFieldRow("Number of players");
  const playersWrap = document.createElement("div");
  Object.assign(playersWrap.style, {
    display: "flex",
    gap: "6px",
  });
  let selectedPlayers: 2 | 3 | 4 = 3;
  const playerButtons: Record<2 | 3 | 4, HTMLButtonElement> = {} as Record<
    2 | 3 | 4,
    HTMLButtonElement
  >;
  function refreshPlayers(): void {
    for (const n of PLAYER_CHOICES) {
      const b = playerButtons[n];
      const active = n === selectedPlayers;
      b.style.background = active
        ? "linear-gradient(180deg, #c9a227 0%, #a6801a 100%)"
        : "rgba(20, 33, 69, 0.85)";
      b.style.color = active ? "#241a05" : "#f1e4c3";
      b.style.borderColor = active ? "#e9cf7d" : "rgba(201,162,39,0.45)";
      b.style.fontWeight = active ? "700" : "400";
    }
  }
  for (const n of PLAYER_CHOICES) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = String(n);
    Object.assign(b.style, {
      flex: "1",
      padding: "8px 10px",
      fontSize: "14px",
      fontFamily: "Georgia, 'Times New Roman', serif",
      background: "rgba(20, 33, 69, 0.85)",
      color: "#f1e4c3",
      border: "1px solid rgba(201,162,39,0.45)",
      borderRadius: "3px",
      cursor: "pointer",
    });
    b.addEventListener("click", () => {
      selectedPlayers = n;
      refreshPlayers();
    });
    playerButtons[n] = b;
    playersWrap.appendChild(b);
  }
  playersField.control.appendChild(playersWrap);
  refreshPlayers();

  const seedField = makeFieldRow("Map seed");
  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.placeholder = "random";
  seedInput.value = String(opts.defaultSeed);
  styleTextInput(seedInput);
  seedField.control.appendChild(seedInput);

  const seedHint = document.createElement("div");
  seedHint.textContent = "Leave blank for a fresh random seed. Same seed + same settings = same map.";
  Object.assign(seedHint.style, {
    fontSize: "10px",
    opacity: "0.55",
    marginTop: "2px",
  });
  seedField.row.appendChild(seedHint);

  const reRollBtn = document.createElement("button");
  reRollBtn.type = "button";
  reRollBtn.textContent = "↻";
  reRollBtn.title = "Pick a new random seed";
  Object.assign(reRollBtn.style, {
    padding: "8px 12px",
    fontSize: "16px",
    background: "rgba(20, 33, 69, 0.85)",
    color: "#f1e4c3",
    border: "1px solid rgba(201,162,39,0.45)",
    borderRadius: "3px",
    cursor: "pointer",
  });
  reRollBtn.addEventListener("click", () => {
    seedInput.value = String(Math.floor(Math.random() * 0x7fffffff));
  });
  seedField.control.appendChild(reRollBtn);

  const errorLine = document.createElement("div");
  Object.assign(errorLine.style, {
    color: "#f88",
    fontSize: "11px",
    minHeight: "14px",
    marginTop: "2px",
  });
  root.appendChild(errorLine);

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    marginTop: "10px",
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Back";
  styleButton(cancelBtn);
  cancelBtn.addEventListener("click", () => {
    if (opts.busy) return;
    opts.onCancel();
  });

  const createBtn = document.createElement("button");
  createBtn.textContent = "Create Game";
  styleButton(createBtn, true);
  createBtn.addEventListener("click", async () => {
    if (opts.busy) return;
    errorLine.textContent = "";
    const name = nameInput.value.trim();
    if (!name) {
      errorLine.textContent = "Game name required.";
      nameInput.focus();
      return;
    }
    let seed: number;
    if (seedInput.value.trim() === "") {
      seed = Math.floor(Math.random() * 0x7fffffff);
    } else {
      seed = Number(seedInput.value);
      if (!Number.isFinite(seed) || seed < 0) {
        errorLine.textContent = "Seed must be a non-negative number.";
        seedInput.focus();
        return;
      }
    }
    const mapSize = (sizeSelect.value || "small") as "small" | "medium" | "large";
    await opts.onCreate({
      name,
      seed,
      mapSize,
      playerCount: selectedPlayers,
    });
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(createBtn);
  root.appendChild(actions);

  setTimeout(() => nameInput.focus(), 0);
  nameInput.select();

  function setBusy(value: boolean): void {
    createBtn.disabled = value;
    cancelBtn.disabled = value;
    nameInput.disabled = value;
    sizeSelect.disabled = value;
    seedInput.disabled = value;
    reRollBtn.disabled = value;
    for (const n of PLAYER_CHOICES) playerButtons[n].disabled = value;
    createBtn.style.opacity = value ? "0.6" : "1";
    createBtn.textContent = value ? "Creating…" : "Create Game";
  }

  function showError(message: string): void {
    errorLine.textContent = message;
  }

  function clearError(): void {
    errorLine.textContent = "";
  }

  function destroy(): void {
    root.remove();
  }

  return { root, setBusy, showError, clearError, destroy };
}
