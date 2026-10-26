import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_AGE_DAYS = 180;

// This allowlist is the maintained current-reference set. Timestamped plan and
// session-log archives are intentionally excluded from link and age scanning.
const MAINTAINED_DOCS = [
  "README.md",
  "AGENTS.md",
  "TECHNICAL_SPECIFICATIONS.MD",
  "docs/README.md",
  "docs/module-documentation-and-relationships.md",
  "docs/resources.md",
  "docs/resource-gathering.md",
  "docs/economy.md",
  "docs/multiplayer.md",
  "docs/heroes.md",
  "docs/settlements.md",
  "docs/army.md",
  "docs/event-system.md",
  "docs/plans-track-map.md",
  "docs/sprite-pipelines.md",
  "docs/player-guide.md",
  "docs/operations.md",
  "docs/asset-provenance.md",
  "src/render/docs/technical-spec.md",
  "src/render/scene/paint2d/README.md",
];

const SOURCE_PATH_DOCS = MAINTAINED_DOCS.filter((file) => file !== "docs/plans-track-map.md");
const SOURCE_PATH_RE = /(?<![\w.-])(?:src|server|packages|test|tools|scripts)\/[A-Za-z0-9_@.*+-]+(?:\/[A-Za-z0-9_@.*+-]+)*/g;
const LINK_RE = /!?\[[^\]]*\]\(\s*(<[^>]+>|(?:\\.|[^)\s])+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const LINK_DEFINITION_RE = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;

// Ownership map: which maintained doc must stay fresh when which source files
// change. Globs: `*` matches within one path segment, `**` matches any depth,
// `?` matches one character. Link and source-path checks always run for every
// maintained doc in every mode; this table only scopes the `docs:verified`
// marker-age enforcement. Docs not listed here are the umbrella indexes and
// the process doc — their marker age is enforced in full mode only.
const DOC_OWNERSHIP = {
  "docs/resources.md": [
    "packages/engine/src/economy/**",
    "packages/contracts/**",
    "src/managers/**",
  ],
  "docs/resource-gathering.md": [
    "packages/engine/src/economy/**",
    "packages/engine/src/map/**",
    "packages/contracts/**",
    "src/game/**",
    "src/managers/**",
    "src/state/**",
  ],
  "docs/economy.md": [
    "packages/engine/src/economy/**",
    "packages/engine/src/turn/**",
    "server/persistence/**",
    "src/state/**",
  ],
  "docs/multiplayer.md": [
    "server/auth.ts",
    "server/http/**",
    "server/telemetry/**",
    "server/persistence/**",
    "src/io/**",
    "src/players/**",
    "test/io/**",
    "test/server/**",
  ],
  "docs/heroes.md": [
    "packages/engine/src/hero/**",
    "packages/engine/src/ai/**",
    "src/ai/**",
    "src/map/**",
    "src/io/**",
  ],
  "docs/settlements.md": [
    "packages/engine/src/settlement/**",
    "packages/engine/src/turn/**",
    "server/migrations/**",
    "server/persistence/**",
    "src/entities/**",
    "src/game/**",
    "src/io/**",
  ],
  "docs/army.md": [
    "packages/engine/src/combat/**",
    "packages/engine/src/settlement/**",
    "src/data/**",
    "test/data/**",
  ],
  "docs/event-system.md": [
    "packages/contracts/**",
    "packages/engine/src/events/**",
    "src/managers/**",
    "src/debug/**",
    "src/game/**",
    "src/state/**",
  ],
  "docs/sprite-pipelines.md": [
    "tools/sprites/**",
    "src/resources/**",
    "src/data/**",
    "src/managers/**",
    "scripts/split-skybox-layers.ts",
    "test/render/**",
    "test/data/**",
    "test/engine/**",
    "test/helpers/**",
    "test/visual-baselines/**",
  ],
  "docs/asset-provenance.md": [
    "tools/sprites/**",
    "src/resources/**",
    "src/render/assetDescriptors.ts",
    "test/data/**",
  ],
  "docs/player-guide.md": [
    "src/screens/**",
    "src/state/**",
  ],
  "docs/operations.md": [
    "scripts/**",
    "tools/run-test.mjs",
    "tools/docs-check.mjs",
    "server/schema.sql",
    "server/app/**",
  ],
  "src/render/docs/technical-spec.md": [
    "src/render/**",
    "src/resources/**",
    "tools/sprites/**",
    "src/map/**",
    "src/entities/**",
    "test/render/**",
    "test/data/**",
    "test/engine/**",
    "test/visual-baselines/**",
  ],
  "src/render/scene/paint2d/README.md": [
    "src/render/**",
    "test/render/**",
    "test/engine/**",
  ],
};

function globToRegExp(glob) {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .split("\0")
    .join(".*");
  return new RegExp("^" + body + "$");
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
      console.error("usage: node tools/docs-check.mjs [--changed <path>]... [--changed-from <git-spec>]");
      process.exit(2);
    }
  }
  return { changed, changedFrom };
}

function verifyGitSpec(spec) {
  const parts = spec.split(/\.{2,3}/).filter(Boolean);
  if (!parts.length) return "empty revision spec";
  for (const part of parts) {
    if (part.startsWith("-")) return `option-like revision: ${part}`;
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${part}^{commit}`], {
        cwd: ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
    } catch {
      return `revision not found: ${part}`;
    }
  }
  return null;
}

function gitLinesOrExit(gitArgs) {
  try {
    const out = execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return out.split(/\r?\n/).map((line) => line.trim().replaceAll("\\", "/")).filter(Boolean);
  } catch (error) {
    console.error(`docs:check: git ${gitArgs.join(" ")} failed${Number.isFinite(error.status) ? ` (exit ${error.status})` : ""}`);
    process.exit(2);
  }
}

function gitIgnoredPaths(paths) {
  if (!paths.length) return new Set();
  try {
    const out = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      input: paths.join("\0") + "\0",
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    return new Set();
  }
}

function stripFencedCode(markdown) {
  let fence = null;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(`{3,}|~{3,})/);
      if (!fence && match) {
        fence = { marker: match[1][0], length: match[1].length };
        return "";
      }
      if (fence && match && match[1][0] === fence.marker && match[1].length >= fence.length) {
        fence = null;
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}

function markdownTargets(markdown) {
  const withoutFences = stripFencedCode(markdown).replace(/<!--[\s\S]*?-->/g, " ");
  const withoutInlineCode = withoutFences.replace(/(`+)([^`]*?)\1/g, (match) => " ".repeat(match.length));
  const targets = [];
  for (const match of withoutInlineCode.matchAll(LINK_RE)) {
    targets.push(match[1].replace(/^<|>$/g, ""));
  }
  for (const match of withoutInlineCode.matchAll(LINK_DEFINITION_RE)) {
    targets.push(match[1] ?? match[2]);
  }
  return targets;
}

function isArchiveTarget(target) {
  const normalized = target.replaceAll("\\", "/");
  return normalized.includes("/.plans/") || normalized.startsWith(".plans/") ||
    normalized.includes("/sessionTracking/") || normalized.startsWith("sessionTracking/");
}

function checkLocalLink(sourceFile, rawTarget) {
  const target = rawTarget.trim();
  if (!target || target.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) return null;
  if (isArchiveTarget(target)) return null;

  const withoutLine = target.replace(/:\d+(?:-\d+)?$/, "");
  const withoutAnchor = withoutLine.split(/[?#]/, 1)[0];
  if (!withoutAnchor) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutAnchor.replace(/^<|>$/g, ""));
  } catch {
    decoded = withoutAnchor;
  }
  const resolved = path.resolve(path.dirname(path.join(ROOT, sourceFile)), decoded);
  return fs.existsSync(resolved) ? null : `${sourceFile}: broken local link ${JSON.stringify(rawTarget)}`;
}

function sourcePaths(markdown) {
  const body = stripFencedCode(markdown);
  const paths = new Set();
  for (const match of body.matchAll(SOURCE_PATH_RE)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, "");
    if (!candidate || candidate.includes("*") || candidate.includes("..")) continue;
    paths.add(candidate);
  }
  return paths;
}

const args = parseArgs(process.argv.slice(2));
const selective = args.changed.length > 0 || args.changedFrom !== null;

const changedFiles = new Set(args.changed.map((p) => p.trim().replaceAll("\\", "/")).filter(Boolean));
if (args.changedFrom !== null) {
  const specError = verifyGitSpec(args.changedFrom);
  if (specError) {
    console.error(`docs:check: --changed-from ${JSON.stringify(args.changedFrom)}: ${specError}`);
    process.exit(2);
  }
  for (const file of gitLinesOrExit(["diff", "--name-only", args.changedFrom])) changedFiles.add(file);
  for (const file of gitLinesOrExit(["diff", "--name-only", "HEAD"])) changedFiles.add(file);
  for (const file of gitLinesOrExit(["ls-files", "--others", "--exclude-standard"])) changedFiles.add(file);
}

const OWNERSHIP_MATCHERS = new Map(
  Object.entries(DOC_OWNERSHIP).map(([doc, globs]) => [doc, globs.map(globToRegExp)]),
);

const enforcedDocs = new Set();
if (selective) {
  for (const file of changedFiles) {
    if (MAINTAINED_DOCS.includes(file)) enforcedDocs.add(file);
    for (const [doc, matchers] of OWNERSHIP_MATCHERS) {
      if (matchers.some((re) => re.test(file))) enforcedDocs.add(doc);
    }
  }
}

const errors = [];
const checkedLinks = new Set();
const checkedSourcePaths = new Set();
const today = new Date();
const todayIso = today.toISOString().slice(0, 10);

const sourcePathsByDoc = new Map();
const allSourcePaths = new Set();
for (const relativeFile of SOURCE_PATH_DOCS) {
  const absoluteFile = path.join(ROOT, relativeFile);
  if (!fs.existsSync(absoluteFile)) continue;
  const paths = [...sourcePaths(fs.readFileSync(absoluteFile, "utf8"))];
  sourcePathsByDoc.set(relativeFile, paths);
  for (const sourcePath of paths) allSourcePaths.add(sourcePath);
}
const ignoredPaths = gitIgnoredPaths([...allSourcePaths]);

for (const relativeFile of MAINTAINED_DOCS) {
  const absoluteFile = path.join(ROOT, relativeFile);
  if (!fs.existsSync(absoluteFile)) {
    errors.push(`${relativeFile}: maintained document is missing`);
    continue;
  }

  const content = fs.readFileSync(absoluteFile, "utf8");
  const markers = [...content.matchAll(/<!--\s*docs:verified\s+(\d{4}-\d{2}-\d{2})\s*-->/g)];
  if (markers.length !== 1) {
    errors.push(`${relativeFile}: expected exactly one <!-- docs:verified YYYY-MM-DD --> marker`);
  } else {
    const date = markers[0][1];
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      errors.push(`${relativeFile}: invalid docs:verified date ${date}`);
    } else {
      const ageDays = Math.floor((today.getTime() - parsed.getTime()) / 86_400_000);
      if (ageDays < 0) errors.push(`${relativeFile}: docs:verified date ${date} is in the future`);
      else if (ageDays > MAX_AGE_DAYS && (!selective || enforcedDocs.has(relativeFile))) {
        errors.push(`${relativeFile}: docs:verified date ${date} is ${ageDays} days old (limit ${MAX_AGE_DAYS})`);
      }
    }
  }

  for (const target of markdownTargets(content)) {
    checkedLinks.add(`${relativeFile}:${target}`);
    const error = checkLocalLink(relativeFile, target);
    if (error) errors.push(error);
  }

  if (SOURCE_PATH_DOCS.includes(relativeFile)) {
    for (const sourcePath of sourcePathsByDoc.get(relativeFile) ?? []) {
      checkedSourcePaths.add(`${relativeFile}:${sourcePath}`);
      if (ignoredPaths.has(sourcePath)) continue;
      if (!fs.existsSync(path.join(ROOT, sourcePath))) {
        errors.push(`${relativeFile}: source path does not exist: ${sourcePath}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`docs:check failed (${selective ? "selective" : "full"}, ${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else if (selective) {
  const enforcedList = [...enforcedDocs].sort();
  console.log(
    `docs:check passed (selective: ${changedFiles.size} changed file(s); freshness enforced for ${enforcedList.length} owned doc(s)${enforcedList.length ? ": " + enforcedList.join(", ") : ""}); ${MAINTAINED_DOCS.length} maintained docs, ${checkedLinks.size} local links, ${checkedSourcePaths.size} source paths; freshness limit ${MAX_AGE_DAYS} days (as of ${todayIso}).`,
  );
} else {
  console.log(
    `docs:check passed: ${MAINTAINED_DOCS.length} maintained docs, ${checkedLinks.size} local links, ${checkedSourcePaths.size} source paths; freshness limit ${MAX_AGE_DAYS} days (as of ${todayIso}).`,
  );
}
