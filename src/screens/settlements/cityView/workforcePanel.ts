import { PopupMenu, styleButton } from "@screens/shared/menu";
import { loadPanelGeometry, savePanelGeometry, type PanelGeometryKey } from "@screens/shared/panelLayout";
import { toolbarHeight } from "@screens/shared/panelRail";
import { buildingLabel, canAssignWorkers, staffingBase } from "@heroes/engine";
import type { BuildingKind } from "@heroes/contracts";
import type { CityView, WorkforceBuildingRole, WorkforceSnapshot } from "./cityView";

export interface WorkforcePanelOptions {
  parent: HTMLElement;
  cityView: CityView;
  onAssignWorkers: (gx: number, gy: number, workers: number, district?: { q: number; r: number }) => boolean;
}

const ROLE_LABELS: Record<WorkforceBuildingRole, string> = {
  producer: "Producer",
  market: "Market",
  recruiter: "Recruit",
  "upgrade-accel": "Upgrade",
  idle: "Idle",
};

const PANEL_GEOMETRY_KEY: PanelGeometryKey = "workforcePanel";

export class WorkforcePanel {
  private menu: PopupMenu | null = null;
  private readonly parent: HTMLElement;
  private readonly cityView: CityView;
  private readonly onAssignWorkers: (gx: number, gy: number, workers: number, district?: { q: number; r: number }) => boolean;

  constructor(opts: WorkforcePanelOptions) {
    this.parent = opts.parent;
    this.cityView = opts.cityView;
    this.onAssignWorkers = opts.onAssignWorkers;
    opts.cityView.setWorkforceListener(() => this.update());
  }

  isOpen(): boolean {
    return this.menu !== null;
  }

  open(): void {
    if (this.menu) return;
    this.menu = new PopupMenu({
      parent: this.parent,
      title: "Workforce",
      width: 260,
      initialPosition: loadPanelGeometry(PANEL_GEOMETRY_KEY) ?? { x: 48, y: 160 },
      minTop: toolbarHeight,
      zIndex: 76,
      closeable: true,
      draggable: true,
      clickToFront: true,
      onClose: () => {
        this.menu = null;
      },
      onMove: (pos) => savePanelGeometry(PANEL_GEOMETRY_KEY, pos),
    });
    this.update();
  }

  close(): void {
    this.cityView.clearWorkforcePreview();
    this.cityView.cancelWorkerDrag();
    if (this.menu) {
      this.menu.close();
      this.menu = null;
    }
  }

  private update(): void {
    if (!this.menu) return;
    this.render(this.cityView.workforceSnapshot());
  }

  private render(snapshot: WorkforceSnapshot): void {
    if (!this.menu) return;
    this.menu.clearContent();

    const header = document.createElement("div");
    const idle = Math.max(0, snapshot.pool - snapshot.assigned);
    const overPool = snapshot.assigned > snapshot.pool ? " · over pool" : "";
    header.textContent = snapshot.legacy
      ? `Workers: auto-staffed (pool ${snapshot.pool}) — first assignment crews the rest automatically (jobs, then houses)`
      : `Workers: ${snapshot.assigned} assigned · ${idle} idle${overPool}`;
    Object.assign(header.style, {
      fontSize: "11px",
      lineHeight: "1.5",
      marginBottom: "4px",
      color: "#7fd0ff",
    });
    this.menu.appendContent(header);

    const staffable = snapshot.buildings.filter((b) => b.staffable && b.max >= 1);
    const mainBuildings = staffable.filter((b) => b.district === null);
    const districtBuildings = staffable.filter((b) => b.district !== null);

    if (mainBuildings.length === 0 && districtBuildings.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No staffable buildings";
      Object.assign(empty.style, { fontSize: "11px", opacity: "0.5" });
      this.menu.appendContent(empty);
      return;
    }

    if (mainBuildings.length > 0) {
      this.menu.appendContent(this.groupHeader("Main city"));
      for (const b of mainBuildings) {
        this.menu.appendContent(this.buildRow(b, snapshot));
      }
    }

    if (districtBuildings.length > 0) {
      this.menu.appendContent(this.groupHeader("Districts"));
      for (const b of districtBuildings) {
        this.menu.appendContent(this.buildRow(b, snapshot));
      }
    }
  }

  private groupHeader(text: string): HTMLDivElement {
    const div = document.createElement("div");
    div.textContent = text;
    Object.assign(div.style, {
      fontSize: "10px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      opacity: "0.55",
      marginTop: "6px",
    });
    return div;
  }

  private buildRow(b: WorkforceSnapshot["buildings"][number], snapshot: WorkforceSnapshot): HTMLDivElement {
    const max = Math.max(1, b.max);
    const idle = snapshot.pool - snapshot.assigned;
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      marginBottom: "4px",
    });
    row.addEventListener("mouseenter", () => this.cityView.previewWorkforceBuilding(b.gx, b.gy, b.district));
    row.addEventListener("mouseleave", () => this.cityView.clearWorkforcePreview());

    const labelCol = document.createElement("div");
    Object.assign(labelCol.style, {
      display: "flex",
      flexDirection: "column",
      flex: "1",
      minWidth: "0",
    });

    const chip = document.createElement("span");
    chip.textContent = buildingLabel(b.kind as BuildingKind);
    chip.title = idle > 0
      ? `Add a worker from the idle pool · cell (${b.gx}, ${b.gy})`
      : "No idle workers in the pool";
    Object.assign(chip.style, {
      fontSize: "11px",
      opacity: "0.85",
      cursor: idle > 0 ? "grab" : "not-allowed",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    chip.addEventListener("mousedown", (e) => {
      if (idle <= 0) return;
      this.cityView.beginWorkerDrag(e.clientX, e.clientY);
    });
    labelCol.appendChild(chip);

    const roles = document.createElement("span");
    Object.assign(roles.style, {
      display: "flex",
      gap: "4px",
      marginTop: "1px",
    });
    for (const role of b.roles) {
      const tag = document.createElement("span");
      tag.textContent = ROLE_LABELS[role];
      Object.assign(tag.style, {
        fontSize: "9px",
        opacity: "0.6",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      });
      roles.appendChild(tag);
    }
    labelCol.appendChild(roles);
    row.appendChild(labelCol);

    const minus = document.createElement("button");
    minus.textContent = "−";
    styleButton(minus);
    minus.style.padding = "0px 7px";
    minus.style.fontSize = "12px";

    const value = document.createElement("span");
    value.style.fontSize = "11px";
    value.style.fontVariantNumeric = "tabular-nums";
    value.style.minWidth = "40px";
    value.style.textAlign = "center";

    const plus = document.createElement("button");
    plus.textContent = "+";
    styleButton(plus);
    plus.style.padding = "0px 7px";
    plus.style.fontSize = "12px";

    const base = staffingBase(b.workers, max, snapshot.legacy);

    const refresh = (): void => {
      value.textContent = b.workers === undefined ? "Auto" : `${b.workers}/${max}`;
      value.title = b.workers === undefined ? `Auto-staffed (max ${max})` : `Of ${max} worker slots`;
      const plusDisabled = !canAssignWorkers(staffingBase(b.workers, max, snapshot.legacy), max, 1, snapshot.pool, snapshot.assigned);
      plus.disabled = plusDisabled;
      plus.style.opacity = plusDisabled ? "0.4" : "1";
      plus.style.cursor = plusDisabled ? "not-allowed" : "pointer";
      const minusDisabled = base <= 0;
      minus.disabled = minusDisabled;
      minus.style.opacity = minusDisabled ? "0.4" : "1";
      minus.style.cursor = minusDisabled ? "not-allowed" : "pointer";
    };

    minus.addEventListener("click", () => {
      const ok = this.onAssignWorkers(b.gx, b.gy, Math.max(0, base - 1), b.district ?? undefined);
      if (ok) this.cityView.notifyWorkforceCommit();
      this.update();
    });
    plus.addEventListener("click", () => {
      const ok = this.onAssignWorkers(b.gx, b.gy, Math.min(base + 1, max), b.district ?? undefined);
      if (ok) this.cityView.notifyWorkforceCommit();
      this.update();
    });

    row.appendChild(minus);
    row.appendChild(value);
    row.appendChild(plus);
    refresh();
    return row;
  }
}