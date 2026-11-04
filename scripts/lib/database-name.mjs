// scripts/lib/database-name.mjs
//
// The ONE rule for a database name this repo creates, and the guard that
// recognises one.
//
// Why this module exists. Two sweeps of the shared `game_db` container have
// dropped 234 abandoned databases, and 18 of them were outside every naming
// rule the repo had written down: `game_wt_*`, `game_fix3_*`,
// `game_play_flip_*` and `game_play_meas_*`. Each of those was a per-tree
// database somebody named by hand (a `PGDATABASE` value like `game_fix3_all`)
// instead of through a naming rule, so a sweep could not tell it apart from a
// stranger's database and had to be hand-widened with four ad-hoc prefixes
// before it could recognise them as the repo's own (see
// `.agentboard/settlers-reports/wtgui-drop-the-abandoned-databases-6b7990.html`,
// "What the naming guard was widened to").
//
// The rule now lives here, in one place, and every path that names a database
// goes through it:
//
//   role                                    name                     named by
//   --------------------------------------  -----------------------  -----------------------------
//   the shared stack (dev + DEPLOYED)       `game_poc`               .env.example, .env.test
//   a worktree's own database               `game_poc_<slug>`        databaseNameForBranch()
//   the primary checkout's test database    `game_play_<tag>`        .env.test.local, by hand
//   a pod's own database                    `heroes_pod_<name>`      podDatabaseName()
//
// `isRepoDatabaseName(name)` is the guard: it accepts exactly those four
// families and nothing else, so a name the repo creates is one a sweep can
// recognise as its own. `repoDatabaseFamily()` says which family a name is in.
//
// Plain Node ESM with no imports: it is loaded by `scripts/worktree-setup.mjs`,
// which must run in a worktree that has no `node_modules` yet -- the very case
// that script exists for -- as well as by `scripts/pods.ts`,
// `tools/run-test.mjs` and the test tree.

/** The branches that ARE the shared checkout: they must not get a private database. */
export const PRIMARY_BRANCHES = ["main", "master"];

/** The shared database: the dev stack and the DEPLOYED stack both read it. */
export const SHARED_DB = "game_poc";

/** Every per-worktree database this repo creates carries this prefix. */
export const WORKTREE_DB_PREFIX = "game_poc_";

/** The primary checkout's own test database. */
export const PLAY_DB_PREFIX = "game_play_";

/** A pod's own database (its own container, not the shared one). */
export const POD_DB_PREFIX = "heroes_pod_";

/**
 * Postgres truncates identifiers at 63 bytes, and `game_poc_` is 9 of them, so
 * the slug is capped here and the whole name stays inside 63.
 */
export const SLUG_LIMIT = 40;

/**
 * A slug: lowercased, runs of non-alphanumerics collapsed to `_`, trimmed, so
 * it can neither start nor end with `_` nor carry two in a row. The lookahead
 * holds it to 40 characters -- SLUG_LIMIT, the same cap `slugForBranch` applies,
 * which keeps the whole name inside Postgres' 63 bytes. Spelled out for the same
 * reason the prefixes below are: a bound read back off the producer would move
 * with it.
 */
const SLUG = "(?=.{1,40}$)[a-z0-9]+(?:_[a-z0-9]+)*";

/**
 * The tag on a `game_play_` name: the documented shape is a hex worktree tag
 * (`game_play_ff7804`), and four hex characters is the shortest seen on this
 * box (`game_play_d4a1`). A hand-picked lowercase tag is the same family, so
 * the rule is "one alphanumeric run of four or more" rather than a strict
 * 6-hex match -- a strict one would have called a real database a stranger.
 */
const PLAY_TAG = "[a-z0-9]{4,}";

/**
 * A pod name: `scripts/pods.ts`'s NAME_RE (`^[a-z0-9][a-z0-9_-]{0,23}$`) with
 * `-` rewritten to `_` by `podDatabaseName`, so an underscore may sit anywhere
 * after the first character, including at the end.
 */
const POD_NAME = "[a-z0-9][a-z0-9_]{0,23}";

/**
 * The accepted shapes, in the order a reader meets them. `family` is what
 * `repoDatabaseFamily()` answers; `role` is who names such a database;
 * `display` is the shape as a person writes it (docs, a warning); `pattern` is
 * the anchored regex the guard tests; `example` is a real name of that family.
 *
 * The prefixes in `pattern` are SPELLED OUT, not interpolated from the
 * constants above, and that is the point: the constants are what the naming
 * functions build a name from, so a pattern that read them back would accept
 * whatever they were changed to -- the guard would move with the rule and
 * notice nothing. Written out, the guard is an independent statement of the
 * shapes the docs and `.env.example` name, and a change of prefix has to be
 * made twice, on purpose, in the same commit. `test/core/databaseNaming.test.ts`
 * pins both halves against each other.
 */
export const NAME_FAMILIES = [
  {
    family: "shared",
    role: "the shared stack (dev + the DEPLOYED stack)",
    display: "game_poc",
    pattern: "^game_poc$",
    example: "game_poc",
  },
  {
    family: "worktree",
    role: "a worktree's own database",
    display: "game_poc_<branch-slug>",
    pattern: `^game_poc_${SLUG}$`,
    example: "game_poc_wtgui_a_fresh_worktree_arrives_f9c70c",
  },
  {
    family: "play",
    role: "the primary checkout's test database",
    display: "game_play_<tag>",
    pattern: `^game_play_${PLAY_TAG}$`,
    example: "game_play_ff7804",
  },
  {
    family: "pod",
    role: "a pod's own database (its own container)",
    display: "heroes_pod_<pod-name>",
    pattern: `^heroes_pod_${POD_NAME}$`,
    example: "heroes_pod_pod_9f2c1a",
  },
];

/**
 * A documented placeholder, as it appears in the docs and the tooling's own
 * usage text: `game_poc_<branch-slug>`, `game_play_<hex>`, `heroes_pod_<name>`.
 * A placeholder names a shape, never a database, so it is not a name the guard
 * has to accept -- but a scan of the repo's prose has to know one when it sees
 * one. `<` or `>` anywhere makes it a placeholder; the value after it is not
 * checked.
 */
export const PLACEHOLDER_RE = /[<>]/;

/**
 * The per-worktree slug, and the ONLY rule in the repo that turns a branch into
 * a database name. Lowercased branch, every run of non-alphanumerics to `_`,
 * trimmed, capped at 40 so the identifier stays inside Postgres' 63-byte limit.
 *
 * `wtgui/a-fresh-worktree-arrives-f9c70c` -> `wtgui_a_fresh_worktree_arrives_f9c70c`
 */
export function slugForBranch(branch) {
  const slug = String(branch ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "wt";
  return slug.slice(0, SLUG_LIMIT);
}

/** `game_poc_<slug>` for a worktree branch; `null` for `main`/`master` (the shared checkout). */
export function databaseNameForBranch(branch) {
  const name = String(branch ?? "").trim().toLowerCase();
  if (PRIMARY_BRANCHES.includes(name)) return null;
  return WORKTREE_DB_PREFIX + slugForBranch(branch);
}

/** `heroes_pod_<name>` for a pod: the pod name's `-` become `_`. */
export function podDatabaseName(podName) {
  return `${POD_DB_PREFIX}${String(podName ?? "").replace(/-/g, "_")}`;
}

/** Which family a name belongs to, or `null` when it is not one of ours. */
export function repoDatabaseFamily(name) {
  const value = String(name ?? "").trim();
  for (const entry of NAME_FAMILIES) {
    if (new RegExp(entry.pattern).test(value)) return entry.family;
  }
  return null;
}

/** The guard: is this a database name this repo creates (and a sweep may claim as its own)? */
export function isRepoDatabaseName(name) {
  return repoDatabaseFamily(name) !== null;
}

/** A documented placeholder rather than a name -- see PLACEHOLDER_RE. */
export function isPlaceholderName(value) {
  return PLACEHOLDER_RE.test(String(value ?? ""));
}

/**
 * The accepted shapes as text, for a warning or a refusal to quote. One shape
 * per line, each with the role that names it.
 */
export function acceptedNameShapes() {
  return NAME_FAMILIES.map((f) => `${f.display}  (${f.role})`);
}

/**
 * What a run should say about its `PGDATABASE`, or `null` when there is nothing
 * to say. Both callers that aim a run at a database quote this -- the suite
 * wrapper (`tools/run-test.mjs`) and the by-hand probes' env guard
 * (`test/_envGuard.ts`) -- so the wording, and the decision, are pinned in one
 * place.
 *
 * A name this repo creates says nothing here: `game_poc` is the SHARED database
 * and each caller warns about that in its own words, because the consequence
 * differs (the suites delete games; a probe writes a game).
 *
 * A name the repo does NOT create is the case this exists for. The run is not
 * refused -- a person may deliberately aim at a database this repo did not
 * create -- but it is said out loud, because a database the repo creates and
 * the repo's own guard cannot recognise is one a sweep has to hand-widen for,
 * which is how `game_wt_*`, `game_fix3_*`, `game_play_flip_*` and
 * `game_play_meas_*` accumulated until two sweeps cleared them.
 */
export function databaseNameWarning(name) {
  const value = String(name ?? "").trim();
  if (!value || isRepoDatabaseName(value)) return null;
  return (
    `PGDATABASE=${value} is not a name this repo creates, so a sweep cannot tell it apart from a stray. ` +
    `Accepted shapes: ${acceptedNameShapes().join("; ")}`
  );
}
