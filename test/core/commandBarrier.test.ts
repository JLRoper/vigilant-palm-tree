import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Request } from "playwright";
import {
  commandsInFlight,
  isCommandPost,
  waitForCommandsSettled,
  watchCommands,
} from "../helpers/commandBarrier";

// Pins for the server-command acknowledgement barrier (2026-11-03), the fix for
// the cityView worker-drag flake.
//
// The client commits with fire-and-forget POSTs (UIManager's onAssignWorkers ->
// io/commands.ts's postCommand is unawaited) and the API answers only after
// handleCommandTransactional has committed, so a suite read taken while a POST
// is outstanding samples a value that is still moving. Measured on main: the
// staffing waits entered with 1-2 AssignWorkers POSTs still in flight, and with
// a 6s hold inside the command's transaction the SAME tree failed at
// [gx0/gx3] on one run and [gx1/gx3] on the next -- the expectation that
// expired moved between runs of an identical tree. The barrier has to resolve on
// the response (the commit signal) and only then, which is what these unit pins
// hold, plus the site invariant that the suite still calls it at every server
// read/write.

class FakePage {
  private handlers = new Map<string, Array<(arg: unknown) => void>>();

  on(event: string, cb: (arg: unknown) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, arg: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) cb(arg);
  }
}

const fakeRequest = (url: string, method = "POST"): Request =>
  ({ url: () => url, method: () => method }) as unknown as Request;

const COMMANDS = "http://127.0.0.1:56777/api/games/cityview-e2e/commands";

function makePage(): { page: Page; fake: FakePage } {
  const fake = new FakePage();
  return { page: fake as unknown as Page, fake };
}

test("only POSTs to the command endpoint count", () => {
  assert.equal(isCommandPost(COMMANDS, "POST"), true);
  assert.equal(isCommandPost(`${COMMANDS}?x=1`, "POST"), true);
  assert.equal(isCommandPost(COMMANDS, "GET"), false);
  assert.equal(isCommandPost("http://127.0.0.1:56777/api/games/cityview-e2e", "POST"), false);

  const { page, fake } = makePage();
  watchCommands(page);
  fake.emit("request", fakeRequest("http://127.0.0.1:56777/api/games/x", "GET"));
  fake.emit("request", fakeRequest("http://127.0.0.1:56777/api/games/x", "POST"));
  assert.equal(commandsInFlight(page), 0, "neither a GET nor a game-create POST is a command");
  fake.emit("request", fakeRequest(COMMANDS));
  assert.equal(commandsInFlight(page), 1);
});

test("the barrier resolves on the response -- the API's commit signal -- not before", async () => {
  const { page, fake } = makePage();
  watchCommands(page);
  const first = fakeRequest(COMMANDS);
  const second = fakeRequest(COMMANDS);
  fake.emit("request", first);
  fake.emit("request", second);

  let settled = false;
  const waiting = waitForCommandsSettled(page).then((ok) => {
    settled = true;
    return ok;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false, "still two commands outstanding: the barrier must not resolve");

  fake.emit("response", { request: () => first });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false, "one command is still outstanding");
  assert.equal(commandsInFlight(page), 1);

  fake.emit("response", { request: () => second });
  assert.equal(await waiting, true, "the barrier resolves only once every POST has been answered");
  assert.equal(commandsInFlight(page), 0);
});

test("a failed request settles too, and a response is never counted twice", async () => {
  const { page, fake } = makePage();
  watchCommands(page);
  const request = fakeRequest(COMMANDS);
  fake.emit("request", request);
  fake.emit("requestfailed", request);
  assert.equal(commandsInFlight(page), 0);
  fake.emit("response", { request: () => request });
  assert.equal(commandsInFlight(page), 0, "a late response must not push the count below zero");
  assert.equal(await waitForCommandsSettled(page, 50), true);
});

test("a command that is never answered reports a timeout instead of hanging", async () => {
  const { page, fake } = makePage();
  watchCommands(page);
  fake.emit("request", fakeRequest(COMMANDS));
  assert.equal(await waitForCommandsSettled(page, 30), false, "an unanswered command must not block a suite forever");
  assert.equal(commandsInFlight(page), 1, "…and the caller can say how many are still moving");
});

test("the cityView suite still gates its server reads and its fixture write on the barrier", () => {
  const source = readFileSync(fileURLToPath(new URL("../cityView.test.ts", import.meta.url)), "utf8");
  assert.match(source, /from "\.\/helpers\/commandBarrier"/, "the suite must import the barrier");
  assert.match(source, /watchCommands\(page\)/, "the suite must start tracking the page's command POSTs");

  // The gate has to sit inside the helper that does the work, or a read taken
  // elsewhere in the suite silently goes back to sampling a moving value. Each
  // helper is sliced up to the NEXT top-level declaration (a `\n}` boundary
  // would stop inside serverSettlement's own multi-line return type).
  const bodyOf = (name: string): string => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} is gone from test/cityView.test.ts -- re-point this pin`);
    const next = source.slice(start + 1).search(/\n(?:async )?function [A-Za-z_$]/);
    return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
  };
  for (const site of ["seedWorkforceFixture", "serverSettlement", "serverDraft", "waitForServerStaffing"]) {
    assert.match(
      bodyOf(site),
      /awaitCommandSettled\(page\)/,
      `${site} no longer waits for the page's command POSTs before touching the server's row`,
    );
  }

  // The wait's 5s budget must start AFTER the commands have landed, not before:
  // that ordering is the whole fix.
  const waitBody = bodyOf("waitForServerStaffing");
  assert.ok(
    waitBody.indexOf("awaitCommandSettled(page)") < waitBody.indexOf("const deadline = Date.now() + 5000"),
    "waitForServerStaffing must settle the outstanding commands before starting its deadline",
  );
});
