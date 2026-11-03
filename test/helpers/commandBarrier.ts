import { setTimeout as wait } from "node:timers/promises";
import type { Page, Request } from "playwright";

// Server-command acknowledgement for the browser suites.
//
// The client commits with FIRE-AND-FORGET command POSTs: src/managers/UIManager.ts's
// onAssignWorkers -> src/io/commands.ts's postCommand is not awaited, so nothing in
// the client waits for the API to have applied it. The API, in turn, answers
// POST /api/games/:name/commands only after handleCommandTransactional has
// COMMITted (server/http/routes/commands.ts res.json's the result of the
// transaction), which makes the RESPONSE the one signal that a command has
// landed.
//
// A suite that reads or writes the server's row without waiting for that signal
// is sampling a value that is still moving: measured 2026-11-03 on main, the
// cityView worker-drag step's staffing wait entered with 1-2 of the app's own
// AssignWorkers POSTs still in flight, and with a 6s hold inside the command's
// transaction the SAME tree failed at [gx0/gx3] on one run and [gx1/gx3] on the
// next -- the assertion's 5s budget was being spent on the command's latency
// rather than on the value it asserts, so the expectation that expired moved
// between runs of an identical tree.
//
// Track the POSTs a page fires and wait for their responses before reading or
// writing the server's row, so every assertion compares a settled value.

const outstanding = new WeakMap<Page, Set<Request>>();
const waiters = new WeakMap<Page, Array<() => void>>();

/** True for the one request this barrier exists for: a command POST. */
export function isCommandPost(url: string, method: string): boolean {
  return method === "POST" && /\/commands(\?|$)/.test(url);
}

function pendingFor(page: Page): Set<Request> {
  const existing = outstanding.get(page);
  if (existing) return existing;
  const created = new Set<Request>();
  outstanding.set(page, created);
  return created;
}

function wakeIfIdle(page: Page): void {
  if (pendingFor(page).size > 0) return;
  for (const resolve of waiters.get(page)?.splice(0) ?? []) resolve();
}

/** Starts tracking a page's command POSTs. Call once, right after the page exists. */
export function watchCommands(page: Page): void {
  const pending = pendingFor(page);
  page.on("request", (r) => {
    if (isCommandPost(r.url(), r.method())) pending.add(r);
  });
  // A response means the API has committed that command's transaction, so the
  // page's own state is settled with respect to it. delete() also keeps a
  // response-then-abort pair from decrementing twice.
  page.on("response", (r) => {
    if (pending.delete(r.request())) wakeIfIdle(page);
  });
  page.on("requestfailed", (r) => {
    if (pending.delete(r)) wakeIfIdle(page);
  });
}

/** How many command POSTs this page has fired that have not been answered yet. */
export function commandsInFlight(page: Page): number {
  return outstanding.get(page)?.size ?? 0;
}

/**
 * Resolves once every command POST the page has fired so far has been answered
 * (or has failed) -- or, on timeout, once `timeoutMs` has passed. Returns
 * whether the page actually went idle: a caller that gets `false` is looking at
 * a value that is still moving and should say so rather than assert silently.
 */
export async function waitForCommandsSettled(page: Page, timeoutMs = 30_000): Promise<boolean> {
  if (commandsInFlight(page) === 0) return true;
  return Promise.race([
    new Promise<boolean>((resolve) => {
      const list = waiters.get(page) ?? [];
      list.push(() => resolve(true));
      waiters.set(page, list);
    }),
    wait(timeoutMs).then(() => false),
  ]);
}
