#!/usr/bin/env node
// Version bump routine for the app.
//
// The root package.json "version" is the single source of truth: vite.config.ts
// stamps it into the client as __APP_VERSION__ and the settings panel's build
// info footer displays it. There is no second copy to keep in sync -- the
// workspace packages (packages/*, 0.0.1) are private internals and are not the
// app version.
//
// Usage:
//   node scripts/bump-version.mjs <patch|minor|major|X.Y.Z> [-m "message"]
//                                  [--commit] [--tag] [--push]
//
//   patch|minor|major  semver bump of the current version
//   X.Y.Z             an explicit target version (must be strictly greater)
//   -m "..."          changelog body; default is a git-log summary since the
//                     previous version tag
//   --commit          stage package.json + CHANGELOG.md and commit them
//   --tag             create annotated tag v<version> (implies the version is
//                     committed; warns if the tree is dirty)
//   --push            push the branch and the tag to origin `github`
//   --dry-run         print the new version and changelog body, write nothing
//
// Nothing is pushed unless --push is given, and nothing is committed unless
// --commit is given, so a dry `node scripts/bump-version.mjs patch` only edits
// two files.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = path.join(ROOT, "package.json");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");
const REMOTE = "github";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

function fail(msg) {
  console.error(`bump-version: ${msg}`);
  process.exit(1);
}

function sh(cmd, args) {
  // No shell: on Windows `shell: true` concatenates the args unquoted, which
  // splits git's `--pretty=format:- %s (%h)` and silently kills the changelog
  // body. git.exe/docker.exe resolve through PATH without one.
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positionals = argv.filter((a) => !a.startsWith("--"));
const messageIdx = argv.indexOf("-m");
const message = messageIdx >= 0 ? argv[messageIdx + 1] : null;
if (messageIdx >= 0 && !message) fail("-m requires a value");

const target = positionals[0];
if (!target) {
  console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 22).join("\n"));
  process.exit(1);
}

// ---- current version -------------------------------------------------------
const pkgRaw = readFileSync(PKG_PATH, "utf8");
const pkg = JSON.parse(pkgRaw);
const currentMatch = SEMVER.exec(pkg.version ?? "");
if (!currentMatch) fail(`package.json version "${pkg.version}" is not semver`);

const nextMatch = SEMVER.exec(target);
let next = null;
if (nextMatch) {
  next = nextMatch.slice(1, 4).map(Number);
} else if (["patch", "minor", "major"].includes(target)) {
  const [maj, min, pat] = currentMatch.slice(1, 4).map(Number);
  next =
    target === "major" ? [maj + 1, 0, 0] : target === "minor" ? [maj, min + 1, 0] : [maj, min, pat + 1];
} else {
  fail(`unknown bump "${target}" (expected patch|minor|major or X.Y.Z)`);
}

const nextVersion = next.join(".");
if (compare(next, currentMatch.slice(1, 4).map(Number)) <= 0) {
  fail(`${nextVersion} is not greater than the current ${pkg.version}`);
}

const dryRun = flags.has("--dry-run");

// ---- edit package.json (preserve the file's formatting) --------------------
const versionLine = new RegExp(`("version"\\s*:\\s*")[^"]*(")`);
if (!versionLine.test(pkgRaw)) fail("could not find a version field to rewrite");
const pkgNext = pkgRaw.replace(versionLine, `$1${nextVersion}$2`);
if (pkgNext === pkgRaw) fail("version rewrite was a no-op");
console.log(`version: ${pkg.version} -> ${nextVersion}`);
if (!dryRun) writeFileSync(PKG_PATH, pkgNext);

// ---- changelog -------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);

function previousTag() {
  const t = sh("git", ["tag", "--list", "v*", "--sort=-v:refname"]);
  if (!t.ok) return null;
  for (const raw of t.out.split(/\r?\n/)) {
    const m = SEMVER.exec(raw.replace(/^v/, ""));
    if (m) return raw;
  }
  return null;
}

function logBody() {
  const prev = previousTag();
  const range = prev ? `${prev}..HEAD` : "HEAD";
  const log = sh("git", ["log", "--no-merges", "--pretty=format:- %s (%h)", range]);
  if (!log.ok || !log.out) return "(no commit history found)";
  const lines = log.out.split(/\r?\n/);
  const MAX = 60;
  const body = lines.slice(0, MAX).join("\n");
  return lines.length > MAX ? `${body}\n- …and ${lines.length - MAX} more commits` : body;
}

const body = message ?? logBody();
const entry = `## [${nextVersion}] - ${today}\n\n${body}\n`;

if (dryRun) {
  console.log(`--- dry run: nothing written ---`);
  console.log(entry);
  console.log(`would write: package.json (version ${nextVersion}), CHANGELOG.md`);
  console.log(`next tag: v${nextVersion} (previous: ${previousTag() ?? "none"})`);
  process.exit(0);
}

let changelogRaw = existsSync(CHANGELOG_PATH) ? readFileSync(CHANGELOG_PATH, "utf8") : null;
if (changelogRaw === null) {
  changelogRaw = [
    "# Changelog",
    "",
    "All notable changes to this project are documented here. The app version is",
    "the root `package.json` `version` field; release tags are `v<semver>`. Bump it",
    "with `npm run version:bump`.",
    "",
  ].join("\n");
}

const headerEnd = changelogRaw.indexOf("\n## ");
const updated =
  headerEnd === -1
    ? `${changelogRaw.replace(/\s*$/, "")}\n\n${entry}`
    : `${changelogRaw.slice(0, headerEnd)}\n${entry}\n${changelogRaw.slice(headerEnd + 1)}`;

writeFileSync(CHANGELOG_PATH, updated);
console.log(`changelog: prepended ${nextVersion} (${body.split("\n").length} line(s))`);

// ---- optional git actions --------------------------------------------------
if (flags.has("--commit")) {
  const add = sh("git", ["add", "package.json", "CHANGELOG.md"]);
  if (!add.ok) fail(`git add failed: ${add.err}`);
  const commit = sh("git", ["commit", "-m", `chore(release): ${nextVersion}`]);
  if (!commit.ok) fail(`git commit failed: ${commit.err}`);
  console.log(`committed: chore(release): ${nextVersion}`);
}

if (flags.has("--tag")) {
  const dirty = sh("git", ["status", "--porcelain"]);
  if (dirty.ok && dirty.out.length > 0) {
    console.error("bump-version: working tree is dirty; commit the release first (--tag skipped)");
    process.exit(1);
  }
  const tag = sh("git", ["tag", "-a", `v${nextVersion}`, "-m", `Release ${nextVersion}`]);
  if (!tag.ok) fail(`git tag failed: ${tag.err}`);
  console.log(`tagged: v${nextVersion}`);
}

if (flags.has("--push")) {
  const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const pushBranch = sh("git", ["push", REMOTE, branch.out || "main"]);
  if (!pushBranch.ok) fail(`git push failed: ${pushBranch.err}`);
  if (flags.has("--tag")) {
    const pushTag = sh("git", ["push", REMOTE, `v${nextVersion}`]);
    if (!pushTag.ok) fail(`git push tag failed: ${pushTag.err}`);
  }
  console.log(`pushed to ${REMOTE}`);
}

console.log(`\nNext: npm run docker:build && docker compose up -d api web`);
