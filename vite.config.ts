import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiHost = process.env.API_HOST ?? "127.0.0.1";
  const apiPort = env.API_PORT ?? process.env.API_PORT ?? "3001";

  return {
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
