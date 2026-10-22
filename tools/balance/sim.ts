import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBattle } from "../../packages/engine/src/combat/resolveBattle";
import type { UnitType } from "../../packages/engine/src/units";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RES: Record<string, number> = { wood: 10, stone: 10, iron: 25, arcane: 50 };
const unitTypes: Record<string, UnitType> = JSON.parse(readFileSync(resolve(HERE, "units.json"), "utf8"));
const price: Record<string, number> = {};
for (const l of readFileSync(resolve(HERE, "costs.csv"), "utf8").trim().split(/\r?\n/)) {
  const [id, g, , res] = l.split(",");
  if (!unitTypes[id]) continue;
  let eq = +g;
  for (const m of (res ?? "").matchAll(/(\w+): (\d+)/g)) eq += RES[m[1]] * +m[2];
  price[id] = eq;
}
const overridePath = process.argv[2];
if (overridePath) {
  const o = JSON.parse(readFileSync(overridePath, "utf8")) as Record<string, Partial<UnitType> & { price?: number }>;
  for (const [id, v] of Object.entries(o)) {
    const { price: p, ...stats } = v;
    unitTypes[id] = { ...(unitTypes[id] ?? { id, name: id, description: "", specialty: "militia", specialtyPriority: 1, range: 1, speed: 4 }), ...stats, id } as UnitType;
    if (p !== undefined) price[id] = p;
  }
}

const BUDGET = +(process.env.BUDGET ?? 60000);
const STACKS = +(process.env.STACKS ?? 8);
const SEEDS = [1, 7];

function army(id: string, unitPrice: number) {
  const n = Math.max(1, Math.round(BUDGET / unitPrice));
  const per = Math.floor(n / STACKS), extra = n % STACKS;
  const out = [];
  for (let i = 0; i < STACKS; i++) {
    const c = per + (i < extra ? 1 : 0);
    if (c > 0) out.push({ entries: [{ unitTypeId: id, count: c }] });
  }
  return { platoons: out, n };
}

function remainingFrac(platoons: { entries: { count: number }[] }[], n: number): number {
  return platoons.reduce((s, p) => s + p.entries.reduce((a, e) => a + e.count, 0), 0) / n;
}

function duel(a: string, aPrice: number, b: string, bPrice: number): number {
  let total = 0, runs = 0;
  const A = army(a, aPrice), B = army(b, bPrice);
  for (const seed of SEEDS) {
    for (const aAttacks of [true, false]) {
      const r = resolveBattle(aAttacks ? A.platoons : B.platoons, aAttacks ? B.platoons : A.platoons, { unitTypes, obstacleSeed: seed });
      const aLeft = remainingFrac(aAttacks ? r.attackerPlatoons : r.defenderPlatoons, A.n);
      const bLeft = remainingFrac(aAttacks ? r.defenderPlatoons : r.attackerPlatoons, B.n);
      total += aLeft - bLeft;
      runs++;
    }
  }
  return total / runs;
}

const ids = Object.keys(price);
const field = (process.env.FIELD ?? "human").split(",");
const opponents = process.env.VS ? process.env.VS.split(",") : ids.filter((id) => field.includes("all") || field.includes(unitTypes[id].factionId ?? "human"));

function score(id: string, p: number): number {
  return opponents.reduce((s, o) => s + duel(id, p, o, price[o]), 0) / opponents.length;
}

function fairPrice(id: string): number {
  let lo = price[id] / 6, hi = price[id] * 6;
  for (let i = 0; i < 14; i++) {
    const mid = Math.sqrt(lo * hi);
    if (score(id, mid) > 0) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

const t0 = Date.now();
const rows = [];
const only = process.env.ONLY?.split(",");
for (const id of ids) {
  if (only && !only.includes(id)) continue;
  const u = unitTypes[id];
  const s = score(id, price[id]);
  const fair = fairPrice(id);
  rows.push({ id, f: u.factionId, stats: `${u.attack}/${u.defence}/${u.health} s${u.speed} r${u.range ?? 1} ${u.advantageType}`, price: price[id], score: +s.toFixed(3), fair: Math.round(fair), dev: Math.round((price[id] / fair - 1) * 100) });
}
rows.sort((a, b) => (a.f! < b.f! ? -1 : a.f! > b.f! ? 1 : a.fair - b.fair));
for (const r of rows) console.log(`${String(r.f).padEnd(9)} ${r.id.padEnd(16)} ${r.stats.padEnd(28)} price=${String(r.price).padStart(5)} fair=${String(r.fair).padStart(5)} dev=${r.dev > 0 ? "+" : ""}${r.dev}%  score@price=${r.score}`);
mkdirSync(resolve(HERE, "out"), { recursive: true });
writeFileSync(resolve(HERE, "out", process.env.OUT ?? "sim-out.json"), JSON.stringify(rows, null, 1));
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
