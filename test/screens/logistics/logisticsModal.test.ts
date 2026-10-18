import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("owned settlement stockpiles use treasury-first icons and compact per-turn columns", { timeout: 90_000 }, async () => {
  const server = await createServer({
    root,
    server: { host: "127.0.0.1", port: 0, open: false },
    logLevel: "error",
  });
  await server.listen();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await page.route("**/stockpile-fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"></body></html>',
    }));
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}stockpile-fixture`);
    const expected = await page.evaluate(async () => {
      const modalPath = "/src/screens/logistics/logisticsModal.ts";
      const enginePath = "/packages/engine/src/index.ts";
      const assetsPath = "/src/render/assetDescriptors.ts";
      const { openLogisticsModal } = await import(modalPath) as typeof import("../../../src/screens/logistics/logisticsModal");
      const { createInitialState, settlementProductionRates, settlementResourceCap, settlementTreasuryCap } = await import(enginePath) as typeof import("../../../packages/engine/src/index");
      const { RESOURCE_PILE_BUBBLY_SPRITES } = await import(assetsPath) as typeof import("../../../src/render/assetDescriptors");
      const state = createInitialState();
      const settlement = Object.values(state.settlements)[0];
      for (const s of Object.values(state.settlements)) s.ownerId = 1;
      settlement.ownerId = 0;
      settlement.name = "Stockpile Keep";
      settlement.gold = 456;
      settlement.warehouse = { wood: 12.9, stone: 23.8, iron: 34.7, arcane: 45.6, food: 56.5 };
      settlement.resourceRates = { gold: 999, wood: 5, stone: 0, iron: 7, arcane: 0, food: 3 };
      settlement.citySpots = [];
      settlement.districts = {};
      settlement.buildings = [{ gx: 1, gy: 1, kind: "goldMine", level: 1, style: "classic" }];
      state.heroes = {};
      const player = state.players.find((p) => p.id === 0)!;
      player.wagonsOwned = 17;
      player.wagonsUnassigned = 3;
      player.treasuryWagonsOwned = 19;
      player.treasuryWagonsUnassigned = 4;
      state.players = [player];
      state.tradeRoutes = [];
      const production = settlementProductionRates(settlement, state.castleSeed, state.heroes);
      const caps = settlementResourceCap(settlement);
      openLogisticsModal({
        parent: document.body,
        getState: () => state,
        actions: {
          transferResources: () => ({ ok: true, reason: "" }),
          assignWagons: () => ({ ok: true, reason: "" }),
          buyWagons: (id, count, slot) => {
            document.body.dataset.lastPurchase = JSON.stringify({ id, count, slot });
            return { ok: true, reason: "" };
          },
          createTradeRoute: () => ({ ok: true, reason: "" }),
          updateTradeRoute: () => ({ ok: true, reason: "" }),
        },
      });
      return {
        id: settlement.id,
        goldRate: production.goldPerTurn,
        rows: (["gold", "wood", "stone", "iron", "arcane", "food"] as const).map((resource) => ({
          resource,
          image: new URL(RESOURCE_PILE_BUBBLY_SPRITES[resource], location.href).href,
          amount: resource === "gold"
            ? `${settlement.gold}/${settlementTreasuryCap(settlement)}`
            : `${Math.floor(settlement.warehouse[resource] ?? 0)}/${caps[resource]}`,
          rate: resource === "gold" ? production.goldPerTurn : production.rates.find((r) => r.resource === resource)?.perTurn ?? 0,
        })),
      };
    });
    assert(expected.goldRate > 0 && expected.goldRate !== 999, "treasury rate comes from buildings, not the phantom tile gold rate");
    const name = page.locator(`[data-focus="stockpile-${expected.id}"]`);
    const heading = name.locator("..");
    const block = heading.locator("..");
    const priceTip = page.locator('[id^="logistics-price-tip-"]');
    const tip = page.locator('[id^="logistics-stockpile-tip-"]');
    assert.equal(await tip.count(), 1);
    assert.equal(await tip.isVisible(), false);
    assert.equal(await tip.getAttribute("role"), "tooltip");
    assert.equal(await tip.evaluate((el) => el.parentElement === document.body), true);
    assert.equal(await block.locator(".logistics-stockpile").count(), 0);
    assert.equal(await block.locator(":scope > div").count(), 1);
    assert.equal(await heading.getAttribute("title"), null);
    assert.equal(await heading.getAttribute("tabindex"), null);
    assert.equal(await name.getAttribute("title"), null);
    assert.equal(await name.getAttribute("tabindex"), "0");
    assert.equal(await name.textContent(), "Stockpile Keep (L1)");
    const groups = heading.locator(":scope > span");
    assert.equal(await groups.count(), 3);
    const counts = groups.nth(1).locator("span");
    for (const [i, label] of ["Supply wagons: 3", "Treasure carts: 4"].entries()) {
      const group = groups.nth(i + 1);
      const count = group.locator("span");
      const button = group.locator("button");
      assert.equal(await count.textContent(), label);
      assert((await count.getAttribute("title"))?.includes("player-wide shared pool"));
      assert((await count.getAttribute("aria-label"))?.includes("Available unassigned"));
      assert.equal(await count.evaluate((el) => getComputedStyle(el).fontWeight), "400");
      assert.equal(await count.evaluate((el) => el.nextElementSibling?.tagName), "BUTTON");
      assert.equal(await button.textContent(), i === 0 ? "Buy wagon" : "Buy cart");
      assert.equal(await button.getAttribute("title"), null);
      assert((await button.getAttribute("aria-label"))?.includes("unassigned"));
      const countBox = (await count.boundingBox())!;
      const buttonBox = (await button.boundingBox())!;
      assert(buttonBox.x >= countBox.x + countBox.width);
      assert(Math.abs(buttonBox.y + buttonBox.height / 2 - countBox.y - countBox.height / 2) < 1);
    }
    assert.equal(await name.evaluate((el) => getComputedStyle(el).fontWeight), "600");
    const nameBox = (await name.boundingBox())!;
    const beforeHeight = (await block.boundingBox())!.height;
    const pointer = { x: Math.round(nameBox.x + nameBox.width / 2), y: Math.round(nameBox.y + nameBox.height / 2) };
    await page.mouse.move(pointer.x, pointer.y);
    assert(await tip.isVisible());
    assert.equal(await tip.evaluate((el) => getComputedStyle(el).position), "fixed");
    assert.equal(await tip.evaluate((el) => getComputedStyle(el).pointerEvents), "none");
    assert.equal(await name.getAttribute("aria-describedby"), await tip.getAttribute("id"));
    assert.equal((await block.boundingBox())!.height, beforeHeight);
    assert.equal(await tip.locator("text=Supply wagons").count(), 0);
    const checkAnchor = async (x: number, y: number): Promise<void> => {
      const box = (await tip.boundingBox())!;
      const viewport = page.viewportSize()!;
      assert(Math.abs(box.x - Math.max(8, Math.min(x, viewport.width - box.width - 8))) < 0.1);
      assert(Math.abs(box.y - Math.max(8, Math.min(y, viewport.height - box.height - 8))) < 0.1);
    };
    await checkAnchor(pointer.x, pointer.y);
    await page.mouse.move(pointer.x + 20, pointer.y + 2);
    await checkAnchor(pointer.x + 20, pointer.y + 2);
    const measured = (await tip.boundingBox())!;
    console.log(JSON.stringify({ pointer: { x: pointer.x + 20, y: pointer.y + 2 }, popupTopLeft: { x: measured.x, y: measured.y }, countsWeight: "400" }));
    const stock = tip.locator(".logistics-stockpile");
    assert.equal(await stock.count(), 1);
    const children = stock.locator(":scope > *");
    assert.equal(await children.count(), 18);
    for (const [i, row] of expected.rows.entries()) {
      const image = children.nth(i * 3);
      const amount = children.nth(i * 3 + 1);
      const rate = children.nth(i * 3 + 2);
      assert.equal(await image.getAttribute("alt"), row.resource);
      assert.equal(await image.getAttribute("title"), row.resource);
      assert.equal(await image.evaluate((el) => (el as HTMLImageElement).src), row.image);
      assert.equal(await image.evaluate((el) => getComputedStyle(el).imageRendering), "pixelated");
      assert.equal(await amount.textContent(), row.amount);
      assert((await amount.getAttribute("aria-label"))?.startsWith(`${row.resource}: `));
      assert.equal(await rate.textContent(), `+${row.rate}/turn`);
      assert.equal(await rate.getAttribute("title"), "production per turn");
      assert.equal(await rate.getAttribute("aria-label"), `${row.resource}: ${row.rate} production per turn`);
    }
    assert.equal(await children.nth(8).textContent(), "+0/turn");
    assert.equal(await children.nth(14).textContent(), "+0/turn");
    assert(!/treasury|wood|stone|iron|arcane|food|no production/.test((await stock.textContent())!));
    await page.mouse.move(0, 0);
    assert.equal(await tip.isVisible(), false);
    assert.equal(await name.getAttribute("aria-describedby"), null);
    await name.focus();
    assert(await tip.isVisible());
    await checkAnchor(nameBox.x, nameBox.y + nameBox.height);
    await counts.hover();
    assert.equal(await tip.isVisible(), false, "counts suppress a keyboard-focused name tooltip");
    assert.equal(await name.evaluate((el) => document.activeElement === el), true);
    await name.hover();
    assert(await tip.isVisible());
    await counts.hover();
    assert.equal(await tip.isVisible(), false, "leaving the focused name must not reopen stockpiles");
    assert.equal(await priceTip.isVisible(), false);
    await name.evaluate((el) => el.blur());
    await name.focus();
    await page.keyboard.press("Escape");
    assert.equal(await tip.isVisible(), false);
    assert.equal(await name.getAttribute("aria-describedby"), null);
    await name.evaluate((el) => el.blur());
    await name.focus();
    for (const width of [1000, 360]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 360) {
        assert.equal(await heading.evaluate((el) => getComputedStyle(el).flexWrap), "wrap");
        assert((await groups.nth(2).boundingBox())!.y > (await name.boundingBox())!.y);
        for (const group of [groups.nth(1), groups.nth(2)]) {
          const groupBox = (await group.boundingBox())!;
          assert(groupBox.x >= 0 && groupBox.x + groupBox.width <= width);
          const countBox = (await group.locator("span").boundingBox())!;
          const buttonBox = (await group.locator("button").boundingBox())!;
          assert(buttonBox.x >= countBox.x + countBox.width);
        }
      }
      const box = await stock.boundingBox();
      const tipBox = await tip.boundingBox();
      assert(tipBox && tipBox.x >= 8 && tipBox.x + tipBox.width <= width - 8);
      assert(tipBox.y >= 8 && tipBox.y + tipBox.height <= 892);
      assert(box && box.width < 250 && box.x >= 0 && box.x + box.width <= width);
      const firstAmount = await children.nth(1).boundingBox();
      const firstRate = await children.nth(2).boundingBox();
      assert(firstAmount && firstRate);
      for (let i = 0; i < 6; i++) {
        const icon = await children.nth(i * 3).boundingBox();
        const amount = await children.nth(i * 3 + 1).boundingBox();
        const rate = await children.nth(i * 3 + 2).boundingBox();
        assert(icon && amount && rate);
        assert.equal(icon.y, box.y + i * 25);
        assert.equal(amount.x + amount.width, firstAmount.x + firstAmount.width);
        assert.equal(rate.x + rate.width, firstRate.x + firstRate.width);
        assert(amount.x >= icon.x + icon.width && rate.x >= amount.x + amount.width);
      }
    }
    await page.setViewportSize({ width: 360, height: 200 });
    await name.focus();
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    const clamped = (await tip.boundingBox())!;
    assert(clamped.x >= 8 && clamped.x + clamped.width <= 352);
    assert(clamped.y >= 8 && clamped.y + clamped.height <= 192);
    await page.setViewportSize({ width: 1000, height: 900 });
    let priorTipId = await tip.getAttribute("id");
    for (const slot of ["cargo", "treasury"]) {
      const button = page.locator(`[data-focus="buy-wagon-${expected.id}-${slot}"]`);
      await button.hover();
      assert.equal(await tip.isVisible(), false);
      assert(await priceTip.isVisible());
      assert.equal(await priceTip.getAttribute("role"), "tooltip");
      assert.equal(await priceTip.evaluate((el) => el.parentElement === document.body), true);
      assert.equal(await priceTip.evaluate((el) => getComputedStyle(el).position), "fixed");
      assert.equal(await priceTip.textContent(), "2005");
      const buttonBox = (await button.boundingBox())!;
      const priceBox = (await priceTip.boundingBox())!;
      assert(Math.abs(priceBox.x - (buttonBox.x + buttonBox.width / 2)) < 1);
      assert(Math.abs(priceBox.y - (buttonBox.y + buttonBox.height / 2)) < 1);
      for (const [i, resource, amount] of [[0, "gold", "200"], [1, "wood", "5"]] as const) {
        const item = priceTip.locator("span").nth(i);
        assert.equal(await item.textContent(), amount);
        assert.equal(await item.locator("img").getAttribute("alt"), resource);
        assert.equal(await item.locator("img").evaluate((el) => (el as HTMLImageElement).src), expected.rows.find((row) => row.resource === resource)!.image);
      }
      await page.keyboard.press("Escape");
      assert.equal(await priceTip.isVisible(), false);
      assert.equal(await button.getAttribute("aria-describedby"), null);
      await button.focus();
      assert(await priceTip.isVisible());
      assert.equal(await tip.isVisible(), false);
      const focusPriceBox = (await priceTip.boundingBox())!;
      assert(Math.abs(focusPriceBox.x - buttonBox.x) < 0.1);
      assert(Math.abs(focusPriceBox.y - buttonBox.y - buttonBox.height) < 0.1);
      await counts.hover();
      assert.equal(await priceTip.isVisible(), false);
      await button.hover();
      await button.dispatchEvent("mousemove", { clientX: 999, clientY: 899 });
      const clampedPrice = (await priceTip.boundingBox())!;
      assert.equal(clampedPrice.x + clampedPrice.width, 992);
      assert.equal(clampedPrice.y + clampedPrice.height, 892);
      const oldPriceId = await priceTip.getAttribute("id");
      await button.click();
      await page.waitForTimeout(80);
      assert.equal(await priceTip.count(), 1);
      assert.notEqual(await priceTip.getAttribute("id"), oldPriceId);
      assert(await priceTip.isVisible(), "restored button focus opens only its price");
      assert.equal(await page.locator("body").getAttribute("data-last-purchase"), JSON.stringify({ id: expected.id, count: 1, slot }));
      assert.equal(await page.locator(":focus").getAttribute("data-focus"), `buy-wagon-${expected.id}-${slot}`);
      assert.equal(await tip.count(), 1);
      assert.equal(await tip.isVisible(), false);
      assert.notEqual(await tip.getAttribute("id"), priorTipId);
      priorTipId = await tip.getAttribute("id");
      assert.equal(await block.locator(".logistics-stockpile").count(), 0);
      await name.focus();
      assert(await tip.isVisible());
      assert.equal(await priceTip.isVisible(), false);
    }
    await page.locator('[data-modal="true"] button').first().click();
    assert.equal(await tip.count(), 0);
    assert.equal(await priceTip.count(), 0);
    await page.evaluate(async () => {
      const busPath = "/src/core/eventBus.ts";
      const { bus } = await import(busPath) as typeof import("../../../src/core/eventBus");
      bus.emit({ type: "state:committed" });
    });
    assert.equal(await tip.count(), 0);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("logistics routes stay compact with one floating, accessible tooltip", { timeout: 90_000 }, async () => {
  const server = await createServer({
    root,
    server: { host: "127.0.0.1", port: 0, open: false },
    logLevel: "error",
  });
  await server.listen();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await page.route("**/logistics-fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"><button id="outside">Outside</button></body></html>',
    }));
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}logistics-fixture`);
    await page.evaluate(async () => {
      const modalPath = "/src/screens/logistics/logisticsModal.ts";
      const enginePath = "/packages/engine/src/index.ts";
      const { openLogisticsModal } = await import(modalPath) as typeof import("../../../src/screens/logistics/logisticsModal");
      const { createInitialState } = await import(enginePath) as typeof import("../../../packages/engine/src/index");
      const state = createInitialState();
      for (const hero of Object.values(state.heroes)) hero.ownerId = 1;
      for (const settlement of Object.values(state.settlements)) settlement.ownerId = 1;
      state.players = [];
      state.tradeRoutes = ["r1", "r2"].map((id, i) => ({
        id,
        ownerId: 0,
        from: { kind: "settlement", id: Object.keys(state.settlements)[0] },
        to: { kind: "hero", id: Object.keys(state.heroes)[0] },
        payload: { kind: "resource", resource: "wood" },
        wagons: i + 1,
        caravan: null,
      }));
      openLogisticsModal({
        parent: document.body,
        getState: () => state,
        actions: {
          transferResources: () => ({ ok: true, reason: "" }),
          assignWagons: () => ({ ok: true, reason: "" }),
          buyWagons: () => ({ ok: true, reason: "" }),
          createTradeRoute: () => ({ ok: true, reason: "" }),
          updateTradeRoute: (id, change) => {
            document.body.dataset.lastAction = JSON.stringify({ id, change });
            const route = state.tradeRoutes!.find((route) => route.id === id)!;
            if (change.remove) state.tradeRoutes = state.tradeRoutes!.filter((route) => route.id !== id);
            else route.wagons += change.wagonsDelta ?? 0;
            return { ok: true, reason: "" };
          },
        },
      });
    });

    const row = page.locator('[data-focus="route-r1"]');
    const tip = page.getByRole("tooltip", { includeHidden: true });
    const before = await row.boundingBox();
    assert(before);
    assert.equal(before.height, 48);
    assert.equal(await row.getAttribute("title"), null);
    assert.equal(await tip.count(), 1);
    assert.equal(await row.getByRole("tooltip", { includeHidden: true }).count(), 0);
    assert.equal(await row.evaluate((el) => el.children.length), 3);
    assert.equal(await row.getByRole("meter").count(), 2);
    assert.equal((await row.getByRole("meter").first().boundingBox())!.height, 40);
    const plus = row.locator('[data-focus="route-r1-plus"]');
    const minus = row.locator('[data-focus="route-r1-minus"]');
    const plusBox = await plus.boundingBox();
    const minusBox = await minus.boundingBox();
    assert(plusBox && minusBox);
    assert.equal(plusBox.y, minusBox.y);
    assert(plusBox.y >= before.y && plusBox.y + plusBox.height <= before.y + before.height);

    await row.hover();
    assert(await tip.isVisible());
    assert.equal(await tip.evaluate((el) => getComputedStyle(el).position), "fixed");
    assert.equal(await tip.textContent(), await row.getAttribute("aria-label"));
    assert.equal((await row.boundingBox())!.height, before.height);
    const tooltipId = await tip.getAttribute("id");
    assert.equal(await row.getAttribute("aria-describedby"), tooltipId);
    await row.focus();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    assert(await tip.isVisible(), "keyboard focus keeps tooltip open after mouse leave");
    await row.hover();
    await page.locator("#outside").focus();
    assert(await tip.isVisible(), "hover keeps tooltip open after blur");
    await tip.hover();
    await page.waitForTimeout(150);
    assert(await tip.isVisible(), "tooltip itself is hoverable");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    assert.equal(await tip.isVisible(), false);
    await plus.focus();
    assert(await tip.isVisible(), "child controls expose route context");
    await page.keyboard.press("Escape");
    assert.equal(await tip.isVisible(), false);
    await minus.focus();
    assert(await tip.isVisible());
    const rowB = page.locator('[data-focus="route-r2"]');
    const labelA = await row.getAttribute("aria-label");
    const labelB = await rowB.getAttribute("aria-label");
    assert.notEqual(labelA, labelB);
    await rowB.hover();
    assert.equal(await tip.textContent(), labelB, "hovering row B takes over from focused row A");
    assert.equal(await rowB.getAttribute("aria-describedby"), tooltipId);
    assert.equal(await row.getAttribute("aria-describedby"), null);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    assert.equal(await tip.textContent(), labelA, "leaving row B reverts the tooltip to focused row A");
    assert.equal(await row.getAttribute("aria-describedby"), tooltipId);
    assert.equal(await rowB.getAttribute("aria-describedby"), null);

    await plus.click();
    await page.waitForFunction(() => document.querySelector('[data-focus="route-r1"]')?.textContent?.startsWith("2x"));
    assert.equal(await page.locator("body").getAttribute("data-last-action"), JSON.stringify({ id: "r1", change: { wagonsDelta: 1 } }));
    assert.equal(await tip.count(), 1);
    assert.notEqual(await tip.getAttribute("id"), tooltipId);
    assert.equal(await page.locator(":focus").getAttribute("data-focus"), "route-r1-plus");
    assert(await tip.isVisible());
    await minus.click();
    await page.waitForFunction(() => document.querySelector('[data-focus="route-r1"]')?.textContent?.startsWith("1x"));
    assert.equal(await page.locator("body").getAttribute("data-last-action"), JSON.stringify({ id: "r1", change: { wagonsDelta: -1 } }));

    await page.setViewportSize({ width: 360, height: 600 });
    await row.focus();
    const narrow = await row.boundingBox();
    const narrowPlus = await plus.boundingBox();
    const narrowMinus = await minus.boundingBox();
    assert(narrow && narrowPlus && narrowMinus);
    assert.equal(narrowPlus.y, narrowMinus.y);
    assert(narrow.x >= 0 && narrow.x + narrow.width <= 360);
    const tipBox = await tip.boundingBox();
    assert(tipBox);
    assert(tipBox.x >= 8 && tipBox.x + tipBox.width <= 352);
    assert(tipBox.y >= 8 && tipBox.y + tipBox.height <= 592);
    assert.equal((await row.boundingBox())!.height, narrow.height);

    await row.locator('[data-focus="route-r1-remove"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-focus="route-r1"]'));
    assert.equal(await page.locator("body").getAttribute("data-last-action"), JSON.stringify({ id: "r1", change: { remove: true } }));
    assert.equal(await tip.count(), 1);
    await page.locator('[data-focus="route-r2"]').focus();
    assert(await tip.isVisible());
    await page.locator('[data-modal="true"] button').first().click();
    assert.equal(await tip.count(), 0);
    await page.evaluate(async () => {
      const busPath = "/src/core/eventBus.ts";
      const { bus } = await import(busPath) as typeof import("../../../src/core/eventBus");
      bus.emit({ type: "state:committed" });
    });
    await page.waitForTimeout(100);
    assert.equal(await tip.count(), 0);
  } finally {
    await browser?.close();
    await server.close();
  }
});
