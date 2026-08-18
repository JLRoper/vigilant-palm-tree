import { openCenteredModal, menuTheme, styleButton } from "@screens/shared/menu";
import { bus } from "../../core/eventBus";
import { openAssetManager } from "./assetManager";
import { launchView, registerView } from "@screens/shared/viewLauncher";
import { openDevConsole } from "../../debug/devConsole";

registerView("developerSettingsMenu", openDeveloperSettingsMenu);

export function openDeveloperSettingsMenu(parent?: HTMLElement): void {
  const root = parent ?? document.body;
  const modal = openCenteredModal(root, "Developer Settings", 480, true);

  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "10px";

  const intro = document.createElement("div");
  intro.textContent = "Event bus inspector. Click an event type to expand its listeners, or click Fire to dispatch a test event.";
  intro.style.opacity = "0.65";
  intro.style.fontSize = "11px";
  content.appendChild(intro);

  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = "Refresh";
  styleButton(refreshBtn);
  refreshBtn.style.alignSelf = "flex-start";
  refreshBtn.style.marginBottom = "4px";

  const listContainer = document.createElement("div");
  Object.assign(listContainer.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    maxHeight: "400px",
    overflowY: "auto",
    marginBottom: "8px",
  });
  content.appendChild(listContainer);

  function buildEventList(): void {
    listContainer.innerHTML = "";
    const counts = bus.getListenerCounts();
    if (counts.size === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No event listeners registered.";
      empty.style.opacity = "0.5";
      empty.style.fontSize = "11px";
      empty.style.padding = "8px";
      listContainer.appendChild(empty);
      return;
    }

    const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [type, count] of sorted) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "3px",
        padding: "4px 8px",
        backgroundColor: "#1a1a1a",
      });

      const header = document.createElement("div");
      Object.assign(header.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        cursor: "pointer",
      });

      const label = document.createElement("span");
      label.textContent = type;
      label.style.fontWeight = "600";
      label.style.fontSize = "12px";
      header.appendChild(label);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "6px";
      right.style.alignItems = "center";

      const countLabel = document.createElement("span");
      countLabel.textContent = `${count} listener${count !== 1 ? "s" : ""}`;
      countLabel.style.fontSize = "10px";
      countLabel.style.opacity = "0.55";
      right.appendChild(countLabel);

      const fireBtn = document.createElement("button");
      fireBtn.textContent = "Fire";
      styleButton(fireBtn);
      fireBtn.style.padding = "2px 10px";
      fireBtn.style.fontSize = "10px";
      fireBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        bus.emit({ type, _fired: Date.now() });
      });
      right.appendChild(fireBtn);

      header.appendChild(right);
      row.appendChild(header);

      const detail = document.createElement("div");
      detail.style.display = "none";
      detail.style.marginTop = "4px";
      Object.assign(detail.style, {
        fontSize: "10px",
        opacity: "0.6",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        paddingTop: "4px",
      });
      const handlers = (bus as any).listeners?.get(type) as Array<(ev: any) => void> | undefined;
      if (handlers && handlers.length > 0) {
        for (let i = 0; i < handlers.length; i++) {
          const line = document.createElement("div");
          const fnStr = handlers[i].toString();
          const preview = fnStr.length > 120 ? fnStr.substring(0, 120) + "..." : fnStr;
          line.textContent = `[${i}] ${preview}`;
          line.style.wordBreak = "break-all";
          line.style.marginBottom = "2px";
          detail.appendChild(line);
        }
      } else {
        detail.textContent = "(listeners not inspectable — run Refresh)";
      }
      row.appendChild(detail);

      header.addEventListener("click", () => {
        detail.style.display = detail.style.display === "none" ? "" : "none";
      });

      listContainer.appendChild(row);
    }
  }

  refreshBtn.addEventListener("click", buildEventList);
  buildEventList();

  content.appendChild(refreshBtn);

  const assetBtn = document.createElement("button");
  assetBtn.textContent = "Asset Manager";
  styleButton(assetBtn);
  assetBtn.style.alignSelf = "flex-start";
  assetBtn.style.marginTop = "4px";
  assetBtn.addEventListener("click", () => {
    modal.close();
    setTimeout(() => openAssetManager(), 100);
  });
  content.appendChild(assetBtn);

  const testBattleBtn = document.createElement("button");
  testBattleBtn.textContent = "Test Battle";
  styleButton(testBattleBtn);
  testBattleBtn.style.alignSelf = "flex-start";
  testBattleBtn.style.marginTop = "4px";
  testBattleBtn.addEventListener("click", () => {
    modal.close();
    setTimeout(() => launchView("testBattleSetup"), 100);
  });
  content.appendChild(testBattleBtn);

  const devConsoleBtn = document.createElement("button");
  devConsoleBtn.textContent = "Dev Console";
  styleButton(devConsoleBtn);
  devConsoleBtn.style.alignSelf = "flex-start";
  devConsoleBtn.style.marginTop = "4px";
  devConsoleBtn.title = "Open the real-time event log console";
  devConsoleBtn.addEventListener("click", () => {
    const log = (window as any).__gameDebug?.eventLog;
    if (!log) {
      console.warn("[developerSettingsMenu] no __gameDebug.eventLog available; dev console disabled");
      return;
    }
    modal.close();
    setTimeout(() => openDevConsole(log), 100);
  });
  content.appendChild(devConsoleBtn);

  const networkMapBtn = document.createElement("button");
  networkMapBtn.textContent = "Network Map";
  styleButton(networkMapBtn);
  networkMapBtn.style.alignSelf = "flex-start";
  networkMapBtn.style.marginTop = "4px";
  networkMapBtn.title = "Open the live network topology overlay";
  networkMapBtn.addEventListener("click", () => {
    modal.close();
    setTimeout(() => launchView("networkMap"), 100);
  });
  content.appendChild(networkMapBtn);

  const closeRow = document.createElement("div");
  closeRow.style.display = "flex";
  closeRow.style.justifyContent = "flex-end";
  closeRow.style.marginTop = "4px";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  styleButton(closeBtn, true);
  closeBtn.addEventListener("click", () => modal.close());
  closeRow.appendChild(closeBtn);
  content.appendChild(closeRow);

  modal.setContent(content);
}
