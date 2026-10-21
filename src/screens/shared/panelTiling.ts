import {
  STACK_SEAM,
  equalWeights,
  findStackClusters,
  layoutStackSections,
  moveStackSeam,
  resizeStackLength,
  resizeStackLengthEvenly,
  sectionCaps,
  type StackBounds,
  type StackRect,
  type StackSection,
} from "./panelTilingLayout";

export interface StackSlot {
  y: number;
  h: number;
}

export interface StackablePanel {
  readonly stackId: number;
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  getPosition(): { x: number; y: number };
  stackMinTop(): number;
  naturalHeight(): number;
  isStackEligible(): boolean;
  getStackSlot(): StackSlot | null;
  setStackSlot(slot: StackSlot | null): void;
  moveTo(x: number, y: number): void;
  getHeightLock(): number | null;
}

interface LaidOutStack {
  key: string;
  members: StackablePanel[];
  rects: StackRect[];
  sections: StackSection[];
  caps: number[];
}

const BOTTOM_MARGIN = 24;
const OVERLAY_Z = "95";
const LOCK_SIZE = 22;
const DROP_RADIUS = 24;
const STYLE_ID = "panel-tiling-style";

const members = new Set<StackablePanel>();
const weights = new Map<string, number[]>();
const lengths = new Map<string, number>();
const capFloors = new Map<string, Map<number, number>>();
let lockedPairs: Array<[StackablePanel, StackablePanel]> = [];
let soloDrag: StackablePanel | null = null;
let dropTargetKey: string | null = null;
let groupDrag: {
  starts: Map<StackablePanel, { x: number; y: number }>;
  spanBottom: number;
} | null = null;
let stacks: LaidOutStack[] = [];
let frame: number | null = null;
let overlay: HTMLDivElement | null = null;
const overlayParts = new Map<string, HTMLElement>();
let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let windowBound = false;

function domAvailable(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.createElement === "function" &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function" &&
    typeof requestAnimationFrame === "function"
  );
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    "[data-panel-stacked] > [data-panel-body] > * { flex: 0 0 auto !important; }";
  document.head.appendChild(style);
}

function observeMembers(): void {
  if (typeof MutationObserver !== "undefined") {
    mutationObserver?.disconnect();
    mutationObserver ??= new MutationObserver(() => scheduleStackLayout());
    for (const panel of members) {
      mutationObserver.observe(panel.body, { childList: true, subtree: true, characterData: true });
    }
  }
}

export function registerStackPanel(panel: StackablePanel): void {
  if (!domAvailable() || members.has(panel)) return;
  ensureStyle();
  members.add(panel);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver ??= new ResizeObserver(() => scheduleStackLayout());
    resizeObserver.observe(panel.root);
  }
  observeMembers();
  if (!windowBound) {
    windowBound = true;
    window.addEventListener("resize", () => scheduleStackLayout());
  }
  scheduleStackLayout();
}

export function unregisterStackPanel(panel: StackablePanel): void {
  if (!members.delete(panel)) return;
  resizeObserver?.unobserve(panel.root);
  observeMembers();
  lockedPairs = lockedPairs.filter(([a, b]) => a !== panel && b !== panel);
  if (soloDrag === panel) soloDrag = null;
  scheduleStackLayout();
}

export function scheduleStackLayout(): void {
  if (frame !== null || members.size === 0 || !domAvailable()) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    layoutStacksNow();
  });
}

function stackKey(rects: StackRect[]): string {
  return rects.map((r) => r.id).sort((a, b) => a - b).join(",");
}

function lockOf(panel: StackablePanel): Set<StackablePanel> | null {
  const group = new Set<StackablePanel>([panel]);
  const queue = [panel];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const [a, b] of lockedPairs) {
      const other = a === current ? b : b === current ? a : null;
      if (other && !group.has(other)) {
        group.add(other);
        queue.push(other);
      }
    }
  }
  return group.size >= 2 ? group : null;
}

function pairIndex(a: StackablePanel, b: StackablePanel): number {
  return lockedPairs.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function pruneLocks(): void {
  const live = (p: StackablePanel): boolean => members.has(p) && p.isStackEligible();
  lockedPairs = lockedPairs.filter(([a, b]) => live(a) && live(b));
}

function boundsFor(panels: StackablePanel[]): StackBounds {
  return {
    minTop: Math.max(0, ...panels.map((p) => p.stackMinTop())),
    maxBottom: window.innerHeight - BOTTOM_MARGIN,
  };
}

export function layoutStacksNow(): void {
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  if (!domAvailable()) return;
  pruneLocks();
  const eligible = [...members].filter((p) => p !== soloDrag && p.isStackEligible());
  const byId = new Map(eligible.map((p) => [p.stackId, p]));
  const rects: StackRect[] = eligible.map((p) => {
    const pos = p.getPosition();
    return { id: p.stackId, x: pos.x, y: pos.y, w: p.root.getBoundingClientRect().width, h: p.naturalHeight() };
  });
  const links = lockedPairs.map(([a, b]) => [a.stackId, b.stackId]);
  const clusters = findStackClusters(rects, links);

  const next: LaidOutStack[] = [];
  const slotted = new Set<StackablePanel>();
  for (const cluster of clusters) {
    const panels = cluster.map((r) => byId.get(r.id)).filter((p): p is StackablePanel => p !== undefined);
    const key = stackKey(cluster);
    let w = weights.get(key);
    if (!w || w.length !== cluster.length) w = equalWeights(cluster.length);
    weights.set(key, w);
    const bounds = boundsFor(panels);
    const floors = capFloors.get(key);
    const caps = sectionCaps(cluster).map((cap, i) => Math.max(cap, floors?.get(cluster[i].id) ?? 0));
    const fixed = panels.map((p) => p.getHeightLock());
    const sections = layoutStackSections(cluster, w, bounds, { length: lengths.get(key), caps, fixed });
    next.push({ key, members: panels, rects: cluster, sections, caps });
    sections.forEach((section, i) => {
      panels[i].setStackSlot({ y: section.y, h: section.h });
      slotted.add(panels[i]);
    });
  }
  for (const panel of members) {
    if (!slotted.has(panel)) panel.setStackSlot(null);
  }
  const liveKeys = new Set(next.map((s) => s.key));
  for (const map of [weights, lengths, capFloors]) {
    for (const key of [...map.keys()]) {
      if (!liveKeys.has(key)) map.delete(key);
    }
  }
  stacks = next;
  renderOverlay();
}

function stackOf(panel: StackablePanel): { stack: LaidOutStack; index: number } | null {
  for (const stack of stacks) {
    const index = stack.members.indexOf(panel);
    if (index >= 0) return { stack, index };
  }
  return null;
}

function moveSeam(
  stack: LaidOutStack,
  index: number,
  startHeights: number[],
  deltaPx: number,
  resizing?: StackablePanel,
): void {
  const top = stack.sections[0].y;
  const length = startHeights.reduce((sum, h) => sum + h, 0) + (startHeights.length - 1) * STACK_SEAM;
  const room = window.innerHeight - BOTTOM_MARGIN - top - length;
  const locked = stack.members.map((p) => p !== resizing && p.getHeightLock() !== null);
  const next = moveStackSeam(startHeights, stack.caps, locked, index, deltaPx, room);
  weights.set(stack.key, next.heights);
  lengths.set(stack.key, next.length);
  layoutStacksNow();
}

function stretchStack(stack: LaidOutStack, startHeights: number[], deltaPx: number): void {
  const top = stack.sections[0].y;
  const locked = stack.members.map((p) => p.getHeightLock() !== null);
  const next = resizeStackLengthEvenly(startHeights, deltaPx, window.innerHeight - BOTTOM_MARGIN - top, locked);
  const floors = new Map<number, number>();
  stack.rects.forEach((rect, i) => floors.set(rect.id, next.heights[i]));
  capFloors.set(stack.key, floors);
  weights.set(stack.key, next.heights);
  lengths.set(stack.key, next.length);
  layoutStacksNow();
}

function moveBottom(stack: LaidOutStack, startHeights: number[], deltaPx: number): void {
  const top = stack.sections[0].y;
  const maxLength = window.innerHeight - BOTTOM_MARGIN - top;
  const next = resizeStackLength(startHeights, deltaPx, maxLength);
  const last = stack.rects[stack.rects.length - 1];
  const floors = capFloors.get(stack.key) ?? new Map<number, number>();
  floors.set(last.id, next.heights[next.heights.length - 1]);
  capFloors.set(stack.key, floors);
  weights.set(stack.key, next.heights);
  lengths.set(stack.key, next.length);
  layoutStacksNow();
}

export function resizeStackedPanel(panel: StackablePanel, height: number): void {
  const found = stackOf(panel);
  if (!found) return;
  const { stack, index } = found;
  const heights = stack.sections.map((s) => s.h);
  const delta = height - stack.sections[index].h;
  if (index >= stack.members.length - 1) moveBottom(stack, heights, delta);
  else moveSeam(stack, index, heights, delta, panel);
}

export function beginStackDrag(panel: StackablePanel, forceSolo = false): "group" | "solo" {
  const lock = forceSolo ? null : lockOf(panel);
  if (lock) {
    const starts = new Map([...lock].map((p) => [p, p.getPosition()] as const));
    const spanBottom = Math.max(
      ...[...lock].map((p) => {
        const slot = p.getStackSlot();
        return slot ? slot.y + slot.h : p.getPosition().y + p.root.getBoundingClientRect().height;
      }),
    );
    groupDrag = { starts, spanBottom };
    return "group";
  }
  soloDrag = panel;
  layoutStacksNow();
  return "solo";
}

export function dragStackGroup(dx: number, dy: number): void {
  if (!groupDrag) return;
  const panels = [...groupDrag.starts.keys()];
  let minDx = -Infinity;
  let maxDx = Infinity;
  for (const [panel, start] of groupDrag.starts) {
    minDx = Math.max(minDx, -start.x);
    maxDx = Math.min(maxDx, window.innerWidth - panel.root.getBoundingClientRect().width - start.x);
  }
  const bounds = boundsFor(panels);
  const top = Math.min(...[...groupDrag.starts.values()].map((s) => s.y));
  const minDy = bounds.minTop - top;
  const maxDy = Math.max(minDy, bounds.maxBottom - groupDrag.spanBottom);
  const cdx = Math.min(Math.max(dx, minDx), Math.max(minDx, maxDx));
  const cdy = Math.min(Math.max(dy, minDy), maxDy);
  for (const [panel, start] of groupDrag.starts) panel.moveTo(start.x + cdx, start.y + cdy);
  layoutStacksNow();
}

function lockAt(clientX: number, clientY: number): { key: string; stack: LaidOutStack; index: number } | null {
  for (const [key, el] of overlayParts) {
    if (!key.includes("|lock|")) continue;
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    if (dx * dx + dy * dy > DROP_RADIUS * DROP_RADIUS) continue;
    const stack = stacks.find((s) => s.key === el.dataset.stackKey);
    if (stack) return { key, stack, index: Number(el.dataset.seamIndex) };
  }
  return null;
}

function styleLockButton(btn: HTMLElement, key: string): void {
  const locked = btn.dataset.locked === "true";
  const target = key === dropTargetKey;
  Object.assign(btn.style, {
    opacity: target || btn.matches(":hover") ? "1" : locked ? "0.9" : "0.4",
    borderColor: target || locked ? "rgba(230,190,90,0.9)" : "rgba(255,255,255,0.3)",
    transform: target ? "scale(1.4)" : "",
    boxShadow: target ? "0 0 10px rgba(230,190,90,0.8)" : "",
  });
}

export function hoverStackDrop(clientX: number, clientY: number): void {
  if (!soloDrag) return;
  const next = lockAt(clientX, clientY)?.key ?? null;
  if (next === dropTargetKey) return;
  const prev = dropTargetKey;
  dropTargetKey = next;
  for (const key of [prev, next]) {
    const btn = key ? overlayParts.get(key) : undefined;
    if (key && btn) styleLockButton(btn, key);
  }
}

function alignGroup(group: Set<StackablePanel>): void {
  const [top] = [...group].sort((a, b) => a.getPosition().y - b.getPosition().y || a.stackId - b.stackId);
  const x = top.getPosition().x;
  for (const panel of group) {
    if (panel.getPosition().x !== x) panel.moveTo(x, panel.getPosition().y);
  }
}

function dropOntoLock(dropped: StackablePanel, stack: LaidOutStack, index: number): void {
  const upper = stack.members[index];
  const lower = stack.members[index + 1];
  if (!upper || !lower || upper === dropped || lower === dropped) return;
  const existing = pairIndex(upper, lower);
  if (existing >= 0) lockedPairs.splice(existing, 1);
  lockedPairs.push([upper, dropped], [dropped, lower]);
  const between = (upper.getPosition().y + lower.getPosition().y) / 2;
  dropped.moveTo(dropped.getPosition().x, between);
  const group = lockOf(dropped);
  if (group) alignGroup(group);
}

export function endStackDrag(clientX?: number, clientY?: number): void {
  const dropped = soloDrag;
  const target = dropped && clientX !== undefined && clientY !== undefined ? lockAt(clientX, clientY) : null;
  soloDrag = null;
  groupDrag = null;
  dropTargetKey = null;
  if (dropped && target) dropOntoLock(dropped, target.stack, target.index);
  layoutStacksNow();
}

function toggleSeamLock(stack: LaidOutStack, index: number): void {
  const upper = stack.members[index];
  const lower = stack.members[index + 1];
  if (!upper || !lower) return;
  const existing = pairIndex(upper, lower);
  if (existing >= 0) {
    lockedPairs.splice(existing, 1);
  } else {
    lockedPairs.push([upper, lower]);
    alignGroup(lockOf(upper) ?? new Set([upper, lower]));
  }
  layoutStacksNow();
}

function ensureOverlay(): HTMLDivElement {
  if (overlay?.isConnected) return overlay;
  overlay = document.createElement("div");
  overlay.dataset.panelStackOverlay = "true";
  Object.assign(overlay.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    zIndex: OVERLAY_Z,
    pointerEvents: "none",
  });
  document.body.appendChild(overlay);
  overlayParts.clear();
  return overlay;
}

function part<T extends HTMLElement>(key: string, create: () => T): T {
  const existing = overlayParts.get(key);
  if (existing) return existing as T;
  const host = ensureOverlay();
  const el = create();
  overlayParts.set(key, el);
  host.appendChild(el);
  return el;
}

function createSplitter(key: string): HTMLDivElement {
  const el = document.createElement("div");
  el.dataset.panelStackSeam = "true";
  el.title = key.endsWith("|bottom")
    ? "Drag to lengthen or shorten every panel in the column equally"
    : "Drag to resize the panels above and below";
  Object.assign(el.style, {
    position: "fixed",
    height: `${STACK_SEAM}px`,
    cursor: "row-resize",
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
  });
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    width: "100%",
    height: "2px",
    borderRadius: "1px",
    background: "rgba(255,255,255,0.35)",
    opacity: "0",
    transition: "opacity 120ms",
  });
  el.appendChild(bar);
  let dragging = false;
  el.addEventListener("mouseenter", () => { bar.style.opacity = "1"; });
  el.addEventListener("mouseleave", () => { if (!dragging) bar.style.opacity = "0"; });
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const [stackKeyPart, indexPart] = key.split("|");
    const stack = stacks.find((s) => s.key === stackKeyPart);
    if (!stack) return;
    const startHeights = stack.sections.map((s) => s.h);
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    const isBottom = indexPart === "bottom";
    const index = Number(indexPart);
    const startY = e.clientY;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "row-resize";
    const onMove = (ev: MouseEvent): void => {
      const live = stacks.find((s) => s.key === stack.key);
      if (!live) return;
      if (isBottom) stretchStack(live, startHeights, ev.clientY - startY);
      else moveSeam(live, index, startHeights, ev.clientY - startY);
    };
    const onUp = (): void => {
      dragging = false;
      bar.style.opacity = "0";
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  });
  return el;
}

const LOCK_CLOSED =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">' +
  '<rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" stroke="none"/>' +
  '<path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';
const LOCK_OPEN =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">' +
  '<rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" stroke="none"/>' +
  '<path d="M5 7V5a3 3 0 0 1 5.8-1"/></svg>';

function createLockButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.dataset.panelStackLock = "true";
  Object.assign(btn.style, {
    position: "fixed",
    width: `${LOCK_SIZE}px`,
    height: `${LOCK_SIZE}px`,
    padding: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: "rgba(14,14,14,0.85)",
    border: "1px solid rgba(255,255,255,0.3)",
    color: "#eee",
    cursor: "pointer",
    pointerEvents: "auto",
    transition: "opacity 120ms, transform 120ms",
  });
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
  btn.addEventListener("mouseleave", () => { btn.style.opacity = btn.dataset.locked === "true" ? "0.9" : "0.4"; });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const stack = stacks.find((s) => s.key === btn.dataset.stackKey);
    if (stack) toggleSeamLock(stack, Number(btn.dataset.seamIndex));
  });
  return btn;
}

function renderOverlay(): void {
  const used = new Set<string>();
  for (const stack of stacks) {
    const boxes = stack.members.map((p) => p.root.getBoundingClientRect());
    const lastBox = boxes[boxes.length - 1];
    const bottomKey = `${stack.key}|bottom`;
    used.add(bottomKey);
    const bottomHandle = part(bottomKey, () => createSplitter(bottomKey));
    Object.assign(bottomHandle.style, {
      left: `${lastBox.left}px`,
      top: `${lastBox.bottom}px`,
      width: `${lastBox.width}px`,
      height: `${STACK_SEAM}px`,
    });
    for (let i = 0; i < stack.members.length - 1; i++) {
      const a = boxes[i];
      const b = boxes[i + 1];
      let left = Math.max(a.left, b.left);
      let right = Math.min(a.right, b.right);
      if (right - left < 24) {
        left = Math.min(a.left, b.left);
        right = Math.max(a.right, b.right);
      }
      const key = `${stack.key}|${i}`;
      used.add(key);
      const seam = part(key, () => createSplitter(key));
      Object.assign(seam.style, {
        left: `${left}px`,
        top: `${a.bottom}px`,
        width: `${right - left}px`,
        height: `${Math.max(STACK_SEAM, b.top - a.bottom)}px`,
      });

      const locked = pairIndex(stack.members[i], stack.members[i + 1]) >= 0;
      const lockKey = `${stack.key}|lock|${i}`;
      used.add(lockKey);
      const btn = part(lockKey, createLockButton);
      btn.dataset.stackKey = stack.key;
      btn.dataset.seamIndex = String(i);
      btn.dataset.locked = String(locked);
      btn.innerHTML = locked ? LOCK_CLOSED : LOCK_OPEN;
      btn.title = locked
        ? "Unlock this join so these two panels move independently"
        : "Left-align these two panels and lock them together";
      Object.assign(btn.style, {
        left: `${(left + right) / 2 - LOCK_SIZE / 2}px`,
        top: `${(a.bottom + b.top) / 2 - LOCK_SIZE / 2}px`,
      });
      styleLockButton(btn, lockKey);
    }
  }

  for (const [key, el] of overlayParts) {
    if (used.has(key)) continue;
    el.remove();
    overlayParts.delete(key);
  }
}

export function isPanelLocked(panel: StackablePanel): boolean {
  return lockOf(panel) !== null;
}

export function resetPanelStackForTest(): void {
  members.clear();
  weights.clear();
  lockedPairs = [];
  soloDrag = null;
  groupDrag = null;
  dropTargetKey = null;
  stacks = [];
  if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
  frame = null;
}
