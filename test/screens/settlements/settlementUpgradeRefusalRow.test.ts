import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// The settlement panel's own tier-upgrade refusal line, in a real DOM.
//
// F-3 of the round-2 city-view card: the line named WHICH resource was missing
// and never how much. At `stone 13` against an L2 cost of 30 it read exactly
// `Needs: Stone`, while the gold and population entries beside it carried
// `have/need` (`Needs: Pop 500/1275, Gold 10915/15000, Iron, Arcane`), so the
// control withheld the number it was asking for -- and the warehouse rows it
// was asking about sat directly above it.
//
// Every entry now carries its amounts in the same shape, so the line is a plan
// rather than a list of nouns.

test("the settlement tier-upgrade refusal line carries an amount for every resource it is missing", { timeout: 90_000 }, async () => {
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
    await page.route("**/upgrade-refusal-fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"></body></html>',
    }));
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}upgrade-refusal-fixture`);

    const facts = await page.evaluate(async () => {
      // The specifiers are variables deliberately: the page resolves them as
      // URLs against this dev server, and a literal `/src/...` path is a
      // module the test tree's tsc cannot resolve (the pattern
      // test/districts.e2e.ts and test/visualRegression.test.ts already use).
      const menuPath = "/src/screens/settlements/settlementInfoMenu.ts";
      const enginePath = "/packages/engine/src/index.ts";
      const { SettlementInfoMenu } = (await import(/* @vite-ignore */ menuPath)) as typeof import("../../../src/screens/settlements/settlementInfoMenu");
      const engine = (await import(/* @vite-ignore */ enginePath)) as typeof import("../../../packages/engine/src/index");

      const state = engine.createInitialState();
      const settlement = Object.values(state.settlements)[0];
      settlement.ownerId = state.activePlayerId;
      settlement.level = 1;
      settlement.population = 1_000;
      // A town hall one level ahead and the population gate met, so the only
      // entries the line can carry are the resources themselves (the L1 -> L2
      // upgrade prices 5000g / 40 wood / 30 stone / 20 iron).
      settlement.buildings = [{ gx: 0, gy: 0, kind: "townHall", level: 2, w: 2, h: 2 }];
      settlement.citySpots = [];
      settlement.districts = {};
      settlement.gold = 0;
      settlement.warehouse = { wood: 5, stone: 13, iron: 7, arcane: 0, food: 0 };

      let upgrades = 0;
      const menu = new SettlementInfoMenu({
        parent: document.body,
        onUpgradeSettlement: () => { upgrades += 1; },
      });
      menu.show(settlement, state);

      const upgradeBtn = () =>
        Array.from(document.querySelectorAll("button")).find((b) => /^Upgrade to L/.test(b.textContent?.trim() ?? "")) as HTMLButtonElement | undefined;
      const line = () =>
        Array.from(document.querySelectorAll("div,span"))
          .map((el) => (el.textContent ?? "").trim())
          .find((t) => /^Needs:/.test(t) && t.length < 200) ?? null;

      const first = { line: line(), title: upgradeBtn()?.title ?? null, disabled: upgradeBtn()?.disabled ?? null };

      // The gate is also read with the town hall a level behind, so the
      // town-hall entry (which always carried numbers) is exercised with the
      // resource entries beside it.
      settlement.buildings = [{ gx: 0, gy: 0, kind: "townHall", level: 1, w: 2, h: 2 }];
      menu.update(settlement, state);
      const withTownHallGate = line();

      // And with everything covered but the gold, the line must not invent a
      // resource shortfall.
      settlement.buildings = [{ gx: 0, gy: 0, kind: "townHall", level: 2, w: 2, h: 2 }];
      settlement.warehouse = { wood: 40, stone: 30, iron: 20, arcane: 0, food: 0 };
      menu.update(settlement, state);
      const goldOnly = { line: line(), title: upgradeBtn()?.title ?? null };

      return { first, withTownHallGate, goldOnly, upgrades };
    });

    assert.equal(
      facts.first.line,
      "Needs: Gold 0/5000, Wood 5/40, Stone 13/30, Iron 7/20",
      "each missing resource is named with the amount held and the amount needed, like the gold and population entries beside it",
    );
    assert.equal(facts.first.title, facts.first.line, "the control's tooltip carries the same sentence as the line");
    assert.equal(facts.first.disabled, true, "the control is dead while the requirements are unmet");

    assert.equal(
      facts.withTownHallGate,
      "Needs: TH L2, Gold 0/5000, Wood 5/40, Stone 13/30, Iron 7/20",
      "the town-hall gate and the resource amounts share one vocabulary on one line",
    );
    assert.equal(facts.goldOnly.line, "Needs: Gold 0/5000", "a resource that is covered is not listed");
    assert.equal(facts.goldOnly.title, "Needs: Gold 0/5000", "and the tooltip agrees");
    assert.equal(facts.upgrades, 0, "nothing was spent: the control is refused, not clicked");
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
});
