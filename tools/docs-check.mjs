import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const errors = [];
const checkedLinks = new Set();
const checkedSourcePaths = new Set();
const today = new Date();
const todayIso = today.toISOString().slice(0, 10);

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
      else if (ageDays > MAX_AGE_DAYS) errors.push(`${relativeFile}: docs:verified date ${date} is ${ageDays} days old (limit ${MAX_AGE_DAYS})`);
    }
  }

  for (const target of markdownTargets(content)) {
    checkedLinks.add(`${relativeFile}:${target}`);
    const error = checkLocalLink(relativeFile, target);
    if (error) errors.push(error);
  }

  if (SOURCE_PATH_DOCS.includes(relativeFile)) {
    for (const sourcePath of sourcePaths(content)) {
      checkedSourcePaths.add(`${relativeFile}:${sourcePath}`);
      if (!fs.existsSync(path.join(ROOT, sourcePath))) {
        errors.push(`${relativeFile}: source path does not exist: ${sourcePath}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`docs:check failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `docs:check passed: ${MAINTAINED_DOCS.length} maintained docs, ${checkedLinks.size} local links, ${checkedSourcePaths.size} source paths; freshness limit ${MAX_AGE_DAYS} days (as of ${todayIso}).`,
  );
}
