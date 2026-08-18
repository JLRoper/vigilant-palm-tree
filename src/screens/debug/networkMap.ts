import { openCenteredModal, menuTheme, styleButton } from "@screens/shared/menu";
import { registerView } from "@screens/shared/viewLauncher";
import { bus } from "../../core/eventBus";
import {
  SERVER_ENTITY_ID,
  playerIdFromEntityId,
  type NetworkEntity,
  type NetworkLink,
  type NetworkLinkStatus,
  type NetworkTopologySnapshot,
} from "@heroes/contracts";
import type { MpTopologyUpdatedEvent } from "../../io/multiplayerSync";

// Dev Network Map overlay (issue #51, plan/2026-08-17-issue-51-network-map.md §5).
//
// Redraws on each mp:topologyUpdated event rather than joining the main
// requestAnimationFrame loop -- the underlying data only changes once per 2s
// poll, so a render loop would burn frames redrawing an identical picture.

registerView("networkMap", (opts) => openNetworkMap(opts as HTMLElement | undefined));

const CANVAS_W = 640;
const CANVAS_H = 380;
const SERVER_R = 30;
const CLIENT_R = 20;
/** How many snapshots the Copy JSON export carries. */
const HISTORY_CAPACITY = 60;

const STATUS_COLOR: Record<NetworkLinkStatus, string> = {
  healthy: "#5cd65c",
  degraded: "#e6c34d",
  failing: "#e05c5c",
};

export interface NetworkMapHandle {
  close(): void;
}

function formatBandwidth(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return "— B/s";
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

function formatRtt(rttMs: number | null): string {
  return rttMs === null ? "— ms" : `${Math.round(rttMs)} ms`;
}

export function openNetworkMap(parent?: HTMLElement): NetworkMapHandle {
  const modal = openCenteredModal(parent ?? document.body, "Network Map", CANVAS_W + 40, true);

  let snapshot: NetworkTopologySnapshot | null = null;
  const history: NetworkTopologySnapshot[] = [];

  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "8px";

  const intro = document.createElement("div");
  intro.textContent =
    "Live routing topology, refreshed on each multiplayer poll. Packet loss is the rolling poll-failure rate and bandwidth is response bytes per poll interval — both HTTP-layer proxies, not socket measurements.";
  intro.style.opacity = "0.6";
  intro.style.fontSize = "11px";
  content.appendChild(intro);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  Object.assign(canvas.style, {
    width: `${CANVAS_W}px`,
    height: `${CANVAS_H}px`,
    background: "#0e0e0e",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "3px",
  });
  content.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const legend = document.createElement("div");
  Object.assign(legend.style, {
    display: "flex",
    gap: "12px",
    fontSize: "11px",
    opacity: "0.75",
  });
  for (const [status, color] of Object.entries(STATUS_COLOR) as Array<[NetworkLinkStatus, string]>) {
    const item = document.createElement("span");
    item.textContent = `● ${status}`;
    item.style.color = color;
    legend.appendChild(item);
  }
  content.appendChild(legend);

  const status = document.createElement("div");
  Object.assign(status.style, { fontSize: "11px", opacity: "0.65" });
  content.appendChild(status);

  const controls = document.createElement("div");
  Object.assign(controls.style, {
    display: "flex",
    gap: "6px",
    justifyContent: "flex-end",
  });

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy JSON";
  copyBtn.title = `Copy the last ${HISTORY_CAPACITY} topology snapshots to the clipboard`;
  styleButton(copyBtn);
  copyBtn.addEventListener("click", () => {
    const json = JSON.stringify(history, null, 2);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(json);
    } else {
      console.log("[networkMap] topology history:\n", json);
    }
  });
  controls.appendChild(copyBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  styleButton(closeBtn, true);
  closeBtn.addEventListener("click", () => modal.close());
  controls.appendChild(closeBtn);
  content.appendChild(controls);

  function draw(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (!snapshot) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("Waiting for a multiplayer poll…", CANVAS_W / 2, CANVAS_H / 2);
      return;
    }

    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;
    const server = snapshot.entities.find((e) => e.id === SERVER_ENTITY_ID);
    const clients = snapshot.entities.filter((e) => e.id !== SERVER_ENTITY_ID);

    // Star layout: the one dedicated-server node centred, clients on a ring
    // around it. Topology is always a star (every client talks straight to the
    // API), so there is nothing for a force-directed layout to solve.
    const radius = Math.min(CANVAS_W, CANVAS_H) / 2 - 70;
    const positions = new Map<string, { x: number; y: number }>();
    positions.set(SERVER_ENTITY_ID, { x: cx, y: cy });
    clients.forEach((client, i) => {
      const angle = clients.length === 1 ? -Math.PI / 2 : (i / clients.length) * Math.PI * 2 - Math.PI / 2;
      positions.set(client.id, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    });

    for (const link of snapshot.links) {
      const from = positions.get(link.fromId);
      const to = positions.get(link.toId);
      if (!from || !to) continue;
      drawLink(ctx, from, to, link);
    }

    if (server) drawNode(ctx, cx, cy, SERVER_R, server, "#6aa9e0");
    for (const client of clients) {
      const p = positions.get(client.id);
      if (p) drawNode(ctx, p.x, p.y, CLIENT_R, client, "#b58ce0");
    }

    if (clients.length === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("No clients currently polling this game.", cx, CANVAS_H - 18);
    }
  }

  function refreshStatus(): void {
    if (!snapshot) {
      status.textContent = "No snapshot yet — join a multiplayer game to start the poll loop.";
      return;
    }
    const clients = snapshot.entities.filter((e) => e.id !== SERVER_ENTITY_ID).length;
    const at = new Date(snapshot.capturedAt).toISOString().slice(11, 19);
    status.textContent = `${snapshot.gameName} — ${clients} client${clients === 1 ? "" : "s"}, ${snapshot.links.length} link${snapshot.links.length === 1 ? "" : "s"} @ ${at} (${history.length}/${HISTORY_CAPACITY} snapshots buffered)`;
  }

  const onTopology = (ev: MpTopologyUpdatedEvent): void => {
    snapshot = ev.snapshot;
    history.push(ev.snapshot);
    if (history.length > HISTORY_CAPACITY) {
      history.splice(0, history.length - HISTORY_CAPACITY);
    }
    refreshStatus();
    draw();
  };
  bus.on("mp:topologyUpdated", onTopology);

  refreshStatus();
  draw();
  modal.setContent(content);

  const originalClose = modal.close.bind(modal);
  modal.close = (): void => {
    bus.off("mp:topologyUpdated", onTopology);
    originalClose();
  };

  return { close: () => modal.close() };
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  entity: NetworkEntity,
  fill: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Inside the node: "API" for the server, otherwise the bare seat number --
  // the full node id ("client:0") doesn't fit a 20px circle.
  const seat = playerIdFromEntityId(entity.id);
  ctx.fillStyle = "#0e0e0e";
  ctx.fillText(
    entity.type === "dedicated-server" ? "API" : seat === null ? "?" : String(seat),
    x,
    y,
  );

  ctx.fillStyle = "#eee";
  ctx.fillText(entity.label, x, y + r + 12);
}

function drawLink(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  link: NetworkLink,
): void {
  const color = STATUS_COLOR[link.status];
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Direction marker: a short arrowhead at the client->server end, so the
  // routing direction reads off the picture rather than only off the data.
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const tipX = to.x - Math.cos(angle) * (SERVER_R + 2);
  const tipY = to.y - Math.sin(angle) * (SERVER_R + 2);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - Math.cos(angle - 0.4) * 9, tipY - Math.sin(angle - 0.4) * 9);
  ctx.lineTo(tipX - Math.cos(angle + 0.4) * 9, tipY - Math.sin(angle + 0.4) * 9);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const text = `${formatRtt(link.rttMs)} · ${link.packetLossPct.toFixed(0)}% loss · ${formatBandwidth(link.bandwidthBytesPerSec)}`;
  const width = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(14,14,14,0.85)";
  ctx.fillRect(midX - width / 2 - 4, midY - 8, width + 8, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, midX, midY);
}
