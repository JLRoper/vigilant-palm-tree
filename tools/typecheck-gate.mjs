#!/usr/bin/env node
// Type gate: the whole type check, with the test tree's pre-existing debt
// counted instead of hidden.
//
// WHY THIS EXISTS
// `npm run test:types` used to be a bare `tsc --noEmit -p tsconfig.test.json`.
// It has been red since the commit that introduced it (2026-10-11, 239 errors)
// and grew to 326 by 2026-11-02, because it was wired to nothing: not the
// pre-commit gate, not CI. A check that is red for 300+ reasons is not a
// check -- a genuine error introduced by a landing disappears into the wall.
//
// WHAT IT ASSERTS (both must hold)
//   1. The application -- src/, server/, packages/*/src, i.e. everything the
//      production build compiles (tsconfig.json) -- has ZERO type errors.
//      There is no baseline for this half. Zero tolerance.
//   2. The test tree (tsconfig.test.json: test/**) has no type error it did
//      not already have. The known debt lives in test/typecheck-baseline.json,
//      one entry per file with its dominant diagnostic codes and that file's
//      diagnosis. A file outside the baseline, or a file whose count grows,
//      fails the run.
//
// WHAT IT DOES NOT DO
// It does not exclude a directory, add ts-nocheck, or cast anything away. Every
// error the test tree has is still printed, and the debt total is printed on
// every run. The baseline is a ratchet, not a hiding place: it can only go
// down, and `npm run test:types:baseline` is how you record progress.
//
//   node tools/typecheck-gate.mjs                  # the gate
//   node tools/typecheck-gate.mjs --write-baseline # re-record the debt
//   node tools/typecheck-gate.mjs --list           # print the debt, exit 0 always

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(root, "test", "typecheck-baseline.json");

/** A short, factual diagnosis per dominant diagnostic code. */
const CODE_DIAGNOSIS = {
  TS18046: "reads a value the type layer reports as unknown (untyped event/row payload)",
  TS18048: "possibly-undefined access on a fixture",
  TS2531: "Object is possibly null on a fixture lookup",
  TS2532: "Object is possibly undefined on a fixture lookup",
  TS2322:
    "hand-built fixture (or returned shape) no longer assignable to the interface it names",
  TS2345: "argument shape drifted from the callee's signature",
  TS2339: "reads a property the interface renamed or moved",
  TS2551: "reads a property the interface renamed",
  TS2352: "cast between types the checker will not relate",
  TS2739: "fixture is missing required fields the interface gained",
  TS2740: "fixture is missing most of the properties the interface requires",
  TS2741: "fixture is missing a required field the interface gained",
  TS2353: "fixture sets a property the interface does not declare",
  TS2305: "imports a member that has moved out of that package",
  TS2459: "imports a member that is declared but not exported",
  TS2724: "imports a member the module no longer exports",
  TS2304: "references a name that is not in scope",
  TS7016: "depends on a module that ships no type declarations",
  TS7006: "callback parameter carries no annotation",
  TS2769: "no overload of the callee accepts this call",
  TS2554: "calls the callee with the wrong number of arguments",
  TS2367: "compares two types with no overlap",
  TS6133: "declares a local (or import) that is never read",
  TS6196: "declares an import that is never used",
  TS6198: "destructures elements that are never used",
  TS2571: "operates on a value of type unknown",
};

const TSC = require.resolve("typescript/bin/tsc");

function runTsc(project) {
  const res = spawnSync(process.execPath, [TSC, "--noEmit", "-p", project], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return { exitCode: res.status ?? 1, out };
}

function parseErrors(out) {
  const errors = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (m) errors.push({ file: m[1].replace(/\\/g, "/"), code: m[4], message: m[5] });
  }
  return errors;
}

function groupByFile(errors) {
  const byFile = new Map();
  for (const e of errors) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  return byFile;
}

function dominantCodes(list, limit = 3) {
  const counts = new Map();
  for (const e of list) counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code]) => code);
}

function buildBaseline(byFile) {
  const files = {};
  for (const file of [...byFile.keys()].sort()) {
    const list = byFile.get(file);
    const codes = dominantCodes(list);
    files[file] = {
      count: list.length,
      codes,
      diagnosis: CODE_DIAGNOSIS[codes[0]] ?? `dominant diagnostic ${codes[0]}`,
    };
  }
  return {
    _note:
      "Known type-check debt of test/**. Produced by `node tools/typecheck-gate.mjs --write-baseline`. " +
      "The gate fails if any file here grows, or if a file outside this list has an error. " +
      "Fix a file and re-record to shrink the debt; never add an entry to silence a regression.",
    generatedFromProject: "tsconfig.test.json",
    totalErrors: Object.values(files).reduce((n, f) => n + f.count, 0),
    filesWithErrors: Object.keys(files).length,
    files,
  };
}

function printDebt(baseline) {
  const entries = Object.entries(baseline.files).sort((a, b) => b[1].count - a[1].count);
  process.stdout.write(
    `\nTest-tree type debt: ${baseline.totalErrors} errors across ${entries.length} files ` +
      `(recorded)\n\n`,
  );
  for (const [file, info] of entries) {
    process.stdout.write(
      `  ${String(info.count).padStart(3)}  ${file}\n         ${info.diagnosis}  [${info.codes.join(", ")}]\n`,
    );
  }
}

function main() {
  const args = new Set(process.argv.slice(2));

  // ── Half 1: the application. Zero tolerance. ────────────────────────────
  const app = runTsc("tsconfig.json");
  const appErrors = parseErrors(app.out);
  if (appErrors.length > 0) {
    process.stdout.write(`APPLICATION TYPES: ${appErrors.length} error(s)\n`);
    process.stdout.write(app.out.endsWith("\n") ? app.out : `${app.out}\n`);
    process.stdout.write(
      "\nThe application must type-check clean (tsconfig.json). No baseline applies to this half.\n",
    );
    process.exit(1);
  }
  process.stdout.write("APPLICATION TYPES: clean (0 errors, tsconfig.json)\n");

  // ── Half 2: the test tree, ratcheted. ──────────────────────────────────
  const suite = runTsc("tsconfig.test.json");
  const suiteErrors = parseErrors(suite.out);
  const byFile = groupByFile(suiteErrors);

  if (args.has("--write-baseline")) {
    const baseline = buildBaseline(byFile);
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    process.stdout.write(
      `Recorded test-tree debt: ${suiteErrors.length} errors across ${byFile.size} files -> ` +
        `test/typecheck-baseline.json\n`,
    );
    process.exit(0);
  }

  if (!existsSync(BASELINE_PATH)) {
    process.stdout.write(suite.out.endsWith("\n") ? suite.out : `${suite.out}\n`);
    process.stdout.write(
      `\nNo baseline at test/typecheck-baseline.json. Run ` +
        `\`node tools/typecheck-gate.mjs --write-baseline\` once to record the current debt.\n`,
    );
    process.exit(2);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const regressions = [];
  const improvements = [];

  for (const [file, list] of byFile) {
    const known = baseline.files[file];
    if (!known) {
      regressions.push({ file, kind: "new file", now: list.length, was: 0 });
    } else if (list.length > known.count) {
      regressions.push({ file, kind: "grew", now: list.length, was: known.count });
    } else if (list.length < known.count) {
      improvements.push({ file, now: list.length, was: known.count });
    }
  }
  for (const [file, known] of Object.entries(baseline.files)) {
    if (!byFile.has(file)) improvements.push({ file, now: 0, was: known.count });
  }

  if (improvements.length > 0) {
    process.stdout.write("\nImproved since the baseline was recorded:\n");
    for (const i of improvements) {
      process.stdout.write(`  ${i.was} -> ${i.now}  ${i.file}\n`);
    }
    process.stdout.write(
      "  (run `npm run test:types:baseline` to record the smaller debt)\n",
    );
  }

  if (regressions.length > 0) {
    process.stdout.write("\nTEST TREE TYPES: regressions\n");
    for (const r of regressions) {
      process.stdout.write(`\n  ${r.was} -> ${r.now}  ${r.file}  (${r.kind})\n`);
      for (const e of byFile.get(r.file)) {
        process.stdout.write(`      ${e.file}: ${e.code} ${e.message}\n`);
      }
    }
    process.stdout.write(
      `\nThe test tree gained ${regressions.reduce((n, r) => n + (r.now - r.was), 0)} type error(s).\n` +
        "Fix them. Do not add a baseline entry to silence a regression.\n",
    );
    process.stdout.write(
      `\nTest-tree debt: ${suiteErrors.length} errors across ${byFile.size} files ` +
        `(baseline ${baseline.totalErrors} across ${baseline.filesWithErrors}).\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `TEST TREE TYPES: no regressions (${suiteErrors.length} known errors across ` +
      `${byFile.size} files, baseline ${baseline.totalErrors}).\n`,
  );
  if (args.has("--list")) printDebt(baseline);
  process.exit(0);
}

main();
