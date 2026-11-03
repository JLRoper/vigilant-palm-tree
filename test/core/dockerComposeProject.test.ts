import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pin for the shared stack's compose project name (docker-compose.yml, top-level
// `name:`).
//
// Compose derives the project name from the directory it is invoked in unless
// something outranks that (a `-p` flag, COMPOSE_PROJECT_NAME, or the file's own
// `name:`). The shared stack lives in the PRIMARY checkout's directory
// (`heroes-js`), but `npm run docker:deploy` -- `docker compose up -d
// --remove-orphans api web` -- is run from whatever worktree the card is in.
// From a worktree the derived project was the worktree's directory name, so the
// deploy created a second, empty project: its own network, an empty
// `<worktree>_game_db_data` volume, and then a hard failure on the shared
// stack's hardcoded `container_name`:
//
//   Conflict. The container name "/game_db" is already in use by container
//   "d048422e...". You have to remove (or rename) that container to be able to
//   reuse that name.
//
// game_db is deliberately shared (fixed host port 5432) and must never be
// recreated, so the only correct outcome is that the deploy addresses the same
// project from every directory. The `name:` pin does that; a pod passes
// `-p heroes-pod-<name>`, which outranks it, so pods are unaffected. This pin
// is read-only, with no process, no file beyond this repo's own compose file and
// no network.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHARED_PROJECT = "heroes-js";

test("docker-compose.yml pins the shared stack's compose project name", () => {
  const raw = readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
  const match = /^name:[ \t]*(\S+)[ \t]*$/m.exec(raw);
  assert.ok(
    match,
    `docker-compose.yml must declare a top-level \`name: ${SHARED_PROJECT}\`. Without it compose ` +
      "derives the project from the working directory and npm run docker:deploy from a worktree " +
      'fails on `Conflict. The container name "/game_db" is already in use`.',
  );
  if (!match) return;
  assert.equal(match[1], SHARED_PROJECT);
});
