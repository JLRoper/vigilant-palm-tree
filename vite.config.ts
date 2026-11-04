import { defineConfig, loadEnv } from "vite";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
    return pkg.version ?? "0.3.0";
  } catch {
    return "0.3.0";
  }
}

function getCommitHash(): string {
  if (process.env.VITE_COMMIT_HASH) return process.env.VITE_COMMIT_HASH;
  try {
    // execFileSync, not execSync: vite.config.ts is loaded by every dev run
    // and every test's web server, and `exec` would route it through cmd.exe,
    // which allocates a console window when it does not inherit one.
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "dev";
  }
}

/**
 * Directories under the checkout root that the dev server must NOT watch.
 *
 * The dev server watches the whole root, and vite holds the first document
 * request until that initial crawl settles. The PRIMARY checkout is the one
 * directory on this box that contains ~130 sibling worktrees
 * (`git worktree list` -> `.worktrees/`, plus `.kilo/worktrees/`), each a full
 * tree with its own heavy art and scratch dirs, so the walk takes minutes
 * instead of milliseconds: measured on the primary, the first
 * `GET /index.html` took 135252ms with the defaults alone and 5494ms with only
 * the worktrees entry added, so every browser suite died on
 * `page.goto: Timeout 30000ms exceeded` at the very commit that passed from a
 * worktree (2370ms for the same request). These are all build output, scratch
 * or agent state -- nothing the app imports and nothing HMR needs to see.
 *
 * `.git` and `node_modules` are vite's own defaults, RESTATED on purpose:
 * declaring this key replaces them rather than adding to them.
 */
const WATCH_IGNORED = [
  "**/.git/**",
  "**/node_modules/**",
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiHost = process.env.API_HOST ?? "127.0.0.1";
  const apiPort = env.API_PORT ?? process.env.API_PORT ?? "3001";
  const appVersion = getAppVersion();
  const commitHash = getCommitHash();
  const buildTime = new Date().toISOString();

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __BUILD_TIME__: JSON.stringify(buildTime),
      __BUILD_COMMIT__: JSON.stringify(commitHash),
    },
    resolve: {
      alias: {
        "@heroes/contracts": path.resolve(__dirname, "packages/contracts/src/index.ts"),
        "@heroes/engine": path.resolve(__dirname, "packages/engine/src/index.ts"),
        "@screens": path.resolve(__dirname, "src/screens"),
      },
    },
    build: {
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, "/");
            if (normalized.includes("/packages/engine/") || normalized.includes("/packages/contracts/")) {
              return "engine";
            }
          },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: Number(env.CLIENT_PORT ?? 5173),
      // A document request is held until the initial crawl settles, so a root
      // this box's worktree fleet has filled changes from milliseconds to
      // minutes. See WATCH_IGNORED.
      watch: { ignored: WATCH_IGNORED },
      proxy: {
        "/api": {
          target: `http://${apiHost}:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: Number(env.CLIENT_PORT ?? 5173),
      proxy: {
        "/api": {
          target: `http://${apiHost}:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
