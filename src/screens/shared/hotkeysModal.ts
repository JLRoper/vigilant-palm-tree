import { openCenteredModal, styleButton } from "./menu";

interface HotkeyEntry {
  keys: string;
  description: string;
}

interface HotkeySection {
  heading: string;
  entries: HotkeyEntry[];
}

const SECTIONS: HotkeySection[] = [
  {
    heading: "Anywhere",
    entries: [
      { keys: "?", description: "Open this help" },
      { keys: "Esc", description: "Clear the selected hero / settlement panel" },
    ],
  },
  {
    heading: "Adventure map",
    entries: [
      { keys: "Click", description: "Select, move or attack" },
      { keys: "Double-click", description: "Enter a settlement (city view)" },
      { keys: "Drag", description: "Pan the camera" },
      { keys: "Wheel", description: "Zoom the camera (zooms the minimap when over it)" },
    ],
  },
  {
    heading: "City view",
    entries: [
      { keys: "Esc", description: "Close menus / cancel placement / leave the city" },
      { keys: "B", description: "Toggle the build palette" },
      { keys: "Del / Backspace", description: "Remove the building under the cursor" },
      { keys: "1 2 3 4 5", description: "Style: classic, blocky, crystalline, organic, industrial" },
      { keys: "! @ # $ % ^", description: "Pattern: denseUrban, sparseRural, radial, grid, clustered, sampler" },
      { keys: "R", description: "Regenerate the layout with a new seed" },
    ],
  },
];

export function openHotkeysModal(): void {
  if (document.querySelector("[data-hotkeys-modal]")) return;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    modal.close();
  };
  const modal = openCenteredModal(document.body, "Keyboard & Mouse", 420, false, true, () => {
    document.removeEventListener("keydown", onKeyDown);
  });
  document.addEventListener("keydown", onKeyDown);
  modal.root.dataset.hotkeysModal = "true";

  for (const section of SECTIONS) {
    const heading = document.createElement("div");
    heading.textContent = section.heading;
    Object.assign(heading.style, {
      margin: "10px 0 4px",
      fontSize: "10px",
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: "0.6px",
      opacity: "0.55",
    });
    modal.appendContent(heading);

    for (const entry of section.entries) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "2px 0",
        fontSize: "12px",
      });
      const keys = document.createElement("span");
      keys.textContent = entry.keys;
      Object.assign(keys.style, {
        flex: "0 0 118px",
        boxSizing: "border-box",
        fontFamily: "monospace",
        fontSize: "11px",
        textAlign: "center",
        whiteSpace: "nowrap",
        background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: "3px",
        padding: "1px 6px",
      });
      const description = document.createElement("span");
      description.textContent = entry.description;
      description.style.opacity = "0.85";
      row.appendChild(keys);
      row.appendChild(description);
      modal.appendContent(row);
    }
  }

  const closeRow = document.createElement("div");
  Object.assign(closeRow.style, { display: "flex", justifyContent: "flex-end", marginTop: "12px" });
  const close = document.createElement("button");
  close.textContent = "Close";
  styleButton(close);
  close.addEventListener("click", () => modal.close());
  closeRow.appendChild(close);
  modal.appendContent(closeRow);
}

export function attachHotkeysShortcut(): void {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "?") return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    openHotkeysModal();
  });
}
