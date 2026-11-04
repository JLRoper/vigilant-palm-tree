import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// The settlement panel's tier-upgrade control on a SHORT viewport.
//
// F-5 of the round-2 city-view card, measured at the harness default
// 1258x566: the `Upgrade to L2` button sat below the fold (rect top 865/881)
// and `document.elementFromPoint` at its centre returned the map CANVAS -- a
// real click there landed on the map. The panel's own body is an inner
// scroller (clientHeight well under its 800-odd px of content), so the control
// was reachable only by scrolling a body nobody is told to scroll.
//
// The row is this panel's progression control, so it is pinned outside the
// scrolling body -- a child of the panel ROOT, with the body shrunk to
// `1 1 auto`, the shape heroTradePanel's Confirm footer already uses. This spec
// pins the two things that make that real: the control is inside the viewport
// with the body scrolled to the top, and a hit test at its centre lands ON it.

/** The harness default the finding was measured at. */
const VIEWPORT = { width: 1258, height: 566 };

test("the settlement tier-upgrade control is on screen at 1258x566, not below the panel's scroll", { timeout: 90_000 }, async () => {
  const server = await createServer({
    root,
    server: { host: "127.0.0.1", port: 0, open: false },
    logLevel: "error",
  });
  await server.listen();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.route("**/upgrade-pinned-fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"></body></html>',
    }));
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}upgrade-pinned-fixture`);

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
      settlement.buildings = [{ gx: 0, gy: 0, kind: "townHall", level: 2, w: 2, h: 2 }];
      settlement.citySpots = [];
      settlement.districts = {};
      settlement.gold = 0;
      settlement.warehouse = { wood: 5, stone: 13, iron: 7, arcane: 0, food: 0 };

      const menu = new SettlementInfoMenu({ parent: document.body, onUpgradeSettlement: () => {} });
      menu.show(settlement, state);

      const btn = Array.from(document.querySelectorAll("button"))
        .find((b) => /^Upgrade to L/.test(b.textContent?.trim() ?? "")) as HTMLButtonElement | undefined;
      const body = document.querySelector("[data-panel-body]") as HTMLElement | null;
      if (!btn || !body) return null;
      // The finding's own reading: the body at the top, then where the control
      // is and what a hit test at its centre lands on.
      body.scrollTop = 0;
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        Math.max(0, Math.min(window.innerHeight - 1, r.y + r.height / 2)),
      );
      return {
        viewportH: window.innerHeight,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        insideViewport: r.top >= 0 && r.bottom <= window.innerHeight,
        inScrollingBody: body.contains(btn),
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
        hit: hit ? `${hit.tagName}: ${(hit.textContent ?? "").trim().slice(0, 24)}` : null,
      };
    });

    assert.ok(facts, "the panel renders its tier-upgrade control");
    assert.equal(
      facts!.bodyScrolls,
      true,
      "the panel's body is still the scrolling surface on a short window -- the fixture is the finding's own shape",
    );
    assert.equal(
      facts!.insideViewport,
      true,
      `the control must be inside the ${VIEWPORT.height}px viewport (measured top ${facts!.top}, bottom ${facts!.bottom})`,
    );
    assert.equal(
      facts!.hit,
      "BUTTON: Upgrade to L2",
      "a hit test at the control's centre must land on it, not on the map canvas",
    );
    assert.equal(
      facts!.inScrollingBody,
      false,
      "a control the window is too short to scroll to belongs outside the panel's scrolling body",
    );
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
});
