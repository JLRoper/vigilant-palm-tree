// Builds the Docker images with the version metadata the client stamps at
// compile time. `.git` is deliberately excluded from the build context (179MB
// of PNG art history), so the commit hash cannot be resolved inside the
// container -- without this wrapper every deployed build reports the literal
// fallback "dev" in the settings panel's build info.
//
// Usage (any args are forwarded to `docker compose build`):
//   npm run docker:build              # builds api + web with the current SHA
//   npm run docker:build -- web       # just web
//   VITE_COMMIT_HASH=abc1234 npm run docker:build   # override

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function gitShortHead(): string | null {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.trim();
}

const provided = process.env.VITE_COMMIT_HASH?.trim();
const sha = provided || gitShortHead();

if (!sha) {
  console.error(
    "docker-build: could not resolve a commit hash (not a git repo?) and VITE_COMMIT_HASH is unset.\n" +
      "The client build would stamp the literal \"dev\". Set VITE_COMMIT_HASH to override.",
  );
  process.exit(1);
}

const forwarded = process.argv.slice(2).filter((a) => a.trim().length > 0);
const services = forwarded.filter((a) => !a.startsWith("-"));
const flags = forwarded.filter((a) => a.startsWith("-"));
const args = ["compose", "build", ...(services.length > 0 ? services : ["api", "web"]), ...flags];

console.log(`>> docker compose ${args.slice(2).join(" ")} (VITE_COMMIT_HASH=${sha})`);

const r = spawnSync("docker", args, {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, VITE_COMMIT_HASH: sha },
});

if (r.error) {
  console.error(`docker-build: failed to launch docker: ${String(r.error)}`);
  process.exit(1);
}

process.exit(r.status ?? 1);
