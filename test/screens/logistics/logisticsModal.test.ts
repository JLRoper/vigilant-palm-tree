import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium, type Page } from "playwright";
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
      // A seat-0 player must exist for the route row's steppers to have a
      // pool at all: the row's +1 is gated on the same player-wide unassigned
      // wagons updateTradeRoute clamps against, so a scene with no player row
      // legitimately leaves it off (a state the stepper suite pins its own way).
      const seat = state.players.find((p) => p.id === 0)!;
      seat.wagonsUnassigned = 3;
      seat.treasuryWagonsUnassigned = 3;
      state.players = [seat];
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
    // The one-wagon route's −1 is legitimately OFF (the engine answers
    // route_needs_a_wagon), and a disabled button cannot take focus, so the
    // child-control focus check uses the row's always-live remove control.
    await row.locator('[data-focus="route-r1-remove"]').focus();
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

test("Accept all is disabled, with the panel's own refusal reason, when no recommendation can be accepted", { timeout: 90_000 }, async () => {
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
    await page.route("**/logistics-needs-fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"></body></html>',
    }));
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}logistics-needs-fixture`);
    // One recommended route (food into a low settlement, sourced from a
    // richer sibling) with an EMPTY unassigned-wagon pool: the impossible
    // action this test measures. The unit catalog is aborted, so the
    // recommendation must come from the pure settlement food-need path.
    const fixture = await page.evaluate(async () => {
      const modalPath = "/src/screens/logistics/logisticsModal.ts";
      const enginePath = "/packages/engine/src/index.ts";
      const { openLogisticsModal } = await import(modalPath) as typeof import("../../../src/screens/logistics/logisticsModal");
      const { createInitialState } = await import(enginePath) as typeof import("../../../packages/engine/src/index");
      const state = createInitialState();
      for (const s of Object.values(state.settlements)) s.ownerId = 1;
      const [low, source] = Object.values(state.settlements);
      low.ownerId = 0;
      low.population = 500;
      low.goldTax = 0;
      low.gold = 0;
      low.warehouse = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
      low.buildings = [];
      low.citySpots = [];
      low.districts = {};
      source.ownerId = 0;
      source.population = 0;
      source.goldTax = 0;
      source.gold = 0;
      source.warehouse = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 500 };
      source.buildings = [];
      source.citySpots = [];
      source.districts = {};
      state.heroes = {};
      state.tradeRoutes = [];
      const player = { ...state.players.find((p) => p.id === 0)!, wagonsUnassigned: 0, treasuryWagonsUnassigned: 0 };
      state.players = [player];
      const created: unknown[] = [];
      (window as unknown as Record<string, unknown>).__fixture = { state, player, created };
      openLogisticsModal({
        parent: document.body,
        getState: () => state,
        actions: {
          transferResources: () => ({ ok: true, reason: "" }),
          assignWagons: () => ({ ok: true, reason: "" }),
          buyWagons: () => ({ ok: true, reason: "" }),
          createTradeRoute: (from, to, payload, wagons) => {
            created.push({ from, to, payload, wagons });
            return { ok: true, reason: "" };
          },
          updateTradeRoute: () => ({ ok: true, reason: "" }),
        },
      });
      return { low: { q: low.q, r: low.r }, source: { q: source.q, r: source.r } };
    });
    assert.notDeepEqual(fixture.low, fixture.source, "fixture source must be a different tile than the destination");

    const acceptAll = page.locator('[data-focus="rec-accept-all"]');
    assert.equal(await acceptAll.count(), 1, "the fixture produces a bulk control to measure");
    assert.equal(await page.locator('[data-focus="rec-accept-0"]').count(), 1, "exactly one recommendation exists");
    assert.equal(await page.locator('[data-focus="rec-accept-1"]').count(), 0);
    // The per-row sibling was already correct; the bulk control is the defect.
    assert.equal(await page.locator('[data-focus="rec-accept-0"]').isDisabled(), true);
    assert.equal(
      await acceptAll.isDisabled(),
      true,
      "Accept all must be disabled when its only recommendation cannot be accepted",
    );
    assert.equal(await acceptAll.getAttribute("title"), "no unassigned wagons — buy one below");
    // State and behaviour agree: a disabled control cannot create anything.
    await acceptAll.evaluate((el) => (el as HTMLButtonElement).click());
    const createdCount = await page.evaluate(
      () => ((window as unknown as { __fixture: { created: unknown[] } }).__fixture).created.length,
    );
    assert.equal(createdCount, 0, "a disabled control creates nothing");

    // And the control is not unconditionally dead: one unassigned wagon makes
    // it live again, with the tooltip reason retired.
    await page.evaluate(async () => {
      (window as unknown as { __fixture: { player: { wagonsUnassigned: number } } }).__fixture.player.wagonsUnassigned = 1;
      const busPath = "/src/core/eventBus.ts";
      const { bus } = await import(busPath) as typeof import("../../../src/core/eventBus");
      bus.emit({ type: "state:committed" });
    });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-focus="rec-accept-all"]') as HTMLButtonElement | null;
      return !!el && !el.disabled;
    });
    assert.equal(await acceptAll.isDisabled(), false);
    assert.equal(await acceptAll.getAttribute("title"), null, "the failure reason retires with the block");
  } finally {
    await browser?.close();
    await server.close();
  }
});
test("the Logistics modal wires its declared transferResources action to a cargo row at the hero's own settlement", { timeout: 90_000 }, async () => {
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
    await page.route("**/cargo-modal-fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"></body></html>',
    }));
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}cargo-modal-fixture`);

    const facts = await page.evaluate(async () => {
      const { openLogisticsModal } = await import("/src/screens/logistics/logisticsModal.ts") as typeof import("../../../src/screens/logistics/logisticsModal");
      const { bus } = await import("/src/core/eventBus.ts") as typeof import("../../../src/core/eventBus");
      const engine = await import("/packages/engine/src/index.ts") as typeof import("../../../packages/engine/src/index");
      const state = engine.createInitialState();
      const settlement = Object.values(state.settlements)[0];
      const hero = Object.values(state.heroes)[0];
      settlement.ownerId = hero.ownerId;
      settlement.level = 1;
      settlement.gold = 0;
      settlement.warehouse = { wood: 120, stone: 0, iron: 0, arcane: 0, food: 0 };
      settlement.citySpots = [];
      settlement.districts = {};
      settlement.buildings = [];
      hero.q = settlement.q;
      hero.r = settlement.r;
      hero.name = "Scout";
      hero.gold = 0;
      hero.wagons = 5;
      hero.resources = { wood: 250 };
      state.selectedHeroId = hero.id;
      state.tradeRoutes = [];

      const calls: Array<{ heroId: string; settlementId: string; direction: string; amounts: Record<string, number> }> = [];
      openLogisticsModal({
        parent: document.body,
        getState: () => state,
        actions: {
          transferResources: (heroId, settlementId, direction, amounts) => {
            calls.push({ heroId, settlementId, direction, amounts: amounts as Record<string, number> });
            return { ok: true, reason: "" };
          },
          assignWagons: () => ({ ok: true, reason: "" }),
          buyWagons: () => ({ ok: true, reason: "" }),
          createTradeRoute: () => ({ ok: true, reason: "" }),
          updateTradeRoute: () => ({ ok: true, reason: "" }),
        },
      });
      const settle = async (): Promise<void> => {
        bus.emit({ type: "state:committed" });
        await new Promise((resolve) => setTimeout(resolve, 60));
      };
      const at = () => document.querySelectorAll('[data-focus^="hero-cargo-"]');
      const depositBtn = () => document.querySelector('[data-focus="hero-cargo-deposit"]') as HTMLButtonElement | null;
      const withdrawBtn = () => document.querySelector('[data-focus="hero-cargo-withdraw"]') as HTMLButtonElement | null;

      const home = {
        controls: at().length,
        label: depositBtn()?.closest("div")?.firstElementChild?.textContent ?? null,
        depositText: depositBtn()?.textContent ?? null,
        depositDisabled: depositBtn()?.disabled,
        takeText: withdrawBtn()?.textContent ?? null,
      };
      depositBtn()?.click();
      await new Promise((resolve) => setTimeout(resolve, 40));

      const offTile = { q: hero.q, r: hero.r };
      hero.q = offTile.q + 6;
      await settle();
      const awayControls = at().length;
      hero.q = offTile.q;
      // A full hold cannot take anything: the take direction needs room first.
      hero.resources = { wood: 0 };
      await settle();
      withdrawBtn()?.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { calls, home, awayControls };
    });

    assert.equal(facts.home.controls, 2, "the modal offers both cargo directions");
    assert.match(facts.home.label ?? "", /^Cargo at /, "and names the settlement it moves cargo into");
    assert.equal(facts.home.depositText, "Deposit cargo");
    assert.equal(facts.home.depositDisabled, false);
    assert.equal(facts.home.takeText, "Take cargo");
    assert.deepEqual(facts.calls[0], {
      heroId: facts.calls[0].heroId,
      settlementId: facts.calls[0].settlementId,
      direction: "load",
      amounts: { wood: 250 },
    }, "the deposit reaches the declared action as the engine's 'load'");
    assert.equal(facts.awayControls, 0, "a hero off its own settlement gets no cargo controls");
    assert.deepEqual(facts.calls[1], {
      heroId: facts.calls[0].heroId,
      settlementId: facts.calls[0].settlementId,
      direction: "unload",
      amounts: { wood: 120 },
    }, "and the take reaches it as 'unload'");
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
});

// ── Stepper controls must not stay pressable when the engine can only refuse ──
//
// The house rule these pin: a control's STATE and its WORDS must both be true.
// The per-row Accept / Accept all pair already disables through setUnavailable
// with the panel's own refusal sentence; the ±1 steppers did not, so each stayed
// enabled in a case the engine answers with a refusal:
//   (a) the route row's +1 with an empty unassigned-wagon pool
//       -> engine: not_enough_wagons_unassigned (updateTradeRoute clamps the
//          positive delta to the pool)
//   (b) the route row's −1 on a one-wagon route
//       -> engine: route_needs_a_wagon (a route always keeps at least one wagon)
//   (c) the hero block's −1 for a slot the hero holds nothing in
//       -> engine: not_enough_wagons (assignWagons clamps a negative delta at 0)
//
// Each test drives the REAL module against the REAL engine reducers, wired the
// way UIManager.openLogisticsModal wires them, so the control's state and the
// engine's answer to the very same click are measured together.

interface StepperScene {
  /** Player 0's unassigned cargo-wagon pool. */
  pool: number;
  /** Player 0's unassigned treasury-cart pool. */
  cartPool: number;
  /** The single trade route's wagon count. */
  routeWagons: number;
  /** The selected hero's assigned cargo wagons. */
  heroWagons: number;
  /** The selected hero's assigned treasury carts. */
  heroCarts: number;
}

interface StepperRecord {
  control: string;
  ok: boolean;
  reason: string;
}

interface StepperWindow {
  __stepper: {
    answers: StepperRecord[];
    state: {
      players: Array<{ wagonsUnassigned: number; treasuryWagonsUnassigned: number }>;
      heroes: Record<string, { wagons: number; treasuryWagons: number }>;
      tradeRoutes: Array<{ wagons: number }>;
    };
  };
}

async function withStepperScene(
  scene: StepperScene,
  body: (page: Page) => Promise<void>,
): Promise<void> {
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
    await page.route("**/logistics-stepper-fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"></body></html>',
    }));
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}logistics-stepper-fixture`);
    await page.evaluate(async (spec) => {
      const modalPath = "/src/screens/logistics/logisticsModal.ts";
      const enginePath = "/packages/engine/src/index.ts";
      const { openLogisticsModal } = await import(modalPath) as typeof import("../../../src/screens/logistics/logisticsModal");
      const engine = await import(enginePath) as typeof import("../../../packages/engine/src/index");
      const state = engine.createInitialState();
      const hero = Object.values(state.heroes).find((h) => h.ownerId === 0);
      const settlement = Object.values(state.settlements).find((s) => s.ownerId === 0);
      if (!hero || !settlement) throw new Error("fixture: seat 0 needs a hero and a settlement");
      hero.wagons = spec.heroWagons;
      hero.treasuryWagons = spec.heroCarts;
      hero.name = "Stepper Hero";
      state.selectedHeroId = hero.id;
      const player = state.players.find((p) => p.id === 0)!;
      player.wagonsOwned = 4;
      player.wagonsUnassigned = spec.pool;
      player.treasuryWagonsOwned = 4;
      player.treasuryWagonsUnassigned = spec.cartPool;
      state.players = [player];
      state.tradeRoutes = [{
        id: "r1",
        ownerId: 0,
        from: { kind: "hero", id: hero.id },
        to: { kind: "settlement", id: settlement.id },
        payload: { kind: "resource", resource: "wood" },
        wagons: spec.routeWagons,
        caravan: null,
      }];
      const holder = { state };
      // Every action the modal can raise, recorded: the engine's own reducer is
      // the answer of record, wired exactly as UIManager wires it.
      const answers: StepperRecord[] = [];
      (window as unknown as Record<string, unknown>).__stepper = { answers, state };
      openLogisticsModal({
        parent: document.body,
        getState: () => holder.state,
        actions: {
          transferResources: () => ({ ok: true, reason: "" }),
          assignWagons: (heroId, delta, slot) => {
            const result = engine.assignWagons(holder.state, 0, heroId, delta, slot);
            if (result.ok) holder.state = result.state;
            answers.push({
              control: `hero-wagon-${slot ?? "cargo"}-${delta > 0 ? "plus" : "minus"}`,
              ok: result.ok,
              reason: result.reason,
            });
            return result;
          },
          buyWagons: () => ({ ok: true, reason: "" }),
          createTradeRoute: () => ({ ok: true, reason: "" }),
          updateTradeRoute: (routeId, change) => {
            const result = engine.updateTradeRoute(holder.state, 0, routeId, change);
            if (result.ok) holder.state = result.state;
            answers.push({
              control: `route-${routeId}-${(change.wagonsDelta ?? 0) > 0 ? "plus" : "minus"}`,
              ok: result.ok,
              reason: result.reason,
            });
            return result;
          },
        },
      });
    }, scene);
    await body(page);
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
}

/**
 * A control's state plus the engine's answer to a real activation: a disabled
 * button fires no handler, so "asked" false IS the disabled control doing nothing.
 */
async function stepperProbe(page: Page, focus: string): Promise<{ disabled: boolean; title: string | null; asked: boolean }> {
  const control = page.locator(`[data-focus="${focus}"]`);
  const count = (): Promise<number> =>
    page.evaluate(() => (window as unknown as StepperWindow).__stepper.answers.length);
  const before = await count();
  await control.evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(60);
  return {
    disabled: await control.isDisabled(),
    title: await control.getAttribute("title"),
    asked: (await count()) > before,
  };
}

async function stepperAnswers(page: Page): Promise<StepperRecord[]> {
  return page.evaluate(() => (window as unknown as StepperWindow).__stepper.answers);
}

/** Re-render the modal against a poked scene, the way a state commit does. */
async function stepperCommit(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const busPath = "/src/core/eventBus.ts";
    const { bus } = await import(busPath) as typeof import("../../../src/core/eventBus");
    bus.emit({ type: "state:committed" });
  });
  await page.waitForTimeout(80);
}

test("the route row's +1 is disabled, with the panel's own sentence, when the wagon pool is empty", { timeout: 90_000 }, async () => {
  await withStepperScene(
    { pool: 0, cartPool: 0, routeWagons: 1, heroWagons: 2, heroCarts: 2 },
    async (page) => {
      const probe = await stepperProbe(page, "route-r1-plus");
      assert.equal(
        probe.disabled,
        true,
        "intended: the route row's +1 is off when no wagon can be assigned (the engine answers not_enough_wagons_unassigned to the same click)",
      );
      assert.equal(probe.title, "no unassigned wagons — buy one below");
      assert.equal(probe.asked, false, "a disabled control must not reach the action at all");
      assert.deepEqual(await stepperAnswers(page), []);

      // Not unconditionally dead: one unassigned wagon makes it live again, and
      // the refusal retires with the reason it named.
      await page.evaluate(() => {
        (window as unknown as StepperWindow).__stepper.state.players[0].wagonsUnassigned = 1;
      });
      await stepperCommit(page);
      const plus = page.locator('[data-focus="route-r1-plus"]');
      assert.equal(await plus.isDisabled(), false);
      assert.equal(await plus.getAttribute("title"), null);
      const live = await stepperProbe(page, "route-r1-plus");
      assert.equal(live.asked, true, "with a wagon in the pool the same control reaches the action");
    },
  );
});

test("the route row's −1 is disabled, with the panel's own sentence, on a one-wagon route", { timeout: 90_000 }, async () => {
  await withStepperScene(
    { pool: 2, cartPool: 2, routeWagons: 1, heroWagons: 2, heroCarts: 2 },
    async (page) => {
      const probe = await stepperProbe(page, "route-r1-minus");
      assert.equal(
        probe.disabled,
        true,
        "intended: a one-wagon route's −1 is off (the engine answers route_needs_a_wagon to the same click)",
      );
      assert.equal(probe.title, "a route always keeps at least one wagon");
      assert.equal(probe.asked, false, "a disabled control must not reach the action at all");
      assert.deepEqual(await stepperAnswers(page), []);

      // Not unconditionally dead: a two-wagon route can give one back.
      await page.evaluate(() => {
        (window as unknown as StepperWindow).__stepper.state.tradeRoutes[0].wagons = 2;
      });
      await stepperCommit(page);
      const minus = page.locator('[data-focus="route-r1-minus"]');
      assert.equal(await minus.isDisabled(), false);
      assert.equal(await minus.getAttribute("title"), null);
      const live = await stepperProbe(page, "route-r1-minus");
      assert.equal(live.asked, true, "a two-wagon route's −1 reaches the action");
    },
  );
});

test("the hero block's −1 is disabled, with the panel's own sentence, for a slot the hero holds nothing in", { timeout: 90_000 }, async () => {
  await withStepperScene(
    { pool: 1, cartPool: 1, routeWagons: 1, heroWagons: 0, heroCarts: 0 },
    async (page) => {
      // Each slot carries its own ±1 against its own pool; an empty slot is the
      // impossible action for that row's −1.
      for (const slot of ["cargo", "treasury"] as const) {
        const probe = await stepperProbe(page, `hero-wagon-${slot}-minus`);
        assert.equal(
          probe.disabled,
          true,
          `intended: the hero's ${slot} −1 is off at zero assigned ${slot === "cargo" ? "wagons" : "carts"} (the engine answers not_enough_wagons to the same click)`,
        );
        assert.equal(probe.title, "the hero has no wagons of that slot to give back");
        assert.equal(probe.asked, false, "a disabled control must not reach the action at all");
        // Its sibling +1 is not dead: the pool holds one, so it stays live.
        assert.equal(await page.locator(`[data-focus="hero-wagon-${slot}-plus"]`).isDisabled(), false);
      }
      assert.deepEqual(await stepperAnswers(page), []);

      // Not unconditionally dead: give the hero two cargo wagons and the −1
      // becomes the legal give-back, while the still-empty cart slot stays off.
      await page.evaluate(() => {
        const state = (window as unknown as StepperWindow).__stepper.state;
        for (const hero of Object.values(state.heroes)) hero.wagons = 2;
      });
      await stepperCommit(page);
      const cargoMinus = page.locator('[data-focus="hero-wagon-cargo-minus"]');
      assert.equal(await cargoMinus.isDisabled(), false);
      assert.equal(await cargoMinus.getAttribute("title"), null);
      assert.equal(await page.locator('[data-focus="hero-wagon-treasury-minus"]').isDisabled(), true);
      const live = await stepperProbe(page, "hero-wagon-cargo-minus");
      assert.equal(live.asked, true, "a hero holding wagons can give one back");
    },
  );
});
