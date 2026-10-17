import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NON_GAME_GLOBS = [
  "**/*.md",
  "**/*.MD",
  "docs/**",
  "analysis/**",
  "reviews/**",
  "feature-plans/**",
  "sessionTracking/**",
  "local/**",
  ".kilo/**",
  ".claude/**",
  ".agentboard/**",
  ".plans/**",
  ".github/agents/**",
  ".github/hooks/**",
  ".github/prompts/**",
  ".github/skills/**",
  "scripts/hooks/**",
  "LICENSE",
];

function globToRegExp(glob) {
  let body = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        body += "(?:.*/)?";
        i += 2;
      } else {
        body += ".*";
        i += 1;
      }
    } else if (ch === "*") {
      body += "[^/]*";
    } else if (ch === "?") {
      body += "[^/]";
    } else {
      body += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + body + "$");
}

const NON_GAME_RES = NON_GAME_GLOBS.map(globToRegExp);

export function isGameCode(file) {
  return !NON_GAME_RES.some((re) => re.test(file));
}

function parseArgs(argv) {
  const changed = [];
  let changedFrom = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--changed") {
      if (i + 1 >= argv.length) {
        console.error("--changed requires a path argument");
        process.exit(2);
      }
      changed.push(argv[++i]);
    } else if (arg === "--changed-from") {
      if (i + 1 >= argv.length) {
        console.error("--changed-from requires a git spec argument");
        process.exit(2);
      }
      changedFrom = argv[++i];
      if (changedFrom.startsWith("-")) {
        console.error(`--changed-from looks like an option, not a revision spec: ${changedFrom}`);
        process.exit(2);
      }
    } else {
      console.error(`unknown argument: ${arg}`);
      console.error("usage: node tools/test-scope.mjs [--changed <path>]... [--changed-from <git-spec>]");
      process.exit(2);
    }
  }
  return { changed, changedFrom };
}

function gitLines(gitArgs) {
  const out = execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return out.split(/\r?\n/).map((line) => line.trim().replaceAll("\\", "/")).filter(Boolean);
}

function isVersionOnlyDiff(file, specs) {
  try {
    const lines = specs.flatMap((spec) =>
      execFileSync("git", ["diff", "-U0", spec, "--", file], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/),
    );
    const edits = lines.filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
    return edits.length > 0 && edits.every((line) => /^[+-]\s*"version"\s*:/.test(line));
  } catch {
    return false;
  }
}

function report(runTests, reason, gameFiles) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) fs.appendFileSync(githubOutput, `run_tests=${runTests}\n`);
  console.log(`${runTests ? "TESTS REQUIRED" : "TESTS SKIPPED"}: ${reason}`);
  for (const file of gameFiles.slice(0, 20)) console.log(`  game code: ${file}`);
  if (gameFiles.length > 20) console.log(`  ... and ${gameFiles.length - 20} more`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = new Set(args.changed.map((p) => p.trim().replaceAll("\\", "/")).filter(Boolean));

  if (args.changedFrom === null && changedFiles.size === 0) {
    report(true, "no changeset given (full run)", []);
    process.exit(0);
  }

  if (args.changedFrom !== null) {
    try {
      for (const file of gitLines(["diff", "--name-only", args.changedFrom])) changedFiles.add(file);
      for (const file of gitLines(["diff", "--name-only", "HEAD"])) changedFiles.add(file);
      for (const file of gitLines(["ls-files", "--others", "--exclude-standard"])) changedFiles.add(file);
    } catch {
      report(true, `could not diff against ${args.changedFrom} (failing safe)`, []);
      process.exit(0);
    }
  }

  if (changedFiles.size === 0) {
    report(true, "empty changeset (failing safe)", []);
    process.exit(0);
  }

  const gameFiles = [...changedFiles]
    .filter(isGameCode)
    .filter((file) => !(file === "package.json" && args.changedFrom !== null && isVersionOnlyDiff(file, [args.changedFrom, "HEAD"])))
    .sort();
  if (gameFiles.length > 0) {
    report(true, `${gameFiles.length} of ${changedFiles.size} changed file(s) are game code`, gameFiles);
  } else {
    report(false, `all ${changedFiles.size} changed file(s) are docs or agent files`, []);
  }
}
