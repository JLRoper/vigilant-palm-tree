import { copyFileSync, unlinkSync, statSync } from "node:fs";

const pairs = [
  ["dist/assets/hero-player-ne.png", "src/resources/units/hero-player-ne.png"],
  ["dist/assets/hero-player-nw.png", "src/resources/units/hero-player-nw.png"],
  ["dist/assets/hero-player-se.png", "src/resources/units/hero-player-se.png"],
  ["dist/assets/hero-player-sw.png", "src/resources/units/hero-player-sw.png"],
];

for (const [src, dst] of pairs) {
  copyFileSync(src, dst);
  const a = statSync(src).size;
  const b = statSync(dst).size;
  console.log(`copied ${src} -> ${dst}  src=${a} dst=${b} match=${a === b}`);
}

const toDelete = [
  "dist/assets/hero-player-ne.png",
  "dist/assets/hero-player-nw.png",
  "dist/assets/hero-player-se.png",
  "dist/assets/hero-player-sw.png",
];

for (const f of toDelete) {
  try {
    unlinkSync(f);
    console.log(`deleted ${f}`);
  } catch (e) {
    console.log(`failed to delete ${f}: ${e.message}`);
  }
}
