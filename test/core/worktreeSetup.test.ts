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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  binEntries,
  collectInstalledBins,
  databaseNameForBranch,
  installState,
  launchersReady,
  primaryCheckout,
  renderShim,
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
