import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  
  return {
    build: {
      assetsInlineLimit: 0,
    },
    server: {
      host: "0.0.0.0",
      port: Number(env.CLIENT_PORT ?? 5173),
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${env.API_PORT ?? 3001}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: Number(env.CLIENT_PORT ?? 5173),
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${env.API_PORT ?? 3001}`,
          changeOrigin: true,
        },
      },
    },
  };
});
