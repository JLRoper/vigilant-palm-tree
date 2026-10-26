import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const override = process.argv[2] ? resolve(process.argv[2]) : undefined;
const SCALES = [[8000, 4], [20000, 6], [50000, 8]];
const fair = {};
let meta = {};
for (const [b, s] of SCALES) {
  const out = `scale-${b}.json`;
  execFileSync("npx", ["tsx", JSON.stringify(resolve(HERE, "sim.ts")), ...(override ? [JSON.stringify(override)] : [])], { cwd: HERE, env: { ...process.env, FIELD: "all", BUDGET: String(b), STACKS: String(s), OUT: out }, stdio: ["ignore", "ignore", "inherit"], shell: true, windowsHide: true });
  for (const r of JSON.parse(readFileSync(resolve(HERE, "out", out), "utf8"))) {
    (fair[r.id] ??= []).push(Math.log(r.fair));
    meta[r.id] = r;
  }
}
const rows = Object.entries(fair).map(([id, l]) => ({ ...meta[id], fair: Math.exp(l.reduce((a, b) => a + b) / l.length) }));
const ref = rows.filter((r) => r.f === "human" && !process.env.NOFIT);
const xs = ref.map((r) => Math.log(r.fair)), ys = ref.map((r) => Math.log(r.price));
const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
let e = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
let k = Math.exp(my - e * mx); if (process.env.CURVE) { [k, e] = process.env.CURVE.split(",").map(Number); }
console.log(`price curve (fit on Crownlands): target = ${k.toFixed(3)} * value^${e.toFixed(3)}`);
const order = ["human", "ashen", "ironmark", "verdant"];
rows.sort((a, b) => order.indexOf(a.f) - order.indexOf(b.f) || a.fair - b.fair);
let last;
for (const r of rows) {
  if (r.f !== last) { console.log(`\n${r.f}`); last = r.f; }
  const target = k * r.fair ** e * (r.stats.includes(" ranged") ? 1.3 : 1);
  const dev = Math.round((r.price / target - 1) * 100);
  console.log(`${r.id.padEnd(17)} ${r.stats.padEnd(27)} value=${r.fair.toFixed(0).padStart(5)} price=${String(r.price).padStart(5)} target=${target.toFixed(0).padStart(5)} ${dev > 0 ? "+" : ""}${dev}%`);
}
