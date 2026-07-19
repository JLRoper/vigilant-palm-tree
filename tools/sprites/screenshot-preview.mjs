import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const previewPath = path.join(projectRoot, "sprite-preview.html");
const outPath = path.join(projectRoot, "sprite-preview.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
await page.goto("file://" + previewPath.replace(/\\/g, "/"));
await page.waitForLoadState("networkidle");
await page.waitForTimeout(400); // let images load
await page.screenshot({ path: outPath, fullPage: true });
console.log("wrote", outPath);
await browser.close();
