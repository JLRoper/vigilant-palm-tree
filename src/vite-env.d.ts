/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_COMMIT__: string;

