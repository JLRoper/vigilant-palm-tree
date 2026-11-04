// A fresh worktree arrives with no `.env` and no `node_modules`, so the first
// command a card runs dies on a missing launcher (`'tsx' is not recognized` from
// `predev`/`pretest`, `'tsc'` from `build`). `scripts/worktree-setup.mjs` is the
// repo-owned preparation path that fixes that at the cut instead of leaving every
// card to rediscover it. These tests pin the parts that decide WHERE things land:
// the database name, what `.env` is allowed to overwrite, how an extracted
// install is classified, and the launcher bodies -- which must be npm's own bytes,
// because npm's `.bin` is what the package scripts actually invoke.
//
// Measured 2026-11-04 on this box: `renderShim` output is byte-identical to the
// `.bin` npm itself wrote in a worktree whose install completed, so a repaired
// `.bin` is indistinguishable from a fresh one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  binEntries,
  collectInstalledBins,
  databaseNameForBranch,
  ensureInstall,
  hiddenLockfileFrom,
  installState,
  isInside,
  launchersReady,
  primaryCheckout,
  renderShim,
  repairHiddenLockfile,
  repairShims,
  slugForBranch,
  withDatabaseKey,
} from "../../scripts/worktree-setup.mjs";

function scratch(name: string): string {
  return mkdtempSync(join(tmpdir(), `heroes-${name}-`));
}

test("the worktree slug is derived from the branch, one rule, capped short of Postgres' 63 bytes", () => {
  assert.equal(slugForBranch("wtgui/a-fresh-worktree-arrives-f9c70c"), "wtgui_a_fresh_worktree_arrives_f9c70c");
  assert.equal(slugForBranch("Feat/Add A Thing"), "feat_add_a_thing");
  // A branch with nothing alphanumeric in it still has to name something.
  assert.equal(slugForBranch("///"), "wt");
  assert.equal(slugForBranch("").length, 2);
  assert.equal(slugForBranch("x".repeat(80)).length, 40, "capped so `game_poc_<slug>` stays inside 63 bytes");
});

test("a worktree branch gets its own database, and the primary branches get none", () => {
  assert.equal(databaseNameForBranch("wtgui/a-fresh-worktree-arrives-f9c70c"), "game_poc_wtgui_a_fresh_worktree_arrives_f9c70c");
  assert.equal(databaseNameForBranch("feat/add-a-thing"), "game_poc_feat_add_a_thing");
  // The shared checkout keeps the shared database: `game_poc` is what the dev
  // stack and the DEPLOYED stack read, so handing `main` a private copy would be
  // the isolation rule inverted.
  assert.equal(databaseNameForBranch("main"), null);
  assert.equal(databaseNameForBranch("master"), null);
});

test("seeding a worktree .env rewrites .env.example's SHARED game_poc, but never a value a card chose", () => {
  const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  assert.match(example, /^PGDATABASE=game_poc\r?$/m, ".env.example still points at the shared database");

  const seeded = withDatabaseKey(example, "game_poc_wt_x", { replace: true });
  const lines = seeded.match(/^\s*PGDATABASE\s*=.*$/gm) ?? [];
  assert.equal(lines.length, 1, "exactly one PGDATABASE line survives the rewrite");
  assert.equal(lines[0].trim(), "PGDATABASE=game_poc_wt_x");

  // The rewrite must not eat a line terminator: `\s` in the pattern would match
  // from just after the `\r` and swallow the `\n`, gluing PGPASSWORD onto
  // PGDATABASE -- and scripts/allocate-ports.ts reads the file line by line, so
  // both keys would then vanish from the next write. The checkout's line ending
  // is not fixed (CRLF here, LF on the CI runner), so it is read off the file.
  const eol = example.includes("\r\n") ? "\r\n" : "\n";
  const after = seeded.split(/\r?\n/);
  assert.ok(after.includes("PGPASSWORD=gamepass"), "the key above PGDATABASE is still its own line");
  assert.ok(after.includes("PGDATABASE=game_poc_wt_x"), "and PGDATABASE is its own line");
  assert.ok(
    seeded.includes(`PGPASSWORD=gamepass${eol}PGDATABASE=game_poc_wt_x`),
    `the ${eol === "\r\n" ? "CRLF" : "LF"} line ending between them survives`,
  );
  assert.ok(!seeded.includes("PGPASSWORD=gamepass\rPGDATABASE"), "and never line-glued as CR-only");

  // The same rule, stated on LF text so it does not depend on how the checkout
  // was configured -- the CI runner checks .env.example out with LF.
  assert.equal(
    withDatabaseKey("NODE_ENV=development\nPGPASSWORD=gamepass\nPGDATABASE=game_poc\n", "game_poc_wt_x", { replace: true }),
    "NODE_ENV=development\nPGPASSWORD=gamepass\nPGDATABASE=game_poc_wt_x\n",
  );

  // An .env that already existed carries a decision; only a MISSING key is added.
  assert.equal(withDatabaseKey("PGDATABASE=game_play_mine\n", "game_poc_wt_x"), "PGDATABASE=game_play_mine\n");
  const appended = withDatabaseKey("NODE_ENV=development\n", "game_poc_wt_x");
  assert.equal(appended, "NODE_ENV=development\nPGDATABASE=game_poc_wt_x\n");

  assert.equal(withDatabaseKey("NODE_ENV=development\n", null), "NODE_ENV=development\n");
});

test("an install is COMPLETE only when npm's `.bin` and its lockfile are both there", () => {
  const dir = scratch("install-state");
  try {
    assert.equal(installState(join(dir, "missing")), "absent");

    mkdirSync(join(dir, "extracted"), { recursive: true });
    writeFileSync(join(dir, "extracted", "some-package"), "x");
    // Packages extracted, launchers gone: the measured state of the primary
    // checkout's shared install at 2026-11-04, and why no worktree could run tsc.
    assert.equal(installState(join(dir, "extracted")), "partial");

    mkdirSync(join(dir, "complete", ".bin"), { recursive: true });
    writeFileSync(join(dir, "complete", ".package-lock.json"), "{}");
    assert.equal(installState(join(dir, "complete")), "complete");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an interrupted install is UNUSABLE until the launchers are regenerated, and then it is usable", () => {
  const dir = scratch("repair");
  const modules = join(dir, "node_modules");
  try {
    for (const [rel, json] of [
      ["tsx", { name: "tsx", bin: "./dist/cli.mjs" }],
      ["typescript", { name: "typescript", bin: { tsc: "./bin/tsc" } }],
      ["vite", { name: "vite", bin: { vite: "bin/vite.js" } }],
      ["concurrently", { name: "concurrently", bin: { concurrently: "./dist/bin/concurrently.js" } }],
    ] as Array<[string, unknown]>) {
      mkdirSync(join(modules, rel), { recursive: true });
      writeFileSync(join(modules, rel, "package.json"), JSON.stringify(json));
    }

    // The measured defect: 26 commands' worth of packages, not one launcher.
    assert.equal(installState(modules), "partial");
    assert.equal(launchersReady(modules), false);

    const result = repairShims(modules);
    assert.equal(result.repaired, true);
    assert.equal(result.written, 12, "four commands, three launchers each");
    assert.equal(launchersReady(modules), true, "a regenerated .bin is usable, lockfile or not");

    // Idempotent: an existing .bin is npm's and is never rewritten.
    assert.deepEqual(repairShims(modules), { repaired: false, written: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the launcher bodies are npm's own, one `bin` target each", () => {
  const sh = renderShim("sh", "../typescript/bin/tsc");
  assert.match(sh, /^#!\/bin\/sh\n/);
  assert.match(sh, /exec node {2}"\$basedir\/\.\.\/typescript\/bin\/tsc" "\$@"$/m);

  const cmd = renderShim("cmd", "../typescript/bin/tsc");
  assert.ok(cmd.includes("\r\n"), "the .cmd launcher is CRLF, as npm writes it");
  assert.match(cmd, /"%dp0%\\\.\.\\typescript\\bin\\tsc" %\*/);

  const ps1 = renderShim("ps1", "../typescript/bin/tsc");
  assert.match(ps1, /^#!\/usr\/bin\/env pwsh\n/);
  assert.match(ps1, /"\$basedir\/\.\.\/typescript\/bin\/tsc" \$args/);
});

test("a package's bin field is read the three ways npm links it", () => {
  assert.deepEqual(binEntries({ name: "tsx", bin: "./dist/cli.mjs" }), [{ name: "tsx", target: "./dist/cli.mjs" }]);
  assert.deepEqual(binEntries({ name: "@scope/tool", bin: "./cli.js" }), [{ name: "tool", target: "./cli.js" }]);
  assert.deepEqual(binEntries({ name: "conc", bin: { concurrently: "dist/bin/conc.js", conc: "dist/bin/conc.js" } }), [
    { name: "concurrently", target: "dist/bin/conc.js" },
    { name: "conc", target: "dist/bin/conc.js" },
  ]);
  assert.deepEqual(binEntries({ name: "no-bin" }), []);
  assert.deepEqual(binEntries(null), []);
});

test("a repaired .bin holds exactly the commands the extracted packages declare", () => {
  const dir = scratch("bins");
  const modules = join(dir, "node_modules");
  try {
    const write = (rel: string, json: unknown) => {
      mkdirSync(join(modules, rel), { recursive: true });
      writeFileSync(join(modules, rel, "package.json"), JSON.stringify(json));
    };
    write("vite", { name: "vite", bin: { vite: "bin/vite.js" } });
    write("typescript", { name: "typescript", bin: { tsc: "./bin/tsc" } });
    write("@scope/tool", { name: "@scope/tool", bin: "./cli.js" });
    write("no-bin-here", { name: "no-bin-here" });
    // A hidden directory is npm's own bookkeeping, never a package.
    mkdirSync(join(modules, ".cache"), { recursive: true });

    const bins = collectInstalledBins(modules);
    assert.deepEqual(
      bins.map((b) => b.name).sort(),
      ["tool", "tsc", "vite"],
      "one entry per declared bin, scoped packages included, dotfolders skipped",
    );
    const tsc = bins.find((b) => b.name === "tsc");
    assert.equal(tsc?.target, "../typescript/bin/tsc", "the target is relative to node_modules/.bin, the way npm links it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the primary checkout resolves even from a worktree, so the shared install is findable", () => {
  const primary = primaryCheckout();
  assert.ok(primary, "git rev-parse --git-common-dir must resolve from inside the repo");
  assert.ok(existsSync(join(primary, ".git")), "the primary checkout carries the shared .git");
});

// --- the share is the ancestor chain, never a junction ----------------------
//
// A junctioned `node_modules` is what made a routine `git worktree remove`
// recurse into the shared install and delete `.bin` and `.package-lock.json`
// (dot-prefixed, first) from inside it. The fix is to create no link at all:
// a worktree lives under `<primary>/.worktrees/<name>`, and both node's package
// resolution and npm's PATH rule walk the ancestor chain, so the primary's
// install is reachable with nothing in the worktree.

const REQUIRED = ["tsx", "tsc", "vite", "concurrently"];

/** A fake primary checkout with a usable shared install, plus a worktree under it. */
function fakePrimary(root: string): { primary: string; modules: string; worktree: string } {
  const primary = join(root, "primary");
  const modules = join(primary, "node_modules");
  mkdirSync(join(modules, ".bin"), { recursive: true });
  for (const tool of REQUIRED) writeFileSync(join(modules, ".bin", tool), "");
  const worktree = join(primary, ".worktrees", "wt");
  mkdirSync(worktree, { recursive: true });
  return { primary, modules, worktree };
}

test("a worktree under the primary shares the install with NO node_modules and NO junction", () => {
  const dir = scratch("share");
  try {
    const { primary, worktree } = fakePrimary(dir);
    const messages: string[] = [];
    const result = ensureInstall(worktree, primary, (m) => messages.push(m));
    assert.equal(result.how, "shared");
    assert.equal(result.path, join(primary, "node_modules"));
    assert.equal(existsSync(join(worktree, "node_modules")), false, "nothing is created in the worktree");
    assert.ok(!messages.some((m) => /link|junction/i.test(m)), "and nothing is linked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a legacy node_modules junction is unlinked, its target left intact, and the share takes over", () => {
  const dir = scratch("legacy-link");
  try {
    const { primary, modules, worktree } = fakePrimary(dir);
    const local = join(worktree, "node_modules");
    symlinkSync(modules, local, process.platform === "win32" ? "junction" : "dir");
    assert.equal(lstatSync(local).isSymbolicLink(), true, "the tree starts as the trap");

    const result = ensureInstall(worktree, primary, () => {});
    assert.equal(result.how, "shared");
    assert.equal(existsSync(local), false, "the junction is gone");
    assert.ok(existsSync(join(modules, ".bin", "tsx")), "the shared install is untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a real, complete local install is left in place (no link, no reinstall)", () => {
  const dir = scratch("local-install");
  try {
    const { primary, worktree } = fakePrimary(dir);
    const localBin = join(worktree, "node_modules", ".bin");
    mkdirSync(localBin, { recursive: true });
    for (const tool of REQUIRED) writeFileSync(join(localBin, tool), "");

    const result = ensureInstall(worktree, primary, () => {});
    assert.equal(result.how, "already");
    assert.equal(result.path, join(worktree, "node_modules"));
    assert.equal(lstatSync(join(worktree, "node_modules")).isSymbolicLink(), false, "never a link");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isInside separates a descendant (the ancestor walk works) from an unrelated tree", () => {
  assert.equal(isInside("C:/a", "C:/a/.worktrees/wt"), true);
  assert.equal(isInside("C:/a", "C:/a"), true);
  assert.equal(isInside("C:/a", "C:/b/.worktrees/wt"), false);
  assert.equal(isInside("C:/a", "C:/a-sibling/wt"), false, "a shared prefix is not a descendant");
  assert.equal(isInside(null, "C:/a"), false);
});

test("a worktree whose shared install lost .bin AND the hidden lockfile gets both rebuilt, offline", () => {
  const dir = scratch("shared-repair");
  try {
    const primary = join(dir, "primary");
    const modules = join(primary, "node_modules");
    const tools: Array<[string, string]> = [
      ["tsx", "tsx"],
      ["typescript", "tsc"],
      ["vite", "vite"],
      ["concurrently", "concurrently"],
    ];
    const packages: Record<string, unknown> = { "": { name: "heroes-js", version: "0.1.0" } };
    for (const [pkg, bin] of tools) {
      mkdirSync(join(modules, pkg), { recursive: true });
      writeFileSync(join(modules, pkg, "package.json"), JSON.stringify({ name: pkg, bin: { [bin]: "bin/x.js" } }));
      packages[`node_modules/${pkg}`] = { version: "1.0.0", resolved: `https://x/${pkg}.tgz`, integrity: "sha512-x" };
    }
    writeFileSync(
      join(primary, "package-lock.json"),
      JSON.stringify({ name: "heroes-js", version: "0.1.0", lockfileVersion: 3, requires: true, packages }),
    );
    const worktree = join(primary, ".worktrees", "wt");
    mkdirSync(worktree, { recursive: true });

    assert.equal(launchersReady(modules), false, "the measured defect: packages extracted, no launchers");
    assert.equal(existsSync(join(modules, ".package-lock.json")), false, "and no hidden lockfile");

    const result = ensureInstall(worktree, primary, () => {});
    assert.equal(result.how, "shared");
    assert.equal(launchersReady(modules), true, "the launchers are rebuilt from the extracted packages");
    assert.equal(existsSync(join(modules, ".package-lock.json")), true, "and so is the hidden lockfile");
    assert.equal(existsSync(join(worktree, "node_modules")), false, "still without a link in the worktree");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing node_modules/.package-lock.json is regenerated from the tracked lock, additively", () => {
  const dir = scratch("hidden-lock");
  try {
    const primary = join(dir, "install");
    const modules = join(primary, "node_modules");
    mkdirSync(join(modules, "tsx"), { recursive: true });
    writeFileSync(join(modules, "tsx", "package.json"), "{}");
    writeFileSync(
      join(primary, "package-lock.json"),
      JSON.stringify({
        name: "heroes-js",
        version: "0.53.7",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "heroes-js", version: "0.53.7" },
          "node_modules/tsx": { version: "4.23.1", resolved: "https://x/tsx.tgz", integrity: "sha512-abc" },
          "node_modules/gone": { version: "1.0.0", resolved: "https://x/gone.tgz", integrity: "sha512-def" },
        },
      }),
    );

    const result = repairHiddenLockfile(primary);
    assert.equal(result.repaired, true);
    assert.equal(result.entries, 1, "only the extracted package is recorded");
    assert.equal(result.missing, 1, "the locked-but-absent package is reported, not invented");

    const written = JSON.parse(readFileSync(join(modules, ".package-lock.json"), "utf8"));
    assert.equal(written.name, "heroes-js");
    assert.equal(written.version, "0.53.7");
    assert.equal(written.lockfileVersion, 3);
    assert.equal(written.requires, true);
    assert.deepEqual(Object.keys(written.packages), ["node_modules/tsx"], "npm's hidden lockfile drops the root entry");
    assert.deepEqual(
      written.packages["node_modules/tsx"],
      { version: "4.23.1", resolved: "https://x/tsx.tgz", integrity: "sha512-abc" },
      "the entry body is verbatim",
    );

    // Idempotent: npm's own file is never rewritten.
    assert.deepEqual(repairHiddenLockfile(primary), { repaired: false, entries: 0, missing: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a worktree whose shared install has .bin but no hidden lockfile still gets the lockfile repaired", () => {
  const dir = scratch("shared-lock-gone");
  try {
    const { primary, modules, worktree } = fakePrimary(dir); // .bin present, no hidden lockfile
    writeFileSync(
      join(primary, "package-lock.json"),
      JSON.stringify({
        name: "heroes-js",
        version: "0.1.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "heroes-js", version: "0.1.0" },
          "node_modules/tsx": { version: "4.23.1", resolved: "https://x/tsx.tgz", integrity: "sha512-x" },
        },
      }),
    );
    assert.equal(installState(modules), "partial", "launchers present, hidden lockfile gone -- the measured shape");
    assert.equal(launchersReady(modules), true, "so the launcher check alone would skip the repair");

    const result = ensureInstall(worktree, primary, () => {});
    assert.equal(result.how, "shared");
    assert.equal(existsSync(join(modules, ".package-lock.json")), true, "the lockfile is still repaired");
    assert.equal(installState(modules), "complete");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("npm's hidden lockfile is the tracked lock minus the root, filtered to what is installed", () => {
  const installRoot = join("C:", "repo");
  const lock = {
    name: "heroes-js",
    version: "9.9.9",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "heroes-js", version: "0.3.0" },
      "node_modules/a": { version: "1.0.0" },
      "node_modules/b": { version: "2.0.0" },
      "packages/contracts": { resolved: "packages/contracts", link: true },
    },
  };
  const installed = (p: string) => !/[\\/]node_modules[\\/]b$/.test(p);

  const out = hiddenLockfileFrom(lock, installRoot, installed);
  assert.ok(out);
  assert.equal(out!.name, "heroes-js");
  assert.equal(out!.version, "0.3.0", "the version is the install-time root entry, not the top-level field");
  assert.equal(out!.lockfileVersion, 3);
  assert.equal(out!.requires, true);
  assert.deepEqual(
    Object.keys(out!.packages),
    ["node_modules/a", "packages/contracts"],
    "the root entry is dropped, the absent package omitted, workspace entries kept",
  );

  assert.equal(hiddenLockfileFrom(null, installRoot, installed), null);
  assert.equal(hiddenLockfileFrom({ name: "x" }, installRoot, installed), null);
});
