/**
 * Types for scripts/lib/database-name.mjs, consumed from the TypeScript test
 * tree (test/core/databaseNaming.test.ts, test/_envGuard.ts). The module itself
 * is plain Node ESM with no imports so it can load in a worktree that has no
 * `node_modules` yet -- the case `scripts/worktree-setup.mjs` exists for -- so
 * it has no build step and needs this hand-written surface.
 */

/** Branches that ARE the shared checkout and must not get a private database. */
export declare const PRIMARY_BRANCHES: string[];

/** The shared database: the dev stack and the DEPLOYED stack both read it. */
export declare const SHARED_DB: string;

/** Every per-worktree database this repo creates carries this prefix. */
export declare const WORKTREE_DB_PREFIX: string;

/** The primary checkout's own test database. */
export declare const PLAY_DB_PREFIX: string;

/** A pod's own database (its own container, not the shared one). */
export declare const POD_DB_PREFIX: string;

/** Postgres' 63-byte identifier limit minus `game_poc_`, in characters. */
export declare const SLUG_LIMIT: number;

/** A documented placeholder (`game_poc_<branch-slug>`) rather than a real name. */
export declare const PLACEHOLDER_RE: RegExp;

export interface NameFamily {
  /** `shared` | `worktree` | `play` | `pod` */
  family: string;
  /** Who names such a database. */
  role: string;
  /** The shape as a person writes it: `game_poc_<branch-slug>`. */
  display: string;
  /** The anchored regex source the guard tests. */
  pattern: string;
  /** A real name of that family. */
  example: string;
}

export declare const NAME_FAMILIES: NameFamily[];

/** Lowercased branch, non-alphanumerics to `_`, trimmed, capped at 40. */
export declare function slugForBranch(branch: string): string;

/** `game_poc_<slug>` for a worktree branch; `null` for `main`/`master`. */
export declare function databaseNameForBranch(branch: string): string | null;

/** `heroes_pod_<name>` for a pod: the pod name's `-` become `_`. */
export declare function podDatabaseName(podName: string): string;

/** Which family a name belongs to, or `null` when it is not one of ours. */
export declare function repoDatabaseFamily(name: string): string | null;

/** The guard: is this a database name this repo creates? */
export declare function isRepoDatabaseName(name: string): boolean;

/** A documented placeholder rather than a name. */
export declare function isPlaceholderName(value: string): boolean;

/** The accepted shapes as text, one per line, each with its role. */
export declare function acceptedNameShapes(): string[];

/** What to say about a run's `PGDATABASE`, or `null` when it is a name this repo creates (or unset). */
export declare function databaseNameWarning(name: string | undefined | null): string | null;
