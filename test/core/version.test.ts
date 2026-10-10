import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_VERSION,
  BUILD_COMMIT,
  BUILD_TIME,
  formatBuildTime,
  getBuildInfo,
} from "../../src/core/version";

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
