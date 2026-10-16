import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APP_VERSION,
  BUILD_COMMIT,
  BUILD_TIME,
  formatBuildTime,
  getBuildInfo,
} from "../../src/core/version";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("version constants provide string defaults in node environment", () => {
  assert.equal(typeof APP_VERSION, "string");
  assert.equal(typeof BUILD_COMMIT, "string");
  assert.equal(typeof BUILD_TIME, "string");
  assert.ok(APP_VERSION.length > 0);
  assert.ok(BUILD_COMMIT.length > 0);
  assert.ok(BUILD_TIME.length > 0);
});

test("formatBuildTime formats ISO timestamps to UTC string", () => {
  assert.equal(
    formatBuildTime("2026-10-05T06:55:37.000Z"),
    "2026-10-05 06:55 UTC"
  );
  assert.equal(
    formatBuildTime("2026-01-01T00:00:00.000Z"),
    "2026-01-01 00:00 UTC"
  );
});

test("formatBuildTime handles non-date text and invalid inputs", () => {
  assert.equal(formatBuildTime("development"), "development");
  assert.equal(formatBuildTime("dev"), "dev");
  assert.equal(formatBuildTime("invalid-date-string"), "invalid-date-string");
  assert.equal(formatBuildTime(""), "");
});

test("getBuildInfo returns structured build info with summary", () => {
  const info = getBuildInfo();
  assert.equal(info.version, APP_VERSION);
  assert.equal(info.commit, BUILD_COMMIT);
  assert.equal(info.buildTime, BUILD_TIME);
  assert.equal(info.formattedTime, formatBuildTime(BUILD_TIME));
  assert.ok(info.summary.includes(APP_VERSION));
  assert.ok(info.summary.includes(BUILD_COMMIT));
});

// --- versioning guard rails -------------------------------------------------

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

test("the app version in the root package.json is valid semver", () => {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8"));
  assert.match(
    pkg.version,
    SEMVER,
    `package.json version "${pkg.version}" is not semver -- the settings panel displays it and releases tag off it`,
  );
});

test("vite.config.ts stamps the client build from that version", () => {
  // Guards the chain: package.json -> vite define -> core/version.ts -> the
  // settings panel's build-info footer. A refactor that drops the define, or
  // hard-codes the version in two places, fails here.
  const vite = readFileSync(`${ROOT}vite.config.ts`, "utf8");
  assert.match(vite, /getAppVersion/, "vite.config.ts must resolve the version from package.json");
  assert.match(vite, /pkg\.version/, "the version must come from package.json, not a literal");
  for (const name of ["__APP_VERSION__", "__BUILD_TIME__", "__BUILD_COMMIT__"]) {
    assert.ok(vite.includes(`${name}: JSON.stringify(`), `${name} must be injected as a define`);
  }
  const version = readFileSync(`${ROOT}src/core/version.ts`, "utf8");
  for (const name of ["__APP_VERSION__", "__BUILD_TIME__", "__BUILD_COMMIT__"]) {
    assert.ok(version.includes(name), `core/version.ts must consume ${name}`);
  }
});
