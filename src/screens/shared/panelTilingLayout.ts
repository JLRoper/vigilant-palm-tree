export interface StackRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StackSection {
  id: number;
  y: number;
  h: number;
}

export interface StackBounds {
  minTop: number;
  maxBottom: number;
}

export interface StackOverrides {
  length?: number;
  caps?: number[];
  fixed?: Array<number | null>;
}

export const STACK_SEAM = 6;
export const STACK_MIN_SECTION = 80;

function touches(a: StackRect, b: StackRect): boolean {
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y <= b.y + b.h + STACK_SEAM &&
    b.y <= a.y + a.h + STACK_SEAM
  );
}

function byTop(a: StackRect, b: StackRect): number {
  return a.y - b.y || a.id - b.id;
}

export function findStackClusters(rects: StackRect[], links: number[][] = []): StackRect[][] {
  const parent = rects.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (touches(rects[i], rects[j])) union(i, j);
    }
  }
  const indexOf = new Map(rects.map((r, i) => [r.id, i]));
  for (const link of links) {
    const present = link.map((id) => indexOf.get(id)).filter((i): i is number => i !== undefined);
    for (let k = 1; k < present.length; k++) union(present[0], present[k]);
  }
  const groups = new Map<number, StackRect[]>();
  rects.forEach((rect, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(rect);
    groups.set(root, group);
  });
  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group) => group.sort(byTop))
    .sort((a, b) => byTop(a[0], b[0]));
}

export function equalWeights(n: number): number[] {
  return Array.from({ length: n }, () => 1);
}

export function stackSpan(
  members: StackRect[],
  bounds: StackBounds,
  length?: number,
): { top: number; bottom: number } {
  const n = members.length;
  const need = n * STACK_MIN_SECTION + (n - 1) * STACK_SEAM;
  let top = Math.max(bounds.minTop, Math.min(...members.map((m) => m.y)));
  const natural = length === undefined ? Math.max(...members.map((m) => m.y + m.h)) : top + length;
  let bottom = Math.min(bounds.maxBottom, natural);
  if (bottom - top < need) {
    bottom = Math.min(bounds.maxBottom, top + need);
    top = Math.max(bounds.minTop, bottom - need);
  }
  return { top, bottom };
}

export function stackAvailable(members: StackRect[], bounds: StackBounds, length?: number): number {
  const { top, bottom } = stackSpan(members, bounds, length);
  return Math.max(0, bottom - top - (members.length - 1) * STACK_SEAM);
}

export function sectionCaps(members: StackRect[]): number[] {
  return members.map((m) => Math.max(STACK_MIN_SECTION, Math.ceil(m.h)));
}

function fillSections(
  weights: number[],
  caps: number[],
  available: number,
  fixed: Array<number | null> = [],
): number[] {
  const heights = caps.map(() => 0);
  const free = new Set(caps.map((_, i) => i));
  let remaining = available;
  fixed.forEach((h, i) => {
    if (h === null || h === undefined) return;
    heights[i] = h;
    remaining -= h;
    free.delete(i);
  });
  remaining = Math.max(free.size * STACK_MIN_SECTION, remaining);
  while (free.size > 0) {
    const total = [...free].reduce((sum, i) => sum + weights[i], 0) || 1;
    const capped = [...free].filter((i) => (remaining * weights[i]) / total >= caps[i]);
    if (capped.length === 0) {
      for (const i of free) heights[i] = (remaining * weights[i]) / total;
      break;
    }
    for (const i of capped) {
      heights[i] = caps[i];
      remaining -= caps[i];
      free.delete(i);
    }
  }
  const rounded = heights.map(Math.floor);
  const lastFree = Math.max(...[...free], -1);
  if (lastFree >= 0) {
    const used = rounded.reduce((sum, h) => sum + h, 0);
    rounded[lastFree] += Math.max(0, available - used);
  }
  return rounded;
}

export function layoutStackSections(
  members: StackRect[],
  weights: number[],
  bounds: StackBounds,
  overrides: StackOverrides = {},
): StackSection[] {
  const { top } = stackSpan(members, bounds, overrides.length);
  const caps = overrides.caps ?? sectionCaps(members);
  const heights = fillSections(weights, caps, stackAvailable(members, bounds, overrides.length), overrides.fixed);
  const sections: StackSection[] = [];
  let y = top;
  members.forEach((member, i) => {
    sections.push({ id: member.id, y, h: heights[i] });
    y += heights[i] + STACK_SEAM;
  });
  return sections;
}

export function resizeStackSplit(
  heights: number[],
  caps: number[],
  index: number,
  deltaPx: number,
  minPx = STACK_MIN_SECTION,
): number[] {
  if (index < 0 || index >= heights.length - 1) return heights;
  const pair = heights[index] + heights[index + 1];
  const upperCap = Math.max(caps[index], heights[index]);
  const lowerCap = Math.max(caps[index + 1], heights[index + 1]);
  const lo = Math.max(minPx, pair - lowerCap);
  const hi = Math.min(upperCap, pair - minPx);
  if (lo > hi) return heights;
  const upper = Math.min(hi, Math.max(lo, heights[index] + deltaPx));
  const next = [...heights];
  next[index] = upper;
  next[index + 1] = pair - upper;
  return next;
}

export function resizeStackLength(
  heights: number[],
  deltaPx: number,
  maxLength: number,
  minPx = STACK_MIN_SECTION,
): { heights: number[]; length: number } {
  const last = heights.length - 1;
  const seams = last * STACK_SEAM;
  const others = heights.slice(0, last).reduce((sum, h) => sum + h, 0);
  const lastHeight = Math.max(minPx, Math.min(maxLength - seams - others, heights[last] + deltaPx));
  const next = [...heights];
  next[last] = lastHeight;
  return { heights: next, length: others + lastHeight + seams };
}

export function resizeStackLengthEvenly(
  heights: number[],
  deltaPx: number,
  maxLength: number,
  locked: boolean[] = [],
  minPx = STACK_MIN_SECTION,
): { heights: number[]; length: number } {
  const seams = (heights.length - 1) * STACK_SEAM;
  const current = heights.reduce((sum, h) => sum + h, 0);
  let free = heights.map((_, i) => i).filter((i) => !locked[i]);
  if (free.length === 0) return { heights, length: current + seams };
  const lockedTotal = heights.reduce((sum, h, i) => sum + (locked[i] ? h : 0), 0);
  const target = Math.max(lockedTotal + free.length * minPx, Math.min(maxLength - seams, current + deltaPx));
  const next = [...heights];
  let remaining = target - current;
  while (free.length > 0 && Math.abs(remaining) > 0.5) {
    const share = remaining / free.length;
    const stillFree: number[] = [];
    for (const i of free) {
      const wanted = next[i] + share;
      const applied = Math.max(minPx, wanted);
      remaining -= applied - next[i];
      next[i] = applied;
      if (applied === wanted) stillFree.push(i);
    }
    if (stillFree.length === free.length) break;
    free = stillFree;
  }
  return { heights: next.map(Math.round), length: target + seams };
}

export function moveStackSeam(
  heights: number[],
  caps: number[],
  locked: boolean[],
  index: number,
  deltaPx: number,
  room: number,
  minPx = STACK_MIN_SECTION,
): { heights: number[]; length: number } {
  const n = heights.length;
  const length = heights.reduce((sum, h) => sum + h, 0) + (n - 1) * STACK_SEAM;
  if (index < 0 || index >= n - 1) return { heights, length };
  const cap = (j: number): number => Math.max(caps[j], heights[j]);
  const upper: number[] = [];
  for (let j = index; j >= 0; j--) if (!locked[j]) upper.push(j);
  const lower: number[] = [];
  for (let j = index + 1; j < n; j++) if (!locked[j]) lower.push(j);

  let d = deltaPx;
  if (d > 0) {
    const upperRoom = upper.reduce((sum, j) => sum + cap(j) - heights[j], 0);
    const lowerRoom = lower.reduce((sum, j) => sum + heights[j] - minPx, 0) + Math.max(0, room);
    d = Math.min(d, upperRoom, lowerRoom);
  } else {
    const upperRoom = upper.reduce((sum, j) => sum + heights[j] - minPx, 0);
    d = -Math.min(-d, upperRoom);
  }

  const next = [...heights];
  const absorb = (order: number[], amount: number): number => {
    let rest = amount;
    for (const j of order) {
      if (rest > 0) {
        const add = Math.min(rest, cap(j) - next[j]);
        next[j] += add;
        rest -= add;
      } else if (rest < 0) {
        const take = Math.min(-rest, next[j] - minPx);
        next[j] -= take;
        rest += take;
      }
    }
    return rest;
  };
  absorb(upper, d);
  const unabsorbed = absorb(lower, -d);
  return { heights: next, length: length - unabsorbed };
}
