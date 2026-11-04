#!/usr/bin/env node
// scripts/worktree-setup.mjs
//
// The one preparation path for a worktree that git has just cut.
//
// Why this exists. `git worktree add` lays down only what git carries, and two
// things a run needs are deliberately not carried: `.env` and `node_modules`
// (both gitignored). Measured on this box 2026-11-04, in a worktree cut
// seconds earlier from `main`:
//
//   - no `.env` at all -- only the tracked `.env.example` and `.env.test`
//   - no `node_modules`, so no `node_modules/.bin`
//   - `npm run pretest` (`tsx scripts/allocate-ports.ts`) -> `'tsx' is not
//     recognized`; `npm run build` (`tsc && vite build`) -> `'tsc' is not
//     recognized`; `npm run dev` dies the same way at its `predev` step
//   - `npx tsx --version` answers `4.23.15` -- a registry copy from the npx
//     cache, NOT the repo's pinned 4.23.1, because nothing local resolves
//   - only pure-`node` scripts run (`npm run docs:check` passed)
//
// `.kilo/setup-script.ps1` is the other preparation hook in the repo, but it is
// wired to `kilo worktree create` (legacy kwork) and worktrees here are cut
// with `git worktree add` -- so it never runs, and it only ever covered the
// database half anyway.
//
// What this does, in order, all idempotent and additive:
//
//   1. `.env`       -- seeded from `.env.example` when absent, so the Postgres
//                      defaults and NODE_ENV/LAN_HOST exist.
//   2. database     -- `game_poc_<branch-slug>` for a non-primary branch: the
//                      database is created in the shared `game_db` container
//                      (idempotent) and written into `.env` when the key is not
//                      already set. The primary branch gets no per-worktree
//                      database, so nothing shared is weakened.
//   3. ports        -- `scripts/allocate-ports.ts`, the repo's own allocator.
//                      No second port policy lives here.
//   4. launchers    -- make `<worktree>/node_modules/.bin` resolve the tools the
//                      package scripts use. The box keeps ONE extracted install
//                      (the primary checkout's) and worktrees share it. When
//                      that install has lost its `.bin` -- an interrupted
//                      `npm install` leaves every package extracted and the
//                      launchers gone, which is the state measured here and the
//                      reason no worktree could run `tsc`/`tsx` -- the launchers
//                      are regenerated from the packages themselves, offline.
//                      When there is no install to share, `npm install` runs in
//                      this worktree instead.
//
// Nothing is deleted, no package is downloaded while a complete install is on
// the box, and no port or database isolation rule is relaxed.
//
// Usage:
//   npm run worktree:setup
//   node scripts/worktree-setup.mjs [--no-links] [--no-db] [--no-ports]

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** The branches that ARE the shared checkout: they must not get a private database. */
export const PRIMARY_BRANCHES = ["main", "master"];

/** Postgres truncates identifiers at 63 bytes; `game_poc_` is the prefix every per-worktree name carries. */
const DB_PREFIX = "game_poc_";
const SLUG_LIMIT = 40;

/**
 * The per-worktree slug, and the ONLY rule in the repo that names a worktree
 * database. Lowercased branch, every run of non-alphanumerics to `_`, trimmed,
 * capped at 40 so the identifier stays inside Postgres' 63-byte limit.
 *
 * `wtgui/a-fresh-worktree-arrives-f9c70c` -> `wtgui_a_fresh_worktree_arrives_f9c70c`
 */
export function slugForBranch(branch) {
  const slug = String(branch ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "wt";
  return slug.slice(0, SLUG_LIMIT);
}

/** `main` -> null (the shared checkout keeps the shared database). */
export function databaseNameForBranch(branch) {
  const name = String(branch ?? "").trim().toLowerCase();
  if (PRIMARY_BRANCHES.includes(name)) return null;
  return DB_PREFIX + slugForBranch(branch);
}

/**
 * Point `.env` text at this worktree's database. Pure, so both halves of the
 * rule can be pinned:
 *
 *   replace: true  -- the text is a fresh copy of `.env.example`, whose
 *                     `PGDATABASE=game_poc` names the SHARED database. Now that
 *                     it has moved into a worktree, that value is wrong and is
 *                     rewritten.
 *   replace: false -- the text was already here, so a value in it is a decision
 *                     someone made; only a MISSING key is added.
 *
 * The pattern matches `[ \t]`, never `\s`. `.env.example` is CRLF, and `\s`
 * matches a line terminator, so `^\s*PGDATABASE...` also matches from just after
 * the `\r` and swallows the `\n` -- which glues the previous line onto this one
 * and makes scripts/allocate-ports.ts' line-per-key reader drop BOTH keys.
 */
export function withDatabaseKey(envText, name, { replace = false } = {}) {
  if (!name) return envText;
  const line = /^[ \t]*PGDATABASE[ \t]*=.*$/m;
  if (line.test(envText)) {
    if (!replace) return envText;
    return envText.replace(line, `PGDATABASE=${name}`);
  }
  const base = envText.replace(/\s*$/, "");
  return `${base}${base ? "\n" : ""}PGDATABASE=${name}\n`;
}

/** Whether an extracted install is usable: npm writes `.bin` and `.package-lock.json` together. */
export function installState(modulesDir) {
  if (!existsSync(modulesDir)) return "absent";
  return existsSync(join(modulesDir, ".bin")) && existsSync(join(modulesDir, ".package-lock.json"))
    ? "complete"
    : "partial";
}

/** The commands the package scripts invoke before anything else (`predev`, `pretest`, `build`, `dev`). */
const REQUIRED_TOOLS = ["tsx", "tsc", "vite", "concurrently"];

/**
 * Whether an install can actually be used RIGHT NOW. This, not the lockfile, is
 * what decides whether a worktree may share it: the measured defect is an
 * install whose packages are all extracted and whose launchers are gone, and a
 * regenerated `.bin` makes that install usable even though npm's own
 * bookkeeping (`.package-lock.json`) is still missing.
 */
export function launchersReady(modulesDir) {
  const bin = join(modulesDir, ".bin");
  if (!existsSync(bin)) return false;
  return REQUIRED_TOOLS.every((tool) => existsSync(join(bin, tool)) || existsSync(join(bin, `${tool}.cmd`)));
}

/** `{ name: target }` for a package's `bin` field, in the shape npm links it. */
export function binEntries(pkgJson) {
  const bin = pkgJson?.bin;
  if (!bin) return [];
  if (typeof bin === "string") {
    const leaf = String(pkgJson.name ?? "").split("/").pop();
    return leaf ? [{ name: leaf, target: bin }] : [];
  }
  return Object.entries(bin).map(([name, target]) => ({ name, target: String(target) }));
}

function stripDotSlash(p) {
  return String(p).replace(/^\.\//, "");
}

/** The three launcher bodies npm writes, byte for byte, for a `bin` target. */
export function renderShim(kind, target) {
  const rel = target.replace(/\\/g, "/");
  const relWin = rel.replace(/\//g, "\\");
  if (kind === "sh") {
    return `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")

case \`uname\` in
    *CYGWIN*|*MINGW*|*MSYS*)
        if command -v cygpath > /dev/null 2>&1; then
            basedir=\`cygpath -w "$basedir"\`
        fi
    ;;
esac

if [ -x "$basedir/node" ]; then
  exec "$basedir/node"  "$basedir/${rel}" "$@"
else 
  exec node  "$basedir/${rel}" "$@"
fi
`;
  }
  if (kind === "cmd") {
    return [
      "@ECHO off",
      "GOTO start",
      ":find_dp0",
      "SET dp0=%~dp0",
      "EXIT /b",
      ":start",
      "SETLOCAL",
      "CALL :find_dp0",
      "",
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ") ELSE (",
      '  SET "_prog=node"',
      "  SET PATHEXT=%PATHEXT:;.JS;=;%",
      ")",
      "",
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relWin}" %*`,
      "",
    ].join("\r\n");
  }
  if (kind === "ps1") {
    return `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  # Fix case when both the Windows and Linux builds of Node
  # are installed in the same directory
  $exe=".exe"
}
$ret=0
if (Test-Path "$basedir/node$exe") {
  # Support pipeline input
  if ($MyInvocation.ExpectingInput) {
    $input | & "$basedir/node$exe"  "$basedir/${rel}" $args
  } else {
    & "$basedir/node$exe"  "$basedir/${rel}" $args
  }
  $ret=$LASTEXITCODE
} else {
  # Support pipeline input
  if ($MyInvocation.ExpectingInput) {
    $input | & "node$exe"  "$basedir/${rel}" $args
  } else {
    & "node$exe"  "$basedir/${rel}" $args
  }
  $ret=$LASTEXITCODE
}
exit $ret
`;
  }
  throw new Error(`renderShim: unknown kind ${kind}`);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts });
  return {
    ok: r.status === 0,
    status: r.status,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
}

function git(args) {
  return sh("git", args, { cwd: ROOT });
}

/** The primary checkout that owns everything but this worktree. */
export function primaryCheckout() {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok || !common.out) {
    const dots = git(["rev-parse", "--git-common-dir"]);
    if (!dots.ok || !dots.out) return null;
    return resolve(ROOT, dirname(dots.out));
  }
  return dirname(common.out);
}

/** Every `bin` npm would link for the packages extracted under `modulesDir`. */
export function collectInstalledBins(modulesDir) {
  const out = [];
  if (!existsSync(modulesDir)) return out;
  const scan = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".")) continue;
      const pkgDir = join(dir, entry.name);
      const relDir = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name.startsWith("@") && !prefix) {
        scan(pkgDir, entry.name);
        continue;
      }
      const pkgJsonPath = join(pkgDir, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      let pkgJson;
      try {
        pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      } catch {
        continue;
      }
      for (const { name, target } of binEntries(pkgJson)) {
        out.push({ name, target: `../${relDir}/${stripDotSlash(target)}` });
      }
    }
  };
  scan(modulesDir, "");
  return out;
}

/**
 * Regenerate `node_modules/.bin` for an install whose packages are extracted but
 * whose launchers are gone. Additive only: nothing is removed, nothing is
 * downloaded, and an existing `.bin` is left exactly as npm wrote it.
 */
export function repairShims(modulesDir, log = () => {}) {
  const binDir = join(modulesDir, ".bin");
  if (existsSync(binDir)) return { repaired: false, written: 0 };
  const bins = collectInstalledBins(modulesDir);
  if (bins.length === 0) return { repaired: false, written: 0 };
  mkdirSync(binDir, { recursive: true });
  let written = 0;
  for (const { name, target } of bins) {
    writeFileSync(join(binDir, name), renderShim("sh", target), { mode: 0o755 });
    writeFileSync(join(binDir, `${name}.cmd`), renderShim("cmd", target));
    writeFileSync(join(binDir, `${name}.ps1`), renderShim("ps1", target), { mode: 0o755 });
    written += 3;
  }
  log(`regenerated ${written} launcher files (${bins.length} commands) in ${binDir}`);
  return { repaired: true, written };
}

/** Absolute path to a tool's CLI entry, resolved the way the repo's own tools do. */
function toolEntry(pkg, from = ROOT) {
  let dir = from;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "node_modules", pkg, "package.json");
    if (existsSync(candidate)) {
      const pkgJson = JSON.parse(readFileSync(candidate, "utf8"));
      const bin = pkgJson.bin;
      const rel = typeof bin === "string" ? bin : bin?.[pkg] ?? Object.values(bin ?? {})[0];
      if (rel) return join(dir, "node_modules", pkg, stripDotSlash(rel));
    }
    dir = dirname(dir);
  }
  return null;
}

function linkModules(target, path) {
  try {
    symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (err) {
    return err;
  }
}

function npmInstall(cwd) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(`[setup] installing dependencies in ${cwd} (no usable install to share)`);
  // `npm.cmd` is a batch file: on Windows it only spawns through a shell. Every
  // argument here is a literal with no spaces, so the shell cannot mangle one.
  const r = spawnSync(npm, ["install", "--no-audit", "--no-fund"], {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (r.error) console.log(`[setup] npm install could not start: ${r.error.message}`);
  return r.status === 0;
}

function ensureLaunchers(root, primary, log) {
  const shared = primary ? join(primary, "node_modules") : null;
  const local = join(root, "node_modules");

  if (shared && shared !== local && existsSync(shared) && !launchersReady(shared)) {
    if (installState(shared) === "partial") {
      console.log(
        "[setup] WARNING: the shared install has packages extracted but no node_modules/.bin -- " +
          "an interrupted `npm install` in the primary checkout. Regenerating the launchers " +
          "(offline, additive); `npm install` in the primary is the real repair.",
      );
    }
    repairShims(shared, log);
  }

  if (launchersReady(local)) return { how: "already", path: local };

  if (shared && shared !== local && launchersReady(shared)) {
    if (existsSync(local)) {
      // A symlink to the shared install is exactly the shape we want; a real
      // directory here is a half-install this script did not make, so it is
      // left alone and the card is told to run `npm install`.
      if (lstatSync(local).isSymbolicLink()) {
        rmSync(local, { force: true });
      } else {
        log(`left ${local} alone: it exists without usable launchers and was not created here`);
        return { how: "unknown", path: local };
      }
    }
    const linked = linkModules(shared, local);
    if (linked === true) {
      log(`linked the shared install: ${local} -> ${shared}`);
      return { how: "linked", path: local };
    }
    console.log(`[setup] could not link the shared install (${linked.message}); installing here instead`);
  }

  if (npmInstall(root)) return { how: "installed", path: local };
  return { how: "failed", path: local };
}

function ensureEnv(root, primary, branch, log) {
  const envPath = join(root, ".env");
  const seeded = !existsSync(envPath);
  if (seeded) {
    const example = join(root, ".env.example");
    writeFileSync(envPath, existsSync(example) ? readFileSync(example, "utf8") : "");
    log("seeded .env from .env.example");
  } else {
    log(".env already present");
  }
  if (root === primary) return { envPath, db: null };

  const db = databaseNameForBranch(branch);
  if (!db) {
    log(`branch '${branch}' is the primary branch; no per-worktree database`);
    return { envPath, db: null };
  }

  const before = readFileSync(envPath, "utf8");
  const after = withDatabaseKey(before, db, { replace: seeded });
  if (after !== before) {
    writeFileSync(envPath, after);
    log(
      seeded
        ? `.env.example's shared PGDATABASE=game_poc rewritten to PGDATABASE=${db} for this worktree`
        : `wrote PGDATABASE=${db} to .env`,
    );
  } else {
    log(".env already defines PGDATABASE; left unchanged");
  }
  return { envPath, db };
}

function ensureDatabase(container, db, log) {
  if (!db) return "skipped";
  const probe = sh("docker", ["exec", container, "psql", "-U", "gameuser", "-d", "postgres", "-tAc",
    `SELECT 1 FROM pg_database WHERE datname='${db}';`]);
  if (!probe.ok) {
    log(`could not reach the ${container} container; create ${db} yourself before a DB-backed test`);
    return "unreachable";
  }
  if (probe.out.trim() === "1") {
    log(`database ${db} already exists in ${container} (no-op)`);
    return "exists";
  }
  const created = sh("docker", ["exec", container, "psql", "-U", "gameuser", "-d", "postgres", "-c",
    `CREATE DATABASE ${db} OWNER gameuser;`]);
  if (!created.ok) {
    log(`could not create ${db}: ${created.err || created.out}`);
    return "failed";
  }
  log(`created database ${db} (owner gameuser) in ${container}`);
  return "created";
}

function allocatePorts(root, log) {
  const tsx = toolEntry("tsx", root);
  if (!tsx) {
    log("tsx does not resolve here, so the port allocator could not run");
    return false;
  }
  const r = spawnSync(process.execPath, [tsx, join(root, "scripts", "allocate-ports.ts")], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  return r.status === 0;
}

export function run(argv = process.argv.slice(2), { root = ROOT } = {}) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const log = (msg) => console.log(`[setup] ${msg}`);

  const branchResult = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchResult.ok ? branchResult.out : "(detached)";
  const primary = primaryCheckout();

  console.log(`Worktree: ${branch}  (${root})`);
  console.log(`[setup] primary checkout: ${primary ?? "(unresolved)"}`);

  const env = flags.has("--no-db") ? { envPath: join(root, ".env"), db: null } : ensureEnv(root, primary, branch, log);
  const launchers = flags.has("--no-links") ? { how: "skipped", path: join(root, "node_modules") } : ensureLaunchers(root, primary, log);

  if (env.db) ensureDatabase("game_db", env.db, log);

  const ports = flags.has("--no-ports") ? false : allocatePorts(root, log);

  console.log("");
  console.log("[setup] ready:");
  console.log(`  branch        ${branch}`);
  console.log(`  database      ${env.db ?? "(shared: the primary checkout)"}`);
  console.log(`  node_modules  ${launchers.how} (${launchers.path})`);
  console.log(`  ports         ${ports ? "allocated by scripts/allocate-ports.ts" : "not allocated"}`);
  if (launchers.how === "failed" || launchers.how === "unknown") {
    console.log("  NEXT          `npm install` in this worktree, then re-run `npm run worktree:setup`");
    return 1;
  }
  console.log("  NEXT          `npm run dev`, or `npm run build`");
  return 0;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  try {
    process.exit(run());
  } catch (err) {
    console.error(`worktree-setup failed: ${err?.stack ?? err}`);
    process.exit(1);
  }
}
