// scripts/pods.ts
//
// Per-run docker pods. A pod is ONE docker compose project
// (`heroes-pod-<name>`) created from the repo's existing docker-compose.yml
// plus docker/docker-compose.pod.yml: its own postgres, its own api, its own
// web, its own host ports, its own volume and network -- and it STAYS UP so the
// reader can test against it. Nothing here tears a pod down at the end of a
// run; removal is explicit (`pod:down`) or by age (`pod:prune`).
//
// Identity is carried by the objects themselves: every container, the volume
// and the network get `heroes.pod=<name>`, `heroes.pod.created=<iso>` and
// `heroes.pod.workspace=<path>`, and `list` reads those labels back with
// `docker ps -a --filter label=heroes.pod` plus docker's own port mapping.
// There is no registry file, so nothing can drift from docker.
//
//   npm run pod:up                      # new pod, name from the branch + a tag
//   npm run pod:up -- my-pod            # named pod
//   npm run pod:list
//   npm run pod:down -- my-pod          # containers + network + volume
//   npm run pod:prune -- --older-than 12
//
// Every child process is spawned with windowsHide: true and without a shell,
// so no console window appears while any of this runs.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickFreePorts } from "./allocate-ports";
import { resolveCommitHash } from "./docker-build";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_FILES = ["-f", "docker-compose.yml", "-f", "docker/docker-compose.pod.yml"];
const POD_SERVICES = ["db", "api", "web"];
const PROJECT_PREFIX = "heroes-pod-";
const POD_LABEL = "heroes.pod";
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const DEFAULT_OLDER_THAN_HOURS = 12;
const READY_TIMEOUT_MS = 150_000;
const READY_POLL_MS = 3_000;

type RunResult = { status: number; stdout: string; stderr: string };
type Ports = { db: string; api: string; web: string };

type InspectResult = {
  Id: string;
  Name: string;
  Created: string;
  Config?: { Image?: string; Labels?: Record<string, string> };
  State?: { Running?: boolean; Status?: string; Health?: { Status?: string } };
  NetworkSettings?: { Ports?: Record<string, { HostPort?: string }[] | null> };
};

type ContainerInfo = {
  id: string;
  name: string;
  service: string;
  image: string;
  running: boolean;
  status: string;
  health: string | null;
  ports: Record<string, string>;
};

type Pod = {
  name: string;
  project: string;
  created: string | null;
  workspace: string | null;
  containers: ContainerInfo[];
  volumes: string[];
  networks: string[];
};

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  if (r.error) return { status: 127, stdout: "", stderr: String(r.error) };
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function docker(args: string[], env?: NodeJS.ProcessEnv): RunResult {
  return run("docker", args, env);
}

function firstLine(s: string): string {
  return (s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "").trim();
}

function fail(message: string): never {
  console.error(`pod: ${message}`);
  process.exit(1);
}

function tail(s: string, lines = 12): string {
  const all = s.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

function lines(s: string): string[] {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// --- docker queries -------------------------------------------------------

function dockerVersion(): string {
  const r = docker(["info", "--format", "{{.ServerVersion}}"]);
  if (r.status !== 0) {
    fail(
      `docker daemon is not reachable (${firstLine(r.stderr) || firstLine(r.stdout) || `exit ${r.status}`}). Nothing was created.`,
    );
  }
  return r.stdout.trim();
}

function psIds(filters: string[]): string[] {
  const r = docker(["ps", "-a", ...filters, "--format", "{{.ID}}"]);
  if (r.status !== 0) fail(`docker ps failed: ${firstLine(r.stderr)}`);
  return lines(r.stdout);
}

function inspect(raw: string[]): InspectResult[] {
  if (raw.length === 0) return [];
  const r = docker(["inspect", ...raw]);
  if (r.status !== 0) fail(`docker inspect failed: ${firstLine(r.stderr)}`);
  try {
    return JSON.parse(r.stdout) as InspectResult[];
  } catch {
    fail("docker inspect returned unparseable JSON");
  }
}

function toContainerInfo(c: InspectResult): ContainerInfo {
  const labels = c.Config?.Labels ?? {};
  const ports: Record<string, string> = {};
  for (const [key, bindings] of Object.entries(c.NetworkSettings?.Ports ?? {})) {
    const host = Array.isArray(bindings) ? bindings[0]?.HostPort : undefined;
    if (host) ports[key] = String(host);
  }
  return {
    id: c.Id,
    name: c.Name.replace(/^\//, ""),
    service: labels["com.docker.compose.service"] ?? "",
    image: c.Config?.Image ?? "",
    running: Boolean(c.State?.Running),
    status: c.State?.Status ?? "unknown",
    health: c.State?.Health?.Status ?? null,
    ports,
  };
}

function labelledObjects(kind: "volume" | "network"): { name: string; pod: string }[] {
  const ls = docker([kind, "ls", "-q", "--filter", `label=${POD_LABEL}`]);
  if (ls.status !== 0) return [];
  const names = lines(ls.stdout);
  if (names.length === 0) return [];
  const insp = docker([kind, "inspect", ...names]);
  if (insp.status !== 0) return [];
  try {
    const arr = JSON.parse(insp.stdout) as { Name: string; Labels?: Record<string, string> }[];
    return arr
      .map((o) => ({ name: o.Name, pod: o.Labels?.[POD_LABEL] ?? "" }))
      .filter((o) => o.pod.length > 0);
  } catch {
    return [];
  }
}

function listPods(): Pod[] {
  const pods = new Map<string, Pod>();

  const ensure = (
    name: string,
    init?: { project?: string | null; created?: string | null; workspace?: string | null },
  ): Pod => {
    let pod = pods.get(name);
    if (!pod) {
      pod = {
        name,
        project: `${PROJECT_PREFIX}${name}`,
        created: null,
        workspace: null,
        containers: [],
        volumes: [],
        networks: [],
      };
      pods.set(name, pod);
    }
    if (init?.project) pod.project = init.project;
    if (!pod.created && init?.created) pod.created = init.created;
    if (!pod.workspace && init?.workspace) pod.workspace = init.workspace;
    return pod;
  };

  for (const c of inspect(psIds(["--filter", `label=${POD_LABEL}`]))) {
    const labels = c.Config?.Labels ?? {};
    const name = labels[POD_LABEL];
    if (!name) continue;
    const pod = ensure(name, {
      project: labels["com.docker.compose.project"],
      created: labels[`${POD_LABEL}.created`] ?? null,
      workspace: labels[`${POD_LABEL}.workspace`] ?? null,
    });
    pod.containers.push(toContainerInfo(c));
  }

  for (const v of labelledObjects("volume")) ensure(v.pod).volumes.push(v.name);
  for (const n of labelledObjects("network")) ensure(n.pod).networks.push(n.name);

  return [...pods.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function containerFor(pod: Pod, service: string): ContainerInfo | undefined {
  return pod.containers.find((c) => c.service === service);
}

function publishedPort(pod: Pod, service: string, containerPort: string): string | null {
  return containerFor(pod, service)?.ports[containerPort] ?? null;
}

function podUrl(pod: Pod): string | null {
  const port = publishedPort(pod, "web", "80/tcp");
  return port ? `http://localhost:${port}` : null;
}

function podPorts(pod: Pod): Ports | null {
  const db = publishedPort(pod, "db", "5432/tcp");
  const api = publishedPort(pod, "api", "3001/tcp");
  const web = publishedPort(pod, "web", "80/tcp");
  return db && api && web ? { db, api, web } : null;
}

function podIsRunning(pod: Pod): boolean {
  return pod.containers.length > 0 && pod.containers.every((c) => c.running);
}

function podIsReady(pod: Pod): boolean {
  return (
    pod.containers.length >= POD_SERVICES.length &&
    pod.containers.every((c) => c.running && (c.health === null || c.health === "healthy"))
  );
}

function ageMs(pod: Pod): number | null {
  if (!pod.created) return null;
  const t = Date.parse(pod.created);
  return Number.isNaN(t) ? null : Math.max(0, Date.now() - t);
}

function humanAge(ms: number | null): string {
  if (ms === null) return "unknown";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function podState(pod: Pod): string {
  if (pod.containers.length === 0) return "orphaned (no containers)";
  if (pod.containers.length < POD_SERVICES.length) {
    const missing = POD_SERVICES.filter((s) => !containerFor(pod, s));
    return `incomplete (missing ${missing.join(", ")})`;
  }
  if (podIsRunning(pod)) {
    const unhealthy = pod.containers.filter((c) => c.health && c.health !== "healthy");
    return unhealthy.length === 0 ? "up" : `up (${unhealthy.map((c) => `${c.service}:${c.health}`).join(", ")})`;
  }
  const dead = pod.containers.filter((c) => !c.running);
  return `down (${dead.map((c) => `${c.service}:${c.status}`).join(", ")})`;
}

function containerSummary(pod: Pod): string {
  if (pod.containers.length === 0) return "none";
  return pod.containers
    .slice()
    .sort((a, b) => POD_SERVICES.indexOf(a.service) - POD_SERVICES.indexOf(b.service))
    .map((c) => `${c.name} [${c.status}${c.health ? ` ${c.health}` : ""}]`)
    .join("  ");
}

// --- pod naming / env -----------------------------------------------------

function dbNameFor(name: string): string {
  return `heroes_pod_${name.replace(/-/g, "_")}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-_]+$/, "");
}

function branchSlug(): string {
  const r = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (r.status !== 0) return "";
  const branch = r.stdout.trim();
  if (!branch || branch === "HEAD") return "";
  return slug(branch.split("/").pop() ?? "");
}

function defaultName(taken: Set<string>): string {
  const base = branchSlug();
  for (let i = 0; i < 8; i += 1) {
    const tag = randomBytes(2).toString("hex");
    const head = (base || "pod").slice(0, 19).replace(/[-_]+$/, "");
    const name = `${head}-${tag}`;
    if (NAME_RE.test(name) && !taken.has(name)) return name;
  }
  const fallback = `pod-${randomBytes(3).toString("hex")}`;
  return fallback;
}

function podEnv(name: string, ports: Ports, created?: string): NodeJS.ProcessEnv {
  const hash = resolveCommitHash(ROOT);
  return {
    ...process.env,
    POD_NAME: name,
    POD_CREATED: created ?? new Date().toISOString(),
    POD_WORKSPACE: ROOT,
    POD_CONTAINER_PREFIX: `${PROJECT_PREFIX}${name}`,
    POD_DB_NAME: dbNameFor(name),
    POD_DB_PORT: ports.db,
    POD_API_PORT: ports.api,
    POD_WEB_PORT: ports.web,
    POD_API_IMAGE: `${PROJECT_PREFIX}${name}-api`,
    POD_WEB_IMAGE: `${PROJECT_PREFIX}${name}-web`,
    ...(hash ? { VITE_COMMIT_HASH: hash } : {}),
  };
}

function composeArgs(project: string, verb: string[]): string[] {
  return ["compose", "-p", project, ...COMPOSE_FILES, ...verb];
}

// --- list -----------------------------------------------------------------

function printPod(pod: Pod, index: number): void {
  const url = podUrl(pod);
  const ports = podPorts(pod);
  console.log(
    `${index}. ${pod.name}  [${podState(pod)}]  ${url ?? "(no published web port)"}  ` +
      `age ${humanAge(ageMs(pod))}  created ${pod.created ?? "unknown"}`,
  );
  console.log(
    `   ports       ${ports ? `db ${ports.db} / api ${ports.api} / web ${ports.web}` : "not published (pod not fully up)"}  database ${dbNameFor(pod.name)}`,
  );
  console.log(`   containers  ${containerSummary(pod)}`);
  console.log(
    `   objects     network ${pod.networks.join(", ") || "none"}  volume ${pod.volumes.join(", ") || "none"}`,
  );
  console.log(`   workspace   ${pod.workspace ?? "unknown"}`);
  console.log(`   remove      npm run pod:down -- ${pod.name}`);
}

function commandList(): void {
  const version = dockerVersion();
  const pods = listPods();
  const running = pods.filter(podIsRunning).length;
  const orphaned = pods.filter((p) => p.containers.length === 0).length;
  console.log(
    `pods: ${pods.length} (${running} running, ${orphaned} orphaned) -- docker ${version}, project prefix ${PROJECT_PREFIX}<name>`,
  );
  if (pods.length === 0) {
    console.log("  none. Create one with `npm run pod:up`.");
    console.log("  (docker's own view: docker ps -a --filter label=heroes.pod)");
    return;
  }
  pods.forEach((pod, i) => printPod(pod, i + 1));
  console.log("  docker's own view: docker ps -a --filter label=heroes.pod");
}

// --- up -------------------------------------------------------------------

async function waitForReady(project: string, name: string, env: NodeJS.ProcessEnv): Promise<Pod> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: Pod | undefined;
  while (Date.now() < deadline) {
    last = listPods().find((p) => p.name === name);
    if (last && last.name === name && podIsReady(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  const containerLogs = POD_SERVICES.map((service) => {
    const r = docker(["logs", "--tail", "15", `${project}_${service}`], env);
    return r.status === 0 ? `--- ${service} ---\n${tail(r.stdout + r.stderr, 15)}` : "";
  })
    .filter(Boolean)
    .join("\n");
  fail(
    `pod ${name} did not become healthy within ${Math.round(READY_TIMEOUT_MS / 1000)}s ` +
      `(state: ${last ? podState(last) : "no containers"}). Rolling it back.\n${containerLogs}`,
  );
}

async function commandUp(nameArg: string | undefined): Promise<void> {
  const version = dockerVersion();
  const existing = listPods();
  const taken = new Set(existing.map((p) => p.name));

  let name: string;
  if (nameArg !== undefined && nameArg.trim().length > 0) {
    name = nameArg.trim().toLowerCase();
    if (name !== nameArg.trim()) {
      fail(`invalid pod name "${nameArg}" -- use lowercase letters, digits, "-" or "_" (max 24 chars)`);
    }
    if (!NAME_RE.test(name)) {
      fail(`invalid pod name "${nameArg}" -- use lowercase letters, digits, "-" or "_" (max 24 chars)`);
    }
  } else {
    name = defaultName(taken);
  }

  if (taken.has(name)) {
    const pod = existing.find((p) => p.name === name);
    fail(
      `a pod named "${name}" already exists (${pod ? podState(pod) : "labelled objects present"}). ` +
        `Remove it first: npm run pod:down -- ${name}`,
    );
  }

  const project = `${PROJECT_PREFIX}${name}`;

  // Objects already living in this compose project namespace but NOT carrying
  // this pod's label are never touched by down/prune, so refuse up too.
  const foreign = projectObjects(project);
  if (foreign.length > 0) {
    fail(
      `compose project ${project} already has objects that are not labelled ${POD_LABEL}=${name}: ` +
        `${foreign.join(", ")}. Refusing to touch them -- inspect or remove them by hand first.`,
    );
  }

  const ports = await pickFreePorts(3).then(
    ([db, api, web]) => ({ db: String(db), api: String(api), web: String(web) }),
    (err: unknown) => fail(`could not allocate three free host ports: ${err instanceof Error ? err.message : String(err)}`),
  );

  const env = podEnv(name, ports);
  console.log(
    `creating pod ${name}: compose project ${project}, db :${ports.db}, api :${ports.api}, web :${ports.web} (docker ${version})`,
  );

  const up = docker(composeArgs(project, ["up", "-d", "--build", ...POD_SERVICES]), env);
  if (up.status !== 0) {
    const rollback = docker(composeArgs(project, ["down", "-v", "--remove-orphans"]), env);
    fail(
      `docker compose up failed (exit ${up.status}) for pod ${name}:\n${tail(up.stdout + up.stderr, 20)}\n` +
        (rollback.status === 0
          ? "rolled back: nothing this attempt created is left behind."
          : `rollback ALSO failed (exit ${rollback.status}): ${firstLine(rollback.stderr)}\n` +
            `check for leftovers with: docker ps -a --filter label=${POD_LABEL}=${name}`),
    );
  }

  const pod = await waitForReady(project, name, env);
  const podPortsNow = podPorts(pod) ?? ports;
  const url = podUrl(pod) ?? `http://localhost:${podPortsNow.web}`;

  console.log("");
  console.log(`pod ${name} is up -- ${podState(pod)}`);
  console.log(`  web         ${url}`);
  console.log(`  api         http://localhost:${podPortsNow.api}/api/health`);
  console.log(
    `  db          localhost:${podPortsNow.db}  database ${dbNameFor(name)} (user gameuser, password gamepass)`,
  );
  console.log(`  containers  ${containerSummary(pod)}`);
  console.log(`  workspace   ${ROOT}`);
  console.log(`  see it      npm run pod:list      (docker: docker ps -a --filter label=${POD_LABEL})`);
  console.log(`  remove it   npm run pod:down -- ${name}`);
  console.log("  it stays up: nothing tears a pod down when a run ends -- removal is pod:down or pod:prune.");
  console.log(
    `  point a run at it: API_HOST=127.0.0.1 API_PORT=${podPortsNow.api} CLIENT_PORT=${podPortsNow.web} ` +
      `PGHOST=127.0.0.1 PGPORT=${podPortsNow.db} PGUSER=gameuser PGPASSWORD=gamepass PGDATABASE=${dbNameFor(name)}`,
  );
}

// --- down / prune ---------------------------------------------------------

function projectObjects(project: string): string[] {
  const out: string[] = [];
  const containerIds = lines(docker(["ps", "-a", "--filter", `name=^${project}_`, "--format", "{{.ID}}"]).stdout);
  if (containerIds.length > 0) {
    for (const c of inspect(containerIds)) {
      const label = c.Config?.Labels?.[POD_LABEL] ?? "";
      if (`${PROJECT_PREFIX}${label}` !== project) out.push(`container ${c.Name.replace(/^\//, "")}`);
    }
  }
  for (const kind of ["volume", "network"] as const) {
    const names = lines(docker([kind, "ls", "-q", "--filter", `name=^${project}_`]).stdout);
    if (names.length === 0) continue;
    const insp = docker([kind, "inspect", ...names]);
    if (insp.status !== 0) {
      out.push(`${kind}s ${names.join(", ")}`);
      continue;
    }
    try {
      const arr = JSON.parse(insp.stdout) as { Name: string; Labels?: Record<string, string> }[];
      for (const o of arr) {
        const label = o.Labels?.[POD_LABEL] ?? "";
        if (!(label.length > 0 && `${PROJECT_PREFIX}${label}` === project)) out.push(`${kind} ${o.Name}`);
      }
    } catch {
      out.push(`${kind}s ${names.join(", ")}`);
    }
  }
  return out;
}

function downPod(name: string): { ok: boolean; removed: string[]; error?: string } {
  const project = `${PROJECT_PREFIX}${name}`;
  const pod = listPods().find((p) => p.name === name);
  if (!pod || pod.containers.length + pod.volumes.length + pod.networks.length === 0) {
    return {
      ok: false,
      removed: [],
      error:
        `no pod named "${name}" is present (nothing is labelled ${POD_LABEL}=${name}). ` +
        `List what exists with \`npm run pod:list\`.`,
    };
  }

  // projectObjects only reports objects that are NOT this pod's, so anything it
  // returns is off-limits.
  const foreign = projectObjects(project);
  if (foreign.length > 0) {
    return {
      ok: false,
      removed: [],
      error:
        `refusing to remove pod "${name}": compose project ${project} also holds objects that are not ` +
        `labelled ${POD_LABEL}=${name}: ${foreign.join(", ")}. Nothing was removed.`,
    };
  }

  const removed = [
    ...pod.containers.map((c) => `container ${c.name}`),
    ...pod.volumes.map((v) => `volume ${v}`),
    ...pod.networks.map((n) => `network ${n}`),
  ];

  const ports: Ports = podPorts(pod) ?? { db: "0", api: "0", web: "0" };
  const env = podEnv(name, ports, pod.created ?? undefined);
  const r = docker(composeArgs(project, ["down", "-v", "--remove-orphans"]), env);
  if (r.status !== 0) {
    return {
      ok: false,
      removed: [],
      error: `docker compose down failed for pod ${name} (exit ${r.status}): ${tail(r.stdout + r.stderr, 10)}`,
    };
  }

  const after = listPods().find((p) => p.name === name);
  if (after) {
    return {
      ok: false,
      removed,
      error:
        `down ran but objects labelled ${POD_LABEL}=${name} are still present: ` +
        `${containerSummary(after)}, network ${after.networks.join(", ") || "none"}, volume ${after.volumes.join(", ") || "none"}`,
    };
  }
  return { ok: true, removed };
}

function commandDown(nameArg: string | undefined): void {
  if (!nameArg || nameArg.trim().length === 0) {
    fail("down needs a pod name: npm run pod:down -- <name>");
  }
  const name = nameArg.trim().toLowerCase();
  if (!NAME_RE.test(name)) fail(`invalid pod name "${nameArg}"`);
  dockerVersion();
  const before = listPods().find((p) => p.name === name);
  const result = downPod(name);
  if (!result.ok) fail(result.error ?? `could not remove pod ${name}`);
  console.log(`removed pod ${name}${before ? ` (it was ${podState(before)}, age ${humanAge(ageMs(before))})` : ""}:`);
  for (const item of result.removed) console.log(`  - ${item}`);
  console.log(`  ${name} is gone: no container, network or volume carries ${POD_LABEL}=${name} any more.`);
}

function commandPrune(args: string[]): void {
  const hours = parseOlderThan(args);
  dockerVersion();
  const pods = listPods();
  if (pods.length === 0) {
    console.log("prune: no pods to look at (docker ps -a --filter label=heroes.pod is empty).");
    return;
  }
  const removed: string[] = [];
  const kept: string[] = [];
  let failed = false;

  for (const pod of pods) {
    const ms = ageMs(pod);
    const ageHours = ms === null ? null : ms / 3_600_000;
    const describe = `pod ${pod.name} (age ${humanAge(ms)}, ${pod.containers.length} container(s), ` +
      `network ${pod.networks.length}, volume ${pod.volumes.length})`;
    if (ageHours === null) {
      kept.push(`${describe} -- kept: created label missing, age unknown`);
      continue;
    }
    if (ageHours < hours) {
      kept.push(`${describe} -- kept: age ${ageHours.toFixed(2)}h < ${hours}h`);
      continue;
    }
    const result = downPod(pod.name);
    if (result.ok) {
      removed.push(`${describe} -- removed (${result.removed.join(", ")})`);
    } else {
      failed = true;
      kept.push(`${describe} -- kept: removal failed: ${result.error ?? "unknown error"}`);
    }
  }

  console.log(`prune: older than ${hours}h -- ${removed.length} removed, ${kept.length} kept`);
  console.log("removed:");
  if (removed.length === 0) console.log("  none");
  for (const item of removed) console.log(`  - ${item}`);
  console.log("kept:");
  if (kept.length === 0) console.log("  none");
  for (const item of kept) console.log(`  - ${item}`);
  if (failed) process.exit(1);
}

function parseOlderThan(args: string[]): number {
  let raw: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--older-than") {
      raw = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--older-than=")) {
      raw = arg.slice("--older-than=".length);
      continue;
    }
    fail(`unknown argument "${arg}" for prune (expected --older-than <hours>)`);
  }
  if (raw === undefined) return DEFAULT_OLDER_THAN_HOURS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    fail(`--older-than must be a number of hours >= 0 (got "${raw}")`);
  }
  return value;
}

// --- entry ----------------------------------------------------------------

function usage(): void {
  console.log(
    [
      "heroes-js per-run docker pods -- own postgres + api + web, own ports, up until you remove them",
      "",
      "  npm run pod:up [-- <name>]                       create a pod and print its URL (name defaults",
      "                                                  to the branch slug + a short random tag)",
      "  npm run pod:list                                 every pod: name, URL, ports, age, running?",
      "  npm run pod:down -- <name>                       remove that pod completely",
      "  npm run pod:prune [-- --older-than <hours>]      remove pods older than <hours> (default 12)",
      "",
      "  A pod is one compose project (heroes-pod-<name>) built from docker-compose.yml +",
      "  docker/docker-compose.pod.yml; its containers, volume and network carry the labels",
      `  ${POD_LABEL} / ${POD_LABEL}.created / ${POD_LABEL}.workspace.`,
      "",
      "  Env for pointing an existing run at a pod instead of the shared stack (values printed by pod:up):",
      "    API_HOST=127.0.0.1 API_PORT=<pod api port> CLIENT_PORT=<pod web port>",
      "    PGHOST=127.0.0.1 PGPORT=<pod db port> PGUSER=gameuser PGPASSWORD=gamepass PGDATABASE=heroes_pod_<name>",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "up":
      await commandUp(rest.find((a) => !a.startsWith("-")));
      break;
    case "list":
    case "ls":
      commandList();
      break;
    case "down":
    case "rm":
      commandDown(rest.find((a) => !a.startsWith("-")));
      break;
    case "prune":
      commandPrune(rest);
      break;
    case undefined:
    case "help":
    case "--help":
      usage();
      break;
    default:
      usage();
      fail(`unknown command "${command}"`);
  }
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
