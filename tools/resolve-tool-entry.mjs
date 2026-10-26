// Resolve a workspace dependency's CLI entry script to an absolute path.
//
// Why this exists: on Windows a child started with `shell: true` goes through
// `cmd.exe`, and a `cmd.exe` that does not inherit a console ALLOCATES one --
// which is a visible console window that takes the foreground. Spawning the
// tool's JavaScript entry with `process.execPath` instead removes the shell
// from the chain entirely, so no console is ever created (and no `npx.cmd`
// shim either). `windowsHide: true` is still set at every call site as
// belt-and-braces for the paths that must keep a shell.
//
// `tsx` exports its CLI, but `vite` and `dependency-cruiser` do not, so the
// entry is read from the package's own `bin` field rather than hardcoded.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const BIN_KEYS = {
  "dependency-cruiser": "depcruise",
};

/** Directory of the installed `pkg` (some packages export neither main nor ./package.json). */
function packageRoot(pkg) {
  // Walk up looking for node_modules/<pkg>, the way Node itself resolves.
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "node_modules", pkg);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    dir = dirname(dir);
  }
  try {
    return dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    // Fall through to resolving the package's main entry.
  }
  let from = dirname(require.resolve(pkg));
  while (from !== dirname(from)) {
    const candidate = join(from, "package.json");
    if (existsSync(candidate)) {
      try {
        if (JSON.parse(readFileSync(candidate, "utf8")).name === pkg) return from;
      } catch {}
    }
    from = dirname(from);
  }
  throw new Error(`could not locate the installed package root for ${pkg}`);
}

/** Absolute path to `pkg`'s CLI entry script. */
export function toolEntry(pkg) {
  const root = packageRoot(pkg);
  const pkgJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const binField = pkgJson.bin;
  const bin =
    typeof binField === "string"
      ? binField
      : binField?.[BIN_KEYS[pkg] ?? pkg] ?? Object.values(binField ?? {})[0];
  if (!bin) throw new Error(`no bin entry found in ${join(root, "package.json")}`);
  return join(root, bin);
}

/**
 * The `{ cmd, args }` pair that runs `pkg`'s CLI without a shell. Use with
 * `spawn(cmd, args, { windowsHide: true, ... })`.
 */
export function nodeToolCommand(pkg, args = []) {
  return { cmd: process.execPath, args: [toolEntry(pkg), ...args] };
}

/**
 * Translates the repo's legacy `npx <tool> ...` spawn arguments into the
 * shell-free equivalent. Returns null for anything that is not a known
 * workspace tool, so callers can fall back to their original command.
 */
export function resolveNpxInvocation(cmd, args) {
  const isNpx = cmd === "npx" || cmd === "npx.cmd";
  if (!isNpx || args.length === 0) return null;
  const known = ["tsx", "vite", "concurrently", "depcruise", "dependency-cruiser", "tsc", "typescript"];
  const tool = args[0];
  if (!known.includes(tool)) return null;
  const pkg = tool === "depcruise" ? "dependency-cruiser" : tool === "tsc" ? "typescript" : tool;
  try {
    return nodeToolCommand(pkg, args.slice(1));
  } catch {
    return null;
  }
}
