import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LOG_PANEL_CAPACITY,
  LogRowBuffer,
  LogPanelState,
  attachLogPanelStore,
  formatLogRow,
} from "../../../src/screens/shared/logPanel";
import type { MpLogRow } from "../../../src/core/events";
import { updateSettings } from "../../../src/state/settings";
import { bus } from "../../../src/core/eventBus";

// Pure-logic tests only (no DOM): buffer semantics, the mp:logRow
// subscription gating, and backlog hydration. logPanel.ts's DOM factory
// (createLogPanel) needs document and is exercised by the browser build.

function makeRow(id: number, kind = "HeroMoved"): MpLogRow {
  return {
    id: String(id),
    kind,
    payload: { type: kind },
    actor_seat: null,
    created_at: "2026-09-28T00:00:00.000Z",
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  bus.clear();
  updateSettings({ showLogPanel: false });
  // The store hydrates off api.getEvents on the first row it sees; give it
  // an empty log by default so tests that don't care stay quiet.
  (globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
});

test("the ring buffer caps at LOG_PANEL_CAPACITY and keeps the newest rows", () => {
  const buffer = new LogRowBuffer();
  const total = LOG_PANEL_CAPACITY + 25;
  for (let id = 1; id <= total; id++) buffer.append(makeRow(id));
  assert.equal(buffer.size(), LOG_PANEL_CAPACITY);
  const all = buffer.getAll();
  assert.equal(all[0].id, String(total - LOG_PANEL_CAPACITY + 1), "oldest rows were evicted");
  assert.equal(all[all.length - 1].id, String(total), "newest row is last");
});

test("append dedupes by row id", () => {
  const buffer = new LogRowBuffer();
  assert.equal(buffer.append(makeRow(1)), true);
  assert.equal(buffer.append(makeRow(1)), false, "same id is a no-op");
  assert.equal(buffer.append(makeRow(2)), true);
  assert.equal(buffer.size(), 2);
  assert.deepEqual(buffer.getAll().map((r) => r.id), ["1", "2"]);
});

test("appendBacklog tail-trims a full-log fetch and dedupes rows already buffered live", () => {
  const buffer = new LogRowBuffer();
  // Live frames already landed for ids CAP..CAP+11 (newest-last by id).
  const total = LOG_PANEL_CAPACITY + 11;
  for (let id = LOG_PANEL_CAPACITY; id <= total; id++) buffer.append(makeRow(id));

  // Backlog fetch of the whole log (newest-last, like api.getEvents(name, 0)).
  const fullLog: MpLogRow[] = [];
  for (let id = 1; id <= total; id++) fullLog.push(makeRow(id));
  const added = buffer.appendBacklog(fullLog);

  // Tail-trim keeps ids 12..CAP+11; ids CAP..CAP+11 dedupe against the live
  // rows, so exactly ids 12..CAP-1 were appended.
  assert.equal(added, LOG_PANEL_CAPACITY - 12);
  assert.equal(buffer.size(), LOG_PANEL_CAPACITY);
  assert.equal(buffer.getAll()[0].id, "12");
  assert.equal(buffer.getAll()[buffer.size() - 1].id, String(total));
});

test("mp:logRow appends while showLogPanel is on and not while off", () => {
  updateSettings({ showLogPanel: true });
  const store = attachLogPanelStore();
  bus.emit({ type: "mp:logRow", gameName: "lg1", row: makeRow(1) });
  assert.equal(store.state.buffer.size(), 1);

  updateSettings({ showLogPanel: false });
  bus.emit({ type: "mp:logRow", gameName: "lg1", row: makeRow(2) });
  assert.equal(store.state.buffer.size(), 1, "the buffer stops filling while the setting is off");
  store.detach();
});

test("a different gameName resets the buffer and re-arms backlog hydration", () => {
  updateSettings({ showLogPanel: true });
  // Raw LogPanelState (no store wiring): the store consumes the hydration
  // flag synchronously on every row, so the flag transitions are only
  // observable here.
  const state = new LogPanelState();
  state.appendLive({ type: "mp:logRow", gameName: "lg2", row: makeRow(1) });
  assert.equal(state.needsHydration(), true);
  state.markHydrated();
  assert.equal(state.needsHydration(), false);

  state.appendLive({ type: "mp:logRow", gameName: "lg3", row: makeRow(2) });
  assert.deepEqual(state.buffer.getAll().map((r) => r.id), ["2"], "the old game's rows were dropped");
  assert.equal(state.gameName(), "lg3");
  assert.equal(state.needsHydration(), true, "hydration re-arms for the new game");
});

test("pause freezes the buffer; resume appends again", () => {
  updateSettings({ showLogPanel: true });
  const store = attachLogPanelStore();
  bus.emit({ type: "mp:logRow", gameName: "lg4", row: makeRow(1) });
  store.state.setPaused(true);
  bus.emit({ type: "mp:logRow", gameName: "lg4", row: makeRow(2) });
  assert.equal(store.state.buffer.size(), 1, "paused rows are dropped buffer-wise");
  store.state.setPaused(false);
  bus.emit({ type: "mp:logRow", gameName: "lg4", row: makeRow(3) });
  assert.deepEqual(store.state.buffer.getAll().map((r) => r.id), ["1", "3"]);
  store.detach();
});

test("onChange fires when a row lands in the buffer", () => {
  updateSettings({ showLogPanel: true });
  let changes = 0;
  const store = attachLogPanelStore(() => {
    changes++;
  });
  bus.emit({ type: "mp:logRow", gameName: "lg5", row: makeRow(1) });
  assert.equal(changes, 1);
  store.detach();
});

test("backlog hydration fills the buffer and a live frame dedupes against it", async () => {
  updateSettings({ showLogPanel: true });
  const backlogRows = [makeRow(1), makeRow(2), makeRow(3)];
  (globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify(backlogRows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const store = attachLogPanelStore();

  bus.emit({ type: "mp:logRow", gameName: "lg6", row: makeRow(3) });
  await tick();
  assert.deepEqual(
    store.state.buffer.getAll().map((r) => r.id),
    ["1", "2", "3"],
    "backlog filled oldest-first; the live row was not duplicated",
  );
  assert.equal(store.state.needsHydration(), false, "one backlog fetch per game");

  bus.emit({ type: "mp:logRow", gameName: "lg6", row: makeRow(4) });
  assert.deepEqual(store.state.buffer.getAll().map((r) => r.id), ["1", "2", "3", "4"]);
  store.detach();
});

test("formatLogRow renders id · created_at · kind · summary and truncates long payloads", () => {
  const line = formatLogRow(makeRow(7, "HeroMoved"));
  assert.ok(line.startsWith("#7 \u00b7 2026-09-28T00:00:00.000Z \u00b7 HeroMoved \u00b7 "), line);

  const long: MpLogRow = {
    id: "8",
    kind: "x",
    payload: { blob: "y".repeat(400) },
    actor_seat: null,
    created_at: "t",
  };
  const truncated = formatLogRow(long);
  assert.ok(truncated.length < 200, `payload summary is truncated (got ${truncated.length} chars)`);
  assert.ok(truncated.endsWith("\u2026"));
});
