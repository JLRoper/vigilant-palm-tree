import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(join(here, "index.html")).href;
const outDir = join(here, "screenshots");
mkdirSync(outDir, { recursive: true });

const optionIds = [
  "biome-horizon",
  "map-true-panorama",
  "settlement-diorama",
  "painted-motif-kit",
  "cartographers-table",
];

async function waitForReady(page) {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function capture(page, query, filename) {
  await page.goto(pageUrl + query, { waitUntil: "load" });
  await waitForReady(page);
  const file = join(outDir, filename);
  await page.locator("#stage").screenshot({ path: file });
  console.log(file);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));

  for (const option of optionIds) {
    await capture(
      page,
      "?capture=hero&option=" + encodeURIComponent(option) + "&scenario=river-capital&seed=7",
      option + "--river-capital.png",
    );
    await capture(
      page,
      "?capture=option&option=" + encodeURIComponent(option),
      "contact--" + option + ".png",
    );
  }

  await capture(page, "?capture=all", "contact--all.png");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
