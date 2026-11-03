// The Asset Manager's "Delete" must prompt with the app's own in-page dialog,
// never the native confirm().
//
// Same measurement as the other two sites (real browser, tab foregrounded):
// with a native confirm() up, `Page.handleJavaScriptDialog` returned {} while
// every `Runtime.evaluate` timed out after 5s -- the renderer thread is blocked
// outright, not merely waiting. This file pins the Asset Manager's site and the
// negative path: cancelling must not delete an asset.
//
// The prompt also has to sit ABOVE the manager's own dialog (300): a dialog
// drawn under the surface that raised it is one the player can see but not
// click, which would make the confirm action unreachable rather than free.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installDom, restoreDom, findButton, findAll, textOf, settle, type MockElement } from "../../helpers/mockDom";
import { panelManagerSizeForTest, resetPanelManagerForTest } from "../../../src/screens/shared/panelManager";
import type { AssetSummary } from "../../../src/io/assetApi";

const ASSETS: AssetSummary[] = [
  {
    key: "castle.1",
    mime_type: "image/png",
    byte_size: 2048,
    created_at: "2026-10-25T20:00:00Z",
    updated_at: "2026-10-25T22:42:20Z",
  },
  {
    key: "grass.1",
    mime_type: "image/png",
    byte_size: 1024,
    created_at: "2026-10-25T20:00:00Z",
    updated_at: "2026-10-25T22:42:20Z",
  },
];

/** Messages the native confirm() was asked to show. Must stay empty. */
let nativeConfirmMessages: string[] = [];

function jsonResponse(body: unknown): unknown {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => "" };
}

interface Harness {
  body: MockElement;
  calls: Array<{ method: string; url: string }>;
  /** The list row for an asset key. */
  rowFor: (key: string) => MockElement;
  /** The mounted prompt: the wrapper's inline style carries its z-index. */
  prompt: () => MockElement | null;
}

async function openManager(): Promise<Harness> {
  resetPanelManagerForTest();
  nativeConfirmMessages = [];
  (globalThis as { confirm?: (m?: string) => boolean }).confirm = (m?: string) => {
    nativeConfirmMessages.push(String(m));
    return true;
  };
  const calls: Array<{ method: string; url: string }> = [];
  const { body } = installDom({
    fetchImpl: (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url) });
      if (method === "DELETE") return { ok: true, status: 204, statusText: "No Content", json: async () => ({}), text: async () => "" };
      if (String(url).includes("/api/assets")) return jsonResponse(ASSETS);
      return null;
    },
  });
  const { openAssetManager } = await import("../../../src/screens/home/assetManager");
  openAssetManager();
  await settle();

  const rowFor = (key: string): MockElement => {
    const span = findAll(body, (el) => el.tagName === "SPAN" && el.textContent === key)[0];
    assert.ok(span, `the manager must list ${key}`);
    const row = span.parent;
    assert.ok(row, `${key}'s span must sit in a row`);
    return row;
  };

  return {
    body,
    calls,
    rowFor,
    prompt: () => body.querySelector("div[style*='z-index: 320']"),
  };
}

test("delete asset: the prompt is an in-page dialog above the manager, not a native confirm()", async () => {
  const h = await openManager();
  h.rowFor("castle.1").click();

  const del = findButton(h.body, "Delete");
  assert.ok(del, "the manager offers Delete");
  assert.equal(del.disabled, false, "a selected asset enables Delete");
  del.click();

  assert.deepEqual(nativeConfirmMessages, [], "the native confirm() must not be used: it blocks the renderer thread");
  const prompt = h.prompt();
  assert.ok(prompt, "the prompt must be mounted above the manager's own dialog (300)");
  assert.equal(h.body.querySelectorAll("div[style*='z-index: 300']").length, 1, "the manager stays behind it");
  assert.equal(panelManagerSizeForTest(), 2, "the prompt registers beside the manager");
  assert.ok(findButton(prompt, "Cancel"), "the prompt offers Cancel");
  assert.ok(findButton(prompt, "Delete"), "the prompt offers its confirm action");
  assert.ok(findAll(prompt, (el) => el.textContent.includes('Delete "castle.1"?')).length > 0, "the prompt names the asset");
});

test("cancelling leaves the asset alone: no DELETE, the selection survives", async () => {
  const h = await openManager();
  h.rowFor("castle.1").click();
  const del = findButton(h.body, "Delete");
  assert.ok(del);
  const getsBefore = h.calls.filter((c) => c.method === "GET").length;
  del.click();

  const cancel = findButton(h.prompt() as MockElement, "Cancel");
  assert.ok(cancel);
  cancel.click();
  await settle();

  assert.deepEqual(nativeConfirmMessages, []);
  assert.deepEqual(
    h.calls.filter((c) => c.method === "DELETE"),
    [],
    "cancelling must send no DELETE: deleting on the negative path is data loss",
  );
  assert.equal(findButton(h.body, "Delete")?.disabled, false, "the asset is still selected and still deletable");
  assert.equal(findButton(h.body, "Download")?.disabled, false, "and still downloadable");
  assert.equal(h.calls.filter((c) => c.method === "GET").length, getsBefore, "cancelling must not even re-list");
  assert.equal(h.prompt(), null, "the prompt closes itself");
  assert.equal(panelManagerSizeForTest(), 1, "the manager stays open");
});

test("confirming deletes exactly that asset", async () => {
  const h = await openManager();
  h.rowFor("castle.1").click();
  const del = findButton(h.body, "Delete");
  assert.ok(del);
  del.click();

  const go = findButton(h.prompt() as MockElement, "Delete");
  assert.ok(go);
  go.click();
  await settle();

  assert.deepEqual(nativeConfirmMessages, []);
  const deletes = h.calls.filter((c) => c.method === "DELETE");
  assert.equal(deletes.length, 1, "confirming sends exactly one DELETE");
  assert.match(deletes[0].url, /castle\.1$/, "and it names the asset the prompt showed");
  assert.doesNotMatch(deletes[0].url, /grass\.1/, "and touches no other asset");
  assert.equal(findButton(h.body, "Delete")?.disabled, true, "nothing is selected after the delete");
  const info = findAll(h.body, (el) => textOf(el) === "Select an asset to preview");
  assert.ok(info.length > 0, "the preview pane returns to its empty state");
  assert.equal(h.prompt(), null, "the prompt closes itself once answered");
});

after(() => {
  delete (globalThis as { confirm?: unknown }).confirm;
  resetPanelManagerForTest();
  restoreDom();
});
