export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.3.0-dev";

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "development";

export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ !== "undefined" ? __BUILD_COMMIT__ : "dev";

export function formatBuildTime(isoOrText: string): string {
  if (!isoOrText || isoOrText === "development" || isoOrText === "dev") {
    return isoOrText;
  }
  const date = new Date(isoOrText);
  if (isNaN(date.getTime())) {
    return isoOrText;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

export interface BuildInfo {
  version: string;
  commit: string;
  buildTime: string;
  formattedTime: string;
  summary: string;
}

export function getBuildInfo(): BuildInfo {
  const formattedTime = formatBuildTime(BUILD_TIME);
  return {
    version: APP_VERSION,
    commit: BUILD_COMMIT,
    buildTime: BUILD_TIME,
    formattedTime,
    summary: `v${APP_VERSION} (${BUILD_COMMIT}) · ${formattedTime}`,
  };
}
