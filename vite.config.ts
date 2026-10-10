import { defineConfig, loadEnv } from "vite";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

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
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

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
    },
    server: {
      host: "0.0.0.0",
      port: Number(env.CLIENT_PORT ?? 5173),
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
