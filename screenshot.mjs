import puppeteer from 'puppeteer';

const outDir = 'C:\\Users\\Jacob\\AppData\\Local\\Temp\\kilo\\flux\\screenshots';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({ path: `${outDir}/initial.png`, fullPage: false });
  console.log('Saved: initial.png');

  await page.mouse.click(640, 360);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${outDir}/after-click-1.png`, fullPage: false });
  console.log('Saved: after-click-1.png');

  await page.mouse.click(400, 200);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${outDir}/after-click-2.png`, fullPage: false });
  console.log('Saved: after-click-2.png');

  await browser.close();
  console.log('Done');
})();
