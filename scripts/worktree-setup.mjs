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
//   4. launchers    -- make the tools `predev`/`pretest`/`build` invoke resolve.
//                      The box keeps ONE extracted install (the primary
//                      checkout's) and every worktree reaches it WITHOUT a link:
//                      worktrees live under `<primary>/.worktrees/<name>`, and
//                      both node's package resolution and npm's PATH rule walk
//                      the ancestor chain -- `npm run` prepends every ancestor's
//                      `node_modules/.bin`, so `<primary>/node_modules/.bin` is
//                      on PATH and `<primary>/node_modules/<pkg>` is resolvable
//                      from any file in the tree (both measured 2026-11-04).
//                      This worktree gets no `node_modules` and no junction: a
//                      junction is what made a routine `git worktree remove`
//                      recurse into the shared install and delete `.bin` and
//                      `.package-lock.json` from inside it. When the shared
//                      install has lost `.bin` or its hidden lockfile -- an
//                      interrupted `npm install`, or that reap -- both are
//                      regenerated from the packages themselves, offline and
//                      additively. When there is no install to share, `npm
//                      install` runs in this worktree instead (and then the
//                      tree has a real, complete `node_modules` of its own).
//
// Nothing is deleted, no package is downloaded while a complete install is on
// the box, and no port or database isolation rule is relaxed.
//
// Usage:
//   npm run worktree:setup
//   node scripts/worktree-setup.mjs [--no-links] [--no-db] [--no-ports]

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EOL } from "node:os";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/**
 * The naming rule is NOT here any more: it is `scripts/lib/database-name.mjs`,
 * the one module that owns every database name this repo can create, plus the
 * guard (`isRepoDatabaseName`) that recognises one. It lives there because
 * `scripts/pods.ts` (`heroes_pod_<name>`), `tools/run-test.mjs` and the test
 * tree all need the same rule, and because this script must stay importable in
 * a worktree with no `node_modules` yet -- the case it exists for -- so the
 * module it pulls in is plain Node ESM with no dependencies of its own.
 *
 * `slugForBranch`/`databaseNameForBranch` are re-exported below so the callers
 * that already reach for them here keep working.
 */
import { databaseNameForBranch, isRepoDatabaseName } from "./lib/database-name.mjs";

export { PRIMARY_BRANCHES, slugForBranch, databaseNameForBranch } from "./lib/database-name.mjs";

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

/**
 * The hidden lockfile npm writes at `<install>/node_modules/.package-lock.json`
 * -- its private record of the tree it actually materialised -- derived the way
 * npm derives it: the project's `package-lock.json` with the root `""` entry
 * dropped and every other entry kept only when its directory exists on disk.
 *
 * Measured 2026-11-04 against a real complete install of this repo (a sibling
 * checkout): a projection built this way is byte-for-byte npm's own hidden
 * lockfile, entry bodies and key order included. `dirExists` is injectable so
 * the rule can be pinned without touching a real tree.
 */
export function hiddenLockfileFrom(lockJson, installRoot, dirExists = existsSync) {
  const packages = lockJson?.packages;
  if (!packages || typeof packages !== "object") return null;
  const root = packages[""] ?? {};
  const projected = {
    name: root.name ?? lockJson.name,
    version: root.version ?? lockJson.version,
    lockfileVersion: lockJson.lockfileVersion,
    requires: lockJson.requires ?? true,
    packages: {},
  };
  for (const [key, value] of Object.entries(packages)) {
    if (key === "") continue;
    if (!dirExists(join(installRoot, key))) continue;
    projected.packages[key] = value;
  }
  return projected;
}

/**
 * Regenerate `node_modules/.package-lock.json` for an install that has lost it.
 * Additive only: an existing hidden lockfile is npm's own and is never rewritten.
 *
 * This is what makes the shim repair complete. `.bin` alone understated the
 * damage: a reap that follows a junction removes `.bin` AND
 * `.package-lock.json` (dot-prefixed, first), and nothing in the repo restored
 * the second -- which is why the primary checkout carried 78 regenerated
 * launchers and no hidden lockfile for hours. Both are now restored from the
 * only thing that outlives them: the tracked `package-lock.json` and the
 * extracted packages.
 */
export function repairHiddenLockfile(installRoot, log = () => {}) {
  const modulesDir = join(installRoot, "node_modules");
  const target = join(modulesDir, ".package-lock.json");
  if (!existsSync(modulesDir)) return { repaired: false, entries: 0, missing: 0 };
  if (existsSync(target)) return { repaired: false, entries: 0, missing: 0 };

  const lockPath = join(installRoot, "package-lock.json");
  if (!existsSync(lockPath)) {
    log(`cannot rebuild ${target}: no package-lock.json at ${lockPath}`);
    return { repaired: false, entries: 0, missing: 0 };
  }
  let lockJson;
  try {
    lockJson = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (err) {
    log(`cannot rebuild ${target}: ${lockPath} is not valid JSON (${err.message})`);
    return { repaired: false, entries: 0, missing: 0 };
  }

  const projected = hiddenLockfileFrom(lockJson, installRoot);
  if (!projected) {
    log(`cannot rebuild ${target}: ${lockPath} carries no "packages" map`);
    return { repaired: false, entries: 0, missing: 0 };
  }

  const locked = Object.keys(lockJson.packages).filter((k) => k !== "").length;
  const entries = Object.keys(projected.packages).length;
  const missing = locked - entries;
  // npm writes its hidden lockfile with the platform's line ending (CRLF on
  // Windows, measured), so this is byte-for-byte npm's own file, not just an
  // equivalent parse.
  writeFileSync(target, JSON.stringify(projected, null, 2).split("\n").join(EOL) + EOL);
  log(
    `regenerated ${target} (${entries} installed entries` +
      (missing > 0 ? `; ${missing} locked entries are not installed and are recorded as absent` : "") +
      ")",
  );
  return { repaired: true, entries, missing };
}

/**
 * Restore everything the setup can restore inside an install, offline and
 * additively: the launchers in `.bin` and the hidden lockfile. Nothing is
 * removed and no package is downloaded.
 *
 * What it CANNOT restore is package contents. If a package directory is gone or
 * empty, neither `.bin` nor the hidden lockfile can put it back -- the launcher
 * for it is only rendered from a package that is still extracted, and the hidden
 * lockfile records only what exists. `npm install` (or `npm ci`) in the install
 * root is the only thing that re-extracts packages, and the shared install is
 * deliberately never reinstalled while a worktree may be mid-run.
 */
export function repairInstall(installRoot, log = () => {}) {
  const modulesDir = join(installRoot, "node_modules");
  if (!existsSync(modulesDir)) return { repaired: false, shims: null, lock: null };
  const shims = repairShims(modulesDir, log);
  const lock = repairHiddenLockfile(installRoot, log);
  return { repaired: shims.repaired || lock.repaired, shims, lock };
}

/** Whether `child` is `parent` itself or lives under it -- the ancestor walk's precondition. */
export function isInside(parent, child) {
  if (!parent || !child) return false;
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Remove a `node_modules` symlink/junction at `path` WITHOUT touching what it
 * points at. `rmSync` with `force` (no `recursive`) unlinks a junction and
 * leaves the target intact -- measured 2026-11-04, because the trap the fleet
 * hit is git's own recursive delete, not Node's.
 */
function unlinkModulesLink(path) {
  try {
    rmSync(path, { force: true });
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

/**
 * Make the tools resolve for this worktree, without ever linking its
 * `node_modules` at the shared install.
 *
 * The share is the ancestor chain, not a junction: a worktree lives under
 * `<primary>/.worktrees/<name>`, so npm puts `<primary>/node_modules/.bin` on
 * PATH for every script here and node resolves `<primary>/node_modules/<pkg>`
 * from every file. Nothing is created in the worktree, which is the whole point:
 * there is no link for `git worktree remove` to follow into the shared install.
 *
 * A legacy junction left by an earlier version of this script is unlinked --
 * only in the tree being prepared, never another tree's -- because it is the
 * trap, and the ancestor chain replaces what it provided.
 */
export function ensureInstall(root, primary, log) {
  const shared = primary ? join(primary, "node_modules") : null;
  const local = join(root, "node_modules");
  const reachable = Boolean(primary) && isInside(primary, root);
  const shareable = Boolean(shared) && shared !== local && reachable && existsSync(shared);

  if (shareable) {
    if (installState(shared) === "partial") {
      console.log(
        "[setup] WARNING: the shared install is missing node_modules/.bin or its hidden lockfile -- " +
          "an interrupted `npm install` in the primary checkout, or a reap that followed a junction " +
          "into it. Regenerating both (offline, additive); `npm install` in the primary is the real " +
          "repair for package contents.",
      );
    }
    // Additive and cheap: a no-op on a complete install, the repair on a partial
    // one -- and the partial case is exactly `.bin` present, lockfile gone, which
    // is what this box measured, so the check is the installState, not the launchers.
    repairInstall(primary, log);
  }

  const localExists = existsSync(local);
  const localIsLink = localExists && lstatSync(local).isSymbolicLink();

  // A real local install that is usable wins: it is complete and self-contained.
  if (localExists && !localIsLink && launchersReady(local)) return { how: "already", path: local };

  if (shareable && launchersReady(shared)) {
    if (localIsLink) {
      const unlinked = unlinkModulesLink(local);
      if (unlinked === true) {
        log(
          `unlinked the legacy node_modules junction at ${local}; the shared install is reached ` +
            "through the ancestor chain, so no link is needed",
        );
      } else {
        console.log(`[setup] could not unlink ${local} (${unlinked.message}); installing here instead`);
        return npmInstall(root) ? { how: "installed", path: local } : { how: "failed", path: local };
      }
    } else if (localExists) {
      // A real directory here without usable launchers is a half-install this
      // script did not make; it is left alone and the card is told to install.
      log(`left ${local} alone: it exists without usable launchers and was not created here`);
      return { how: "unknown", path: local };
    }
    return { how: "shared", path: shared };
  }

  // No usable install to share: this tree needs a real one of its own.
  if (localIsLink) {
    const unlinked = unlinkModulesLink(local);
    if (unlinked !== true) console.log(`[setup] could not unlink ${local} (${unlinked.message})`);
  }
  if (npmInstall(root)) return { how: "installed", path: local };
  return { how: "failed", path: local };
}

/** One line for the "ready" summary, spelling out how the tools resolve. */
function describeInstall({ how, path }) {
  switch (how) {
    case "shared":
      return `shared through the primary checkout, no link (${path})`;
    case "already":
      return `this worktree's own complete install (${path})`;
    case "installed":
      return `installed in this worktree (${path})`;
    case "skipped":
      return "skipped (--no-links)";
    case "unknown":
      return `present but unusable (${path})`;
    default:
      return `${how} (${path})`;
  }
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
  // The guard, at the one place the repo CREATEs a database: a name this
  // script cannot recognise as the repo's own must never be created, because a
  // sweep could not tell it apart from a stranger's (the defect two sweeps hit
  // -- `game_wt_*`, `game_fix3_*`, `game_play_flip_*`, `game_play_meas_*`).
  // `databaseNameForBranch` is the only producer of `db`, so this is an
  // invariant check rather than a filter; it fires if a future edit routes a
  // name around the rule.
  if (!isRepoDatabaseName(db)) {
    log(`refusing to create ${db}: it is not a name this repo's rule produces (see scripts/lib/database-name.mjs)`);
    return "refused";
  }
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
  const launchers = flags.has("--no-links")
    ? { how: "skipped", path: join(root, "node_modules") }
    : ensureInstall(root, primary, log);

  const dbResult = env.db ? ensureDatabase("game_db", env.db, log) : "skipped";

  const ports = flags.has("--no-ports") ? false : allocatePorts(root, log);

  console.log("");
  console.log("[setup] ready:");
  console.log(`  branch        ${branch}`);
  console.log(`  database      ${env.db ?? "(shared: the primary checkout)"}`);
  console.log(`  node_modules  ${describeInstall(launchers)}`);
  console.log(`  ports         ${ports ? "allocated by scripts/allocate-ports.ts" : "not allocated"}`);
  if (dbResult === "refused") {
    console.log("  NEXT          the database name escaped scripts/lib/database-name.mjs; fix the rule, not the name");
    return 1;
  }
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
