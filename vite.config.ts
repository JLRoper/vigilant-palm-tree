import { defineConfig, loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiHost = process.env.API_HOST ?? "127.0.0.1";
  const apiPort = env.API_PORT ?? process.env.API_PORT ?? "3001";
  // __dirname isn't reliably defined in Vite's ESM config context; resolve
  // from the project root the same way loadEnv() does above instead.
  const root = process.cwd();

  return {
    resolve: {
      alias: {
        "@heroes/contracts": path.resolve(root, "packages/contracts/src/index.ts"),
        "@heroes/engine": path.resolve(root, "packages/engine/src/index.ts"),
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
