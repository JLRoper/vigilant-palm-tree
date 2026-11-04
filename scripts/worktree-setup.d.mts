/**
 * Types for scripts/worktree-setup.mjs, consumed from the TypeScript test tree
 * (test/core/worktreeSetup.test.ts). The script itself is plain Node ESM so it
 * can run in a worktree that has no `node_modules` yet -- the very case it
 * exists for -- so it has no build step and needs this hand-written surface.
 */

/** Branches that ARE the shared checkout and must not get a private database. */
export declare const PRIMARY_BRANCHES: string[];

/** Lowercased branch, non-alphanumerics to `_`, trimmed, capped at 40. */
export declare function slugForBranch(branch: string): string;

/** `game_poc_<slug>` for a worktree branch; `null` for `main`/`master`. */
export declare function databaseNameForBranch(branch: string): string | null;

export interface WithDatabaseKeyOptions {
  /** true only when the text is a fresh `.env.example` copy, whose shared `game_poc` must be rewritten. */
  replace?: boolean;
}

export declare function withDatabaseKey(envText: string, name: string | null, options?: WithDatabaseKeyOptions): string;

/** `absent` (no directory), `partial` (packages extracted, launchers gone), `complete`. */
export declare function installState(modulesDir: string): "absent" | "partial" | "complete";

/** Whether the install's `.bin` carries the commands the package scripts invoke. */
export declare function launchersReady(modulesDir: string): boolean;

export interface BinEntry {
  name: string;
  target: string;
}

export declare function binEntries(
  pkgJson: { name?: string; bin?: string | Record<string, string> } | null | undefined,
): BinEntry[];

/** npm's own launcher body for a `bin` target, relative to `node_modules/.bin`. */
export declare function renderShim(kind: "sh" | "cmd" | "ps1", target: string): string;

/** The primary checkout that owns the shared `node_modules` and `.git`. */
export declare function primaryCheckout(): string | null;

/** Every command npm would link for the packages extracted under `modulesDir`. */
export declare function collectInstalledBins(modulesDir: string): BinEntry[];

/** Regenerate a missing `node_modules/.bin` from the extracted packages. Additive. */
export declare function repairShims(
  modulesDir: string,
  log?: (message: string) => void,
): { repaired: boolean; written: number };

export declare function run(
  argv?: string[],
  options?: { root?: string },
): number;
