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

  await page.goto('http://localhost:5174/');
  await page.waitForSelector('canvas#game', { timeout: 15000 });
  await sleep(2500);

  // Approximate hero sprite location from last screenshot (right-center of map)
  const heroX = 1050;
  const heroY = 380;

  // Hover over hero to show proposed path before selection
  await page.mouse.move(heroX, heroY);
  await sleep(400);
  await page.screenshot({ path: path.join(OUT_DIR, '01-hero-hover.png') });

  // Click to select the hero
  await page.mouse.click(heroX, heroY);
  await sleep(400);
  await page.screenshot({ path: path.join(OUT_DIR, '02-after-select.png') });

  // Move cursor to a destination tile to reveal proposed path from hero
  const destX = 720;
  const destY = 260;
  await page.mouse.move(destX, destY);
  await sleep(400);
  await page.screenshot({ path: path.join(OUT_DIR, '03-hover-destination.png') });

  // Click the destination to commit the move
  await page.mouse.click(destX, destY);
  await sleep(100);
  await page.screenshot({ path: path.join(OUT_DIR, '04-after-move-click.png') });

  // Move cursor to a third tile while hero animates; new proposed path should start from committed waypoint
  const nextHoverX = 620;
  const nextHoverY = 200;
  await page.mouse.move(nextHoverX, nextHoverY);
  await sleep(100);
  await page.screenshot({ path: path.join(OUT_DIR, '05-hover-while-moving.png') });

  // Capture several frames during animation
  for (let i = 1; i <= 12; i++) {
    await sleep(120);
    await page.screenshot({ path: path.join(OUT_DIR, `06-moving-${String(i).padStart(2, '0')}.png`) });
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
