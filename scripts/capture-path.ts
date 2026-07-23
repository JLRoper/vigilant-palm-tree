import { chromium } from 'playwright';
import path from 'path';

const OUT_DIR = 'tmp/captures';

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => (window as any).__gameDebug != null, { timeout: 15000 });
  await sleep(1500);

  const { heroId, startQ, startR } = await page.evaluate(() => {
    const heroes = (window as any).__gameDebug.getHeroes();
    const hero = heroes.find((h: any) => h.ownerId === 0);
    if (!hero) throw new Error('no player hero');
    return { heroId: hero.id, startQ: hero.q, startR: hero.r };
  });
  console.log('player hero', heroId, startQ, startR);

  // Select the hero
  await page.evaluate(({ id }) => (window as any).__gameDebug.setSelectedHero(id), { id: heroId });
  await sleep(300);

  // Try a ring of nearby tiles until a move succeeds
  let dest: { q: number; r: number } | null = null;
  const spiral = [];
  for (let radius = 1; radius <= 3; radius++) {
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) !== radius) continue;
        spiral.push({ q: startQ + dq, r: startR + dr });
      }
    }
  }

  for (const t of spiral) {
    const screen = await page.evaluate(({ q, r }) => (window as any).__gameDebug.screenFor(q, r) as { x: number; y: number }, t);
    await page.mouse.move(screen.x, screen.y);
    await sleep(250);
    await page.mouse.click(screen.x, screen.y);
    await sleep(250);
    const lastClick = await page.evaluate(() => (window as any).__gameDebug.lastClick) as any;
    console.log('tried', t.q, t.r, 'lastClick', lastClick);
    if (lastClick?.moved) {
      dest = t;
      break;
    }
  }

  if (!dest) {
    console.log('could not find reachable destination');
    await browser.close();
    return;
  }
  console.log('reachable destination', dest.q, dest.r);

  // Reset hero to start so we can capture the whole flow
  await page.evaluate(({ id, q, r }) => (window as any).__gameDebug.teleportHero(id, q, r), { id: heroId, q: startQ, r: startR });
  await sleep(300);
  await page.evaluate(({ id }) => (window as any).__gameDebug.setSelectedHero(id), { id: heroId });
  await sleep(200);

  // Screenshot 1: hover over destination before committing
  const destScreen = await page.evaluate(({ q, r }) => (window as any).__gameDebug.screenFor(q, r) as { x: number; y: number }, dest);
  await page.mouse.move(destScreen.x, destScreen.y);
  await sleep(350);
  await page.screenshot({ path: path.join(OUT_DIR, '01-hover-before-commit.png') });

  // Commit move with mouse click
  await page.mouse.click(destScreen.x, destScreen.y);
  await sleep(150);
  await page.screenshot({ path: path.join(OUT_DIR, '02-after-commit.png') });

  // Move cursor to a tile beyond the destination while hero animates
  const hoverQ = dest.q + 2;
  const hoverR = dest.r - 1;
  const hoverScreen = await page.evaluate(({ q, r }) => (window as any).__gameDebug.screenFor(q, r), { q: hoverQ, r: hoverR });
  await page.mouse.move(hoverScreen.x, hoverScreen.y);
  await sleep(100);
  await page.screenshot({ path: path.join(OUT_DIR, '03-hover-while-moving.png') });

  // Capture frames during animation
  for (let i = 1; i <= 16; i++) {
    await sleep(120);
    await page.screenshot({ path: path.join(OUT_DIR, `04-moving-${String(i).padStart(2, '0')}.png`) });
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
