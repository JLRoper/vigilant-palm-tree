// The repo's database-naming rule, pinned.
//
// Two sweeps of the shared `game_db` container have dropped 234 abandoned
// databases, and 18 of them were outside every naming rule the repo had written
// down: `game_wt_*`, `game_fix3_*`, `game_play_flip_*`, `game_play_meas_*`.
// Each was a per-tree database named by hand instead of through a rule, so the
// sweep could not tell it apart from a stranger's database and had to be
// hand-widened with four ad-hoc prefixes to recognise them (see
// `.agentboard/settlers-reports/wtgui-drop-the-abandoned-databases-6b7990.html`,
// "What the naming guard was widened to").
//
// `scripts/lib/database-name.mjs` is now the one place the rule lives, and this
// file is the tripwire that keeps the tooling and the guard in step:
//
//   * every naming path the repo has produces a name the guard accepts;
//   * the guard accepts the four families and rejects the shapes the sweeps had
//     to hand-widen for;
//   * no `PGDATABASE`/`POSTGRES_DB`/`POD_DB_NAME` value written anywhere in the
//     repo -- tooling, docs, env templates -- is outside the accepted patterns.
//     That last one is the point of the whole exercise: a NEW naming path that
//     escapes the rule fails here instead of leaving a database behind for a
//     sweep to find.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import {
  acceptedNameShapes,
  databaseNameForBranch,
  databaseNameWarning,
  isPlaceholderName,
  isRepoDatabaseName,
  NAME_FAMILIES,
  POD_DB_PREFIX,
  podDatabaseName,
  repoDatabaseFamily,
  SHARED_DB,
  slugForBranch,
  WORKTREE_DB_PREFIX,
} from "../../scripts/lib/database-name.mjs";
import { databaseNameForBranch as databaseNameForBranchViaSetup, slugForBranch as slugForBranchViaSetup } from "../../scripts/worktree-setup.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// ---------------------------------------------------------------------------
// 1. Every naming path the repo has, and the shapes each can produce.
// ---------------------------------------------------------------------------

/**
 * The branches that must name a database, including the ones that produced the
 * strays: `wtgui/...` (the fleet's branch shape), a `wt/` branch, a `fix3/`
 * branch -- i.e. the slugs `game_poc_wt_*` / `game_poc_fix3_*` would have had
 * if they had gone through the rule instead of being typed by hand.
 */
const BRANCHES = [
  "wtgui/widen-the-fixture-naming-e15607",
  "wtgui/a-fresh-worktree-arrives-f9c70c",
  "feat/add-a-thing",
  "Feat/Add A Thing",
  "wt/fix3/red-visual",
  "fix3/all",
  "///",
  "",
  "x".repeat(80),
];

const POD_NAMES = ["pod-9f2c1a", "wtgui-a-fresh-workt", "my-pod", "a".repeat(24), "x-"];

/**
 * The documented shapes, restated here as literals rather than read off the
 * module's constants. That is deliberate: a test that only asked the guard about
 * a name the producers built would move with them and never notice a change of
 * prefix. These are what the docs and `.env.example` say a name looks like, and
 * a naming path that stops producing one fails here.
 */
const WORKTREE_SHAPE = /^game_poc_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const POD_SHAPE = /^heroes_pod_[a-z0-9][a-z0-9_]{0,23}$/;

test("every naming path the repo has produces a name the guard accepts", () => {
  for (const branch of BRANCHES) {
    const name = databaseNameForBranch(branch);
    if (name === null) continue;
    assert.match(name, WORKTREE_SHAPE, `databaseNameForBranch(${JSON.stringify(branch)}) produced ${name}`);
    assert.ok(
      isRepoDatabaseName(name),
      `databaseNameForBranch(${JSON.stringify(branch)}) produced ${name}, which the guard rejects`,
    );
    assert.equal(repoDatabaseFamily(name), "worktree");
    assert.ok(name.length <= 63, `${name} is ${name.length} bytes, over Postgres' 63-byte identifier limit`);
  }

  for (const pod of POD_NAMES) {
    const name = podDatabaseName(pod);
    assert.match(name, POD_SHAPE, `podDatabaseName(${JSON.stringify(pod)}) produced ${name}`);
    assert.ok(
      isRepoDatabaseName(name),
      `podDatabaseName(${JSON.stringify(pod)}) produced ${name}, which the guard rejects`,
    );
    assert.equal(repoDatabaseFamily(name), "pod");
  }

  // The two names the repo does not produce, because they are the shared stack's.
  assert.equal(databaseNameForBranch("main"), null);
  assert.equal(databaseNameForBranch("master"), null);
  assert.ok(isRepoDatabaseName("game_poc"), "the shared database is the repo's own name");
});

test("the rule lives in ONE module: worktree-setup re-exports it rather than re-implementing it", () => {
  assert.equal(databaseNameForBranchViaSetup, databaseNameForBranch);
  assert.equal(slugForBranchViaSetup, slugForBranch);
  assert.equal(slugForBranch("wtgui/a-fresh-worktree-arrives-f9c70c"), "wtgui_a_fresh_worktree_arrives_f9c70c");
});

test("the naming constants and the accepted patterns agree, so a prefix cannot be changed on one side only", () => {
  // The guard's patterns spell their prefixes out (see NAME_FAMILIES); the
  // producers build from these constants. This is the joint between them.
  assert.equal(SHARED_DB, "game_poc");
  assert.equal(WORKTREE_DB_PREFIX, "game_poc_");
  assert.equal(POD_DB_PREFIX, "heroes_pod_");
  assert.equal(databaseNameForBranch("x"), `${WORKTREE_DB_PREFIX}x`);
  assert.equal(podDatabaseName("x"), `${POD_DB_PREFIX}x`);
  assert.ok(isRepoDatabaseName(SHARED_DB));
  assert.ok(isRepoDatabaseName(`${WORKTREE_DB_PREFIX}${slugForBranch("wtgui/x")}`));
  assert.ok(isRepoDatabaseName(podDatabaseName("pod-9f2c1a")));
});

// ---------------------------------------------------------------------------
// 2. The guard: four families in, everything else out.
// ---------------------------------------------------------------------------

test("the guard accepts the four families the repo can create", () => {
  // Real names, measured on this box 2026-11-04 (docker exec game_db psql).
  const accepted: Array<[string, string]> = [
    ["game_poc", "shared"],
    ["game_poc_wtgui_a_fresh_worktree_arrives_f9c70c", "worktree"],
    ["game_poc_the_manual_fight_pla", "worktree"],
    ["game_poc_three_stepper", "worktree"],
    ["game_poc_feat_population_workforce", "worktree"],
    ["game_play_ff7804", "play"],
    ["game_play_bf69b3", "play"],
    ["game_play_983126", "play"],
    ["game_play_d4a1", "play"],
    ["game_play_mine", "play"],
    ["heroes_pod_pod_9f2c1a", "pod"],
    ["heroes_pod_wtgui_a_fresh_wt", "pod"],
  ];
  for (const [name, family] of accepted) {
    assert.equal(repoDatabaseFamily(name), family, `${name} should be a ${family} name`);
  }
});

test("the guard rejects the shapes two sweeps had to hand-widen for, and anything else", () => {
  // Every name below is real: the first four are the families the sweep of
  // 2026-11-04 had to add to its guard by hand, and the rest are shapes no
  // rule in this repo produces.
  const rejected = [
    "game_wt_res_2a3d31",
    "game_wt_archery_b4cc82af",
    "game_fix3_all",
    "game_fix3_unit",
    "game_play_flip_post",
    "game_play_flip_pre",
    "game_play_meas_visual",
    "game_play_meas_districts",
    "game_play_bf69b3_2",
    "game_poc_",
    "game_poc__x",
    "game_poc_x_" + "x".repeat(60),
    "game",
    "game_events",
    "game_db",
    "heroes_pod_",
    "heroes_pod_Upper",
    "postgres",
    "template1",
    "",
  ];
  for (const name of rejected) {
    assert.equal(
      isRepoDatabaseName(name),
      false,
      `${JSON.stringify(name)} is not a name this repo creates, so the guard must not claim it`,
    );
  }
});

test("the accepted shapes are stated once, and name the role that produces each", () => {
  const shapes = acceptedNameShapes();
  assert.equal(shapes.length, NAME_FAMILIES.length);
  assert.deepEqual(
    NAME_FAMILIES.map((f) => f.family),
    ["shared", "worktree", "play", "pod"],
  );
  for (const entry of NAME_FAMILIES) {
    assert.ok(isRepoDatabaseName(entry.example), `${entry.example} is the ${entry.family} family's own example`);
    assert.ok(shapes.some((line) => line.includes(entry.display)), `the shape list names ${entry.display}`);
  }
  // A documented placeholder names a shape, never a database.
  assert.equal(isPlaceholderName("game_poc_<branch-slug>"), true);
  assert.equal(isPlaceholderName("game_play_<hex>"), true);
  assert.equal(isPlaceholderName("heroes_pod_<name>"), true);
  assert.equal(isPlaceholderName("game_poc_wt_x"), false);
});

// ---------------------------------------------------------------------------
// 3. The tripwire: no database name written down anywhere escapes the rule.
// ---------------------------------------------------------------------------

test("the run-time warning quotes the accepted shapes, and stays silent for the repo's own names", () => {
  // Silent: a name the repo creates, and an unset one. `game_poc` is silent
  // here on purpose -- the shared database gets its own, more specific warning
  // from each caller (the suites delete games; a probe writes one).
  for (const ok of [undefined, null, "", "  ", "game_poc", "game_poc_wtgui_x", "game_play_ff7804", "heroes_pod_pod_9f2c1a"]) {
    assert.equal(databaseNameWarning(ok), null, `${JSON.stringify(ok)} should not warn`);
  }

  for (const stray of ["game_fix3_all", "game_wt_res_2a3d31", "game_play_meas_visual", "game_play_flip_post"]) {
    const warning = databaseNameWarning(stray);
    assert.ok(warning, `${stray} should be warned about`);
    assert.match(warning as string, new RegExp(`PGDATABASE=${stray}`));
    assert.match(warning as string, /is not a name this repo creates/);
    for (const shape of acceptedNameShapes()) {
      assert.ok((warning as string).includes(shape), `the warning names the shape ${shape}`);
    }
  }
});

/** Every path the repo writes a database name into: tooling, docs, env templates. */
const SCAN_DIRS = ["scripts", "tools", "server", "test", "docs", "docker", ".kilo", ".github"];
const SCAN_FILES = [".env.example", ".env.test", "AGENTS.md", "README.md", "docker-compose.yml"];
const SCAN_EXTENSIONS = [".ts", ".mts", ".mjs", ".js", ".ps1", ".sql", ".md", ".yml", ".yaml"];

/** `PGDATABASE=game_poc`, `POSTGRES_DB: game_poc`, `POD_DB_NAME=...` -- and the `?? "game_poc"` fallback. */
const ASSIGNMENT_RE = /(?<![\w${])(PGDATABASE|POSTGRES_DB|POD_DB_NAME)[ \t]*[=:][ \t]*([^\s"'`#,)]+)/g;
const FALLBACK_RE = /(?:PGDATABASE|POSTGRES_DB|POD_DB_NAME)\s*\?\?\s*"([A-Za-z0-9_]+)"/g;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) yield path;
  }
}

function scanTargets(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    try {
      files.push(...walk(join(ROOT, dir)));
    } catch {
      // A directory this checkout does not carry is not a failure.
    }
  }
  for (const file of SCAN_FILES) {
    try {
      readFileSync(join(ROOT, file));
      files.push(join(ROOT, file));
    } catch {
      // Same.
    }
  }
  return files;
}

test("no database name written anywhere in the repo escapes the accepted patterns", () => {
  const offenders: string[] = [];
  let checked = 0;

  for (const file of scanTargets()) {
    const text = readFileSync(file, "utf8");
    const where = relative(ROOT, file).replace(/\\/g, "/");
    for (const re of [ASSIGNMENT_RE, FALLBACK_RE]) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const value = match[match.length - 1];
        // Only a bare lowercase identifier can be a database name. Anything
        // else here is a placeholder (`game_poc_<branch-slug>`), a variable
        // (`${db}`), a JS constant (`PGDATABASE: DB_NAME`) or code
        // (`podDatabaseName(name`), none of which names a database.
        if (!/^[a-z0-9_]+$/.test(value)) continue;
        checked += 1;
        if (!isRepoDatabaseName(value)) {
          const line = text.slice(0, match.index).split(/\r?\n/).length;
          offenders.push(`${where}:${line}  ${value}`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these name a database the repo's own guard does not recognise, so a sweep could not claim them:\n" +
      offenders.join("\n") +
      "\n\nAccepted shapes:\n" +
      acceptedNameShapes().join("\n"),
  );
  // The scan has to have looked at something: a rename or a broken glob would
  // otherwise make this pass by finding nothing at all.
  assert.ok(checked >= 15, `only ${checked} database names were found in the repo; the scan is not seeing the tooling`);
});
