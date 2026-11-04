import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// The manual arena's own chrome for a REAL hero battle, in a real browser.
//
// openManualBattleArena documents the rule ("Defaults to the Test Battle
// sandbox's [title] ...; the production settlement-battle flow passes
// 'Assault on <Settlement name>' so a real fight is never titled like the dev
// sandbox") and the settlement path passes one. The hero-vs-hero path passed
// nothing, so every real hero battle was titled and railed like the dev
// sandbox -- playthrough round 4, F5, re-measured on 0.53.10 by mounting the
// arena the way that path does: top bar "Test Battle — Manual Fight" with the
// side chip "You: Red".

const SANDBOX_TITLE = "Test Battle — Manual Fight";

type Mode = "produced" | "forgot" | "sandbox";

interface Mounted {
  title: string;
  body: string;
  chrome: { title: string; attackerLabel: string; defenderLabel: string } | null;
}

// One vite + one browser per call; each call mounts the arena in a blank
// fixture page (the arena appends its own full-viewport overlay to body, so
// the page's first element child IS that overlay and its first child is the
// top band).
async function mountArena(mode: Mode): Promise<{ mounted: Mounted; sandboxExpected: string; pageErrors: string[] }> {
  const server = await createServer({
    root,
    server: { host: "127.0.0.1", port: 0, open: false },
    logLevel: "error",
  });
  await server.listen();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.route("**/arena-title-fixture", (route) =>
      route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body style="margin:0"></body></html>' }),
    );
    await page.addInitScript("window.__name = (fn) => fn");
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(`${server.resolvedUrls!.local[0]}arena-title-fixture`);

    const mounted = await page.evaluate(async (which: Mode) => {
      // Runtime paths, not static specifiers: these imports are resolved by the
      // BROWSER against the vite dev server (this callback is serialized and run
      // in the page), and a literal "/src/..." specifier is not something the
      // node-side typechecker can resolve.
      const arenaPath = "/src/screens/combat/arena/openManualBattleArena.ts";
      const chromePath = "/src/screens/combat/arena/heroBattleChrome.ts";
      const arenaMod = (await import(arenaPath)) as unknown as {
        openManualBattleArena: (
          player: unknown[],
          ai: unknown[],
          unitTypes: Record<string, unknown>,
          humanSide: "attacker" | "defender",
          options?: Record<string, unknown>,
        ) => { close: () => void };
      };
      const unitTypes: Record<string, unknown> = {
        footman: {
          id: "footman", name: "Footman", attack: 5, defence: 5, health: 20, speed: 3,
          description: "", advantageType: "infantry", specialty: "shield", specialtyPriority: 0,
        },
      };
      const player = [{ entries: [{ unitTypeId: "footman", count: 5 }] }];
      const ai = [{ entries: [{ unitTypeId: "footman", count: 4 }] }];

      function titleText(): string {
        const overlay = document.body.firstElementChild as HTMLElement | null;
        const topBar = overlay?.firstElementChild as HTMLElement | null;
        return topBar?.firstElementChild?.textContent?.trim() ?? "<no top bar>";
      }

      // The attacker is the mover and the local seat is the defender -- the
      // exact shape the report measured ("You: Red"). Two real heroes, named
      // the way the battle flow names them.
      const chrome =
        which !== "produced"
          ? null
          : (
              (await import(chromePath)) as unknown as {
                heroBattleArenaChrome: (
                  attacker: { id: string; name?: string },
                  defender: { id: string; name?: string },
                ) => { title: string; attackerLabel: string; defenderLabel: string };
              }
            ).heroBattleArenaChrome(
              { id: "p1-hero", name: "Alaric Ironheart" },
              { id: "p0-hero", name: "Lyra Stormwind" },
            );
      const options: Record<string, unknown> =
        which === "sandbox"
          ? {}
          : which === "forgot"
            ? { onComplete: () => {} }
            : { onComplete: () => {}, ...(chrome ?? {}) };

      const handle = arenaMod.openManualBattleArena(player, ai, unitTypes, "defender", options);
      const out = { title: titleText(), body: document.body.innerText, chrome };
      handle.close();
      return out;
    }, mode);

    return { mounted, sandboxExpected: SANDBOX_TITLE, pageErrors };
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
}

test("a production flow that omits the arena title is still never titled as the dev sandbox", { timeout: 120_000 }, async () => {
  const { mounted, sandboxExpected, pageErrors } = await mountArena("forgot");
  assert.deepEqual(pageErrors, [], "the mounted arena must not throw");
  assert.notEqual(
    mounted.title,
    sandboxExpected,
    `a real hero battle was titled like the dev sandbox: "${mounted.title}"`,
  );
  assert.ok(
    !mounted.title.includes("Test Battle") && !mounted.title.includes("Manual Fight"),
    `the dev sandbox's title must not reach a production flow, got "${mounted.title}"`,
  );
});

test("a real hero battle's arena names its two heroes, and the sandbox keeps its own title", { timeout: 120_000 }, async () => {
  const produced = await mountArena("produced");
  assert.deepEqual(produced.pageErrors, [], "the mounted arena must not throw");
  const chrome = produced.mounted.chrome;
  assert.ok(chrome, "the production chrome must be built for the battle's two heroes");
  assert.equal(
    produced.mounted.title,
    chrome!.title,
    `the arena top bar must carry the battle's own title, got "${produced.mounted.title}"`,
  );
  assert.ok(
    chrome!.title.includes("Alaric Ironheart") && chrome!.title.includes("Lyra Stormwind"),
    `the title must name both heroes, got "${chrome!.title}"`,
  );
  assert.ok(
    produced.mounted.body.includes(chrome!.defenderLabel),
    `the local defender's own rail must name its hero ("${chrome!.defenderLabel}"), body was ${JSON.stringify(
      produced.mounted.body.slice(0, 400),
    )}`,
  );

  const sandbox = await mountArena("sandbox");
  assert.deepEqual(sandbox.pageErrors, [], "the mounted sandbox arena must not throw");
  assert.equal(sandbox.mounted.title, sandbox.sandboxExpected, "the sandbox keeps its own title");
});
