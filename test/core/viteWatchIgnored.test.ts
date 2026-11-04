// The dev server must not WATCH this box's worktree fleet.
//
// The primary checkout is the one directory that holds ~130 sibling worktrees
// (`git worktree list` -> `.worktrees/`, plus `.kilo/worktrees/`), each a full
// tree. Vite watches the whole root and holds a document request until that
// initial crawl settles, so on the primary the first `GET /index.html` took
// 135252ms and every browser suite died on
// `page.goto: Timeout 30000ms exceeded` at the very commit that passed from a
// worktree (2370ms for the same request); adding `**/.worktrees/**` alone took
// the primary to 5494ms and the full list to 1338ms.
//
// The config is loaded HERE the way vite loads it (loadConfigFromFile, which is
// the same bundling + loading path the dev server itself uses), so this pins
// what vite will really do rather than a copy of the source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Every directory the primary checkout's root carries that the dev server has
// no business walking: build output, scratch, agent state, and the fleet.
const MUST_IGNORE = [
  "**/.worktrees/**",
  "**/.kilo/**",
  "**/.agentboard/**",
  "**/local/**",
  "**/dist/**",
  "**/analysis/**",
  "**/design/**",
  "**/reviews/**",
  "**/sessionTracking/**",
];

// Paths the app IS served from. If a watcher ignore ever swallows one of these,
// HMR silently stops for it -- the opposite failure, and just as invisible.
const MUST_STAY_WATCHED = [
  "src/main.ts",
  "src/screens/home/homeView.ts",
  "packages/engine/src/index.ts",
  "packages/contracts/src/index.ts",
  "server/index.ts",
  "index.html",
  "vite.config.ts",
  ".env",
];

// Minimal glob -> RegExp for the shapes this list uses. (Keep glob literals out
// of a block comment: the two characters that close one are inside every glob.)
// One pass on purpose: translating `**/` to `(?:.*/)?` and THEN `*` to `[^/]*`
// rewrites the `*` the first replacement just inserted, and a matcher that only
// looks right is worse than none.
function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/|\/\*\*|\*/g, (m) => (m === "**/" ? "(?:.*/)?" : m === "/**" ? "(?:/.*)?" : "[^/]*"));
  return new RegExp(`^${pattern}$`);
}

async function loadWatchIgnored(): Promise<string[]> {
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, path.join(ROOT, "vite.config.ts"), ROOT);
  assert.ok(loaded, "vite.config.ts must load");
  const ignored = (loaded.config.server as { watch?: { ignored?: unknown } } | undefined)?.watch?.ignored;
  assert.ok(Array.isArray(ignored), "vite.config.ts must set server.watch.ignored to an array of globs");
  return ignored as string[];
}

test("the dev server is told not to watch the worktree fleet or the scratch trees", async () => {
  const ignored = await loadWatchIgnored();
  for (const glob of MUST_IGNORE) {
    assert.ok(
      ignored.includes(glob),
      `vite.config.ts's server.watch.ignored is missing ${glob}. Without it the dev server walks the ` +
        `primary checkout's ~130 sibling worktrees on every boot and holds the first document request for ` +
        `minutes, which is what made every browser suite die on page.goto: Timeout 30000ms exceeded there.`,
    );
  }
});

test("vite's own defaults are RESTATED, not dropped (declaring this key replaces them)", async () => {
  const ignored = await loadWatchIgnored();
  for (const glob of ["**/.git/**", "**/node_modules/**"]) {
    assert.ok(
      ignored.includes(glob),
      `server.watch.ignored must restate vite's default ${glob}: setting this key replaces the defaults ` +
        `rather than adding to them, so omitting it would start watching .git (the 179MB art history) ` +
        `and node_modules.`,
    );
  }
});

test("nothing the app is served from is unwatched", async () => {
  const ignored = (await loadWatchIgnored()).map(globToRegExp);
  for (const servedPath of MUST_STAY_WATCHED) {
    const swallowed = ignored.filter((re) => re.test(servedPath));
    assert.deepEqual(
      swallowed.map(String),
      [],
      `${servedPath} is served to the browser but an ignore glob matches it, so HMR would stop for it`,
    );
  }
});

test("the matcher the assertion above uses genuinely bites", () => {
  const worktreeFile = globToRegExp("**/.worktrees/**");
  const nodeModulesFile = globToRegExp("**/node_modules/**");
  assert.ok(worktreeFile.test(".worktrees/make-the-primary-checkou-ff7804/src/main.ts"));
  assert.ok(worktreeFile.test("nested/.worktrees/x/package.json"));
  assert.ok(nodeModulesFile.test("node_modules/vite/index.js"));
  assert.ok(!worktreeFile.test("src/main.ts"), "the fleet glob must not cover the app's own sources");
});
