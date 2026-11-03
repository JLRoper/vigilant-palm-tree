import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// The settlement panel's Warehouse section, in a real DOM: the cargo row is the
// door playthrough finding F-2 was missing (map-picked cargo had no UI path into
// a settlement). What each button sends is pinned here through the panel's own
// callback; what that request does to the engine is pinned by
// test/screens/shared/cargoTransfer.test.ts.

test("the settlement panel's warehouse offers the hero cargo both ways", { timeout: 90_000 }, async () => {
  const server = await createServer({
    root,
    server: { host: "127.0.0.1", port: 0, open: false },
    logLevel: "error",
  });
  await server.listen();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.route("**/cargo-panel-fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"></body></html>',
    }));
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}cargo-panel-fixture`);

    const facts = await page.evaluate(async () => {
      const { SettlementInfoMenu } = await import("/src/screens/settlements/settlementInfoMenu.ts") as typeof import("../../../src/screens/settlements/settlementInfoMenu");
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
      // The playthrough's own shape: five wagons, so 250 fills the hold.
      hero.resources = { wood: 250 };
      state.selectedHeroId = hero.id;

      const calls: Array<{ heroId: string; settlementId: string; direction: string; amounts: Record<string, number> }> = [];
      const standing: unknown[] = [hero];
      const menu = new SettlementInfoMenu({
        parent: document.body,
        getHeroesAtSettlement: () => standing as never,
        onTransferCargo: (heroId, settlementId, direction, amounts) => {
          calls.push({ heroId, settlementId, direction, amounts: amounts as Record<string, number> });
          return { ok: true, reason: "" };
        },
      });
      menu.show(settlement, state);

      const row = () => document.querySelector('[data-cargo-transfer="deposit"]')?.closest("div")?.parentElement as HTMLElement | null;
      const depositBtn = () => document.querySelector('[data-cargo-transfer="deposit"]') as HTMLButtonElement | null;
      const withdrawBtn = () => document.querySelector('[data-cargo-transfer="withdraw"]') as HTMLButtonElement | null;
      const snap = (btn: () => HTMLButtonElement | null) => ({
        text: btn()?.textContent ?? null,
        disabled: btn()?.disabled,
        title: btn()?.getAttribute("title") ?? null,
      });

      const fullWagons = {
        stock: document.querySelector('[data-warehouse-stock="wood"]')?.textContent ?? null,
        rowVisible: row()?.style.display ?? null,
        label: row()?.firstElementChild?.textContent ?? null,
        deposit: snap(depositBtn),
        withdraw: snap(withdrawBtn),
      };
      depositBtn()?.click();
      // A dead button clicks to nothing (the DOM refuses to dispatch on it).
      withdrawBtn()?.click();
      const callsAfterFullWagons = calls.length;

      // Empty the wagons: the take direction becomes the live one.
      hero.resources = { wood: 0 };
      menu.update(settlement, state);
      const emptyWagons = { deposit: snap(depositBtn), withdraw: snap(withdrawBtn) };
      withdrawBtn()?.click();

      // No hero on the tile: no cargo row at all.
      standing.length = 0;
      menu.update(settlement, state);
      const withoutHero = row()?.style.display ?? null;

      standing.push(hero);
      const cap = engine.settlementResourceCap(settlement).wood;
      hero.resources = { wood: 250 };
      settlement.warehouse = { wood: cap, stone: 0, iron: 0, arcane: 0, food: 0 };
      menu.update(settlement, state);
      const fullWarehouse = { deposit: snap(depositBtn), withdraw: snap(withdrawBtn) };

      hero.resources = { wood: 0 };
      settlement.warehouse = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
      menu.update(settlement, state);
      const emptyEverything = { deposit: snap(depositBtn), withdraw: snap(withdrawBtn) };

      return { calls, callsAfterFullWagons, fullWagons, emptyWagons, withoutHero, fullWarehouse, emptyEverything };
    });

    assert.equal(facts.fullWagons.stock, "120", "the warehouse row is addressable per resource");
    assert.equal(facts.fullWagons.rowVisible, "flex", "the row shows while a same-seat hero stands on the tile");
    assert.equal(facts.fullWagons.label, "Scout — hero cargo");
    assert.equal(facts.fullWagons.deposit.text, "Deposit cargo");
    assert.equal(facts.fullWagons.deposit.disabled, false);
    assert.equal(facts.fullWagons.deposit.title, "Move 250 of the hero's cargo into the warehouse");
    assert.equal(facts.fullWagons.withdraw.text, "Take cargo");
    assert.equal(facts.fullWagons.withdraw.disabled, true, "a full hold cannot take anything");
    assert.equal(facts.fullWagons.withdraw.title, "The hero's wagons are full");

    assert.deepEqual(facts.calls[0], {
      heroId: facts.calls[0].heroId,
      settlementId: facts.calls[0].settlementId,
      direction: "load",
      amounts: { wood: 250 },
    }, "the deposit asks the engine's 'load' (hero -> settlement) for the whole cargo");
    assert.equal(facts.callsAfterFullWagons, 1, "the dead take button sends nothing");

    assert.equal(facts.emptyWagons.deposit.disabled, true);
    assert.equal(facts.emptyWagons.deposit.title, "The hero's wagons are empty");
    assert.equal(facts.emptyWagons.withdraw.disabled, false);
    assert.equal(facts.emptyWagons.withdraw.title, "Take 120 out of the warehouse into the hero's cargo");
    assert.deepEqual(facts.calls[1], {
      heroId: facts.calls[0].heroId,
      settlementId: facts.calls[0].settlementId,
      direction: "unload",
      amounts: { wood: 120 },
    }, "the take asks the engine's 'unload' (settlement -> hero) for the warehouse's stock");

    assert.equal(facts.withoutHero, "none", "no hero on the tile, no cargo row");
    assert.equal(facts.fullWarehouse.deposit.disabled, true, "a full warehouse offers no deposit");
    assert.equal(facts.fullWarehouse.deposit.title, "The warehouse is full");
    assert.equal(facts.fullWarehouse.withdraw.disabled, true, "and a full hold takes nothing out");
    assert.equal(facts.emptyEverything.deposit.disabled, true);
    assert.equal(facts.emptyEverything.deposit.title, "The hero's wagons are empty");
    assert.equal(facts.emptyEverything.withdraw.disabled, true);
    assert.equal(facts.emptyEverything.withdraw.title, "The warehouse is empty");
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
});
