// The Asset Manager's upload key must be asked for with the app's own
// text-input dialog, never the native prompt().
//
// The native prompt() is the last of the family and it blocks the renderer
// thread exactly like its alert() and confirm() siblings. Measured the same way
// (real browser, tab foregrounded, `document.hidden === false`, at
// src/screens/home/assetManager.ts raising the box from its file-input change
// handler): the dispatch never returned -- `Runtime.evaluate timed out` at 5 s,
// and the box opened inside the handler -- `1+1`, `location.href` and even a
// counter read each timed out at 5 s while the box was up, and
// `Page.handleJavaScriptDialog` answered `{}` (an empty object: a dialog really
// was pending), which unwedged the tab instantly. The animation loop stood
// still for 15 555 ms between two frames 12 ms apart (393 ticks landed in the
// 2.0 s before it). A page driving its own animation loop must not need a
// dialog handler to keep running.
//
// The prompt also has to sit ABOVE the manager's own dialog (300) -- at the
// helper's default 120 it would be a key prompt the player can see but not
// click -- and it must keep every bit of the native call's behaviour:
// the pre-filled key (the file name minus .png), the empty/cancelled abort, and
// the resume path that uploads and re-lists.

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
];

/** Messages the native prompt() was asked to show. Must stay empty. */
let nativePromptMessages: string[] = [];

function jsonResponse(body: unknown): unknown {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => "" };
}

/** A MockElement standing in for an `<input type="file">` that has a file. */
type FileInput = MockElement & { files?: Array<{ name: string; type: string }> };

interface Harness {
  body: MockElement;
  calls: Array<{ method: string; url: string; body: unknown }>;
  /** The manager's file input (the change event the key prompt is raised from). */
  fileInput: () => FileInput;
  /** Hands the input the named file and fires the app's own change handler. */
  pick: (name: string) => void;
  /** The manager's status line in the toolbar. */
  status: () => MockElement | null;
  /** The mounted key dialog: its wrapper's inline style carries the z-index. */
  uploadDialog: () => MockElement | null;
  /** The dialog's text field. */
  keyField: () => MockElement;
}

async function openManager(): Promise<Harness> {
  resetPanelManagerForTest();
  nativePromptMessages = [];
  // A native prompt() would resolve to this global. It answers an empty string
  // (i.e. "the player cancelled"), so a regression aborts the upload instead of
  // hanging the test on a box nothing can answer.
  (globalThis as { prompt?: (m?: string, d?: string) => string }).prompt = (m?: string) => {
    nativePromptMessages.push(String(m));
    return "";
  };
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const { body } = installDom({
    fetchImpl: (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url), body: init?.body });
      if (method === "PUT") {
        return jsonResponse({ ...ASSETS[0], key: "uploaded" });
      }
      if (String(url).includes("/api/assets")) return jsonResponse(ASSETS);
      return null;
    },
  });
  const { openAssetManager } = await import("../../../src/screens/home/assetManager");
  openAssetManager();
  await settle();

  const fileInput = (): FileInput => {
    const inp = findAll(body, (el) => el.tagName === "INPUT" && el.type === "file")[0];
    assert.ok(inp, "the manager must have a PNG file input");
    return inp as FileInput;
  };

  return {
    body,
    calls,
    fileInput,
    pick: (name: string) => {
      const inp = fileInput();
      inp.files = [{ name, type: "image/png" }];
      // A real browser leaves the C:\fakepath\... string in `value`; the app is
      // expected to clear it on every path out of the prompt.
      inp.value = `C:\\fakepath\\${name}`;
      inp.dispatchEvent("change");
    },
    /** The manager's status line: the toolbar's last child (after the filter box). */
    status: () => {
      const refresh = findButton(body, "Refresh");
      assert.ok(refresh, "the manager must offer Refresh");
      const toolbar = refresh.parent;
      assert.ok(toolbar, "Refresh sits in the manager's toolbar");
      return toolbar.children[toolbar.children.length - 1] ?? null;
    },
    uploadDialog: () => body.querySelector("div[style*='z-index: 320']"),
    keyField: () => {
      const dialog = body.querySelector("div[style*='z-index: 320']");
      assert.ok(dialog, "the key dialog must be mounted before its field is read");
      const field = findAll(dialog, (el) => el.tagName === "INPUT" && el.type === "text")[0];
      assert.ok(field, "the key dialog must offer a text field");
      return field;
    },
  };
}

test("picking a PNG asks for the key in an in-page dialog above the manager, not a native prompt()", async () => {
  const h = await openManager();
  h.pick("castle.9.png");

  assert.deepEqual(nativePromptMessages, [], "the native prompt() must not be used: it blocks the renderer thread outright");
  const dialog = h.uploadDialog();
  assert.ok(dialog, "the key dialog must be mounted above the manager's own dialog (300)");
  assert.equal(h.body.querySelectorAll("div[style*='z-index: 320']").length, 1, "exactly one key dialog is mounted");
  assert.equal(h.body.querySelectorAll("div[style*='z-index: 300']").length, 1, "the manager stays behind it");
  assert.equal(h.body.querySelectorAll("div[style*='z-index: 120']").length, 0, "and not at the helper's default 120, under the manager");
  assert.equal(panelManagerSizeForTest(), 2, "the key dialog registers beside the manager");
  // The words and the default the native call carried, verbatim.
  assert.ok(findAll(dialog, (el) => textOf(el).includes("Asset key (e.g. castle.1):")).length > 0, "the dialog asks the same question");
  assert.equal(h.keyField().value, "castle.9", "the field is pre-filled with the file name minus .png");
  assert.ok(findButton(dialog, "Upload"), "the dialog offers its confirm action");
  assert.ok(findButton(dialog, "Cancel"), "and a way out");
  assert.deepEqual(h.calls.filter((c) => c.method === "PUT"), [], "no upload happens on the prompt alone");
});

test("cancelling uploads nothing and leaves the input re-armable", async () => {
  const h = await openManager();
  const getsBefore = h.calls.filter((c) => c.method === "GET").length;
  h.pick("castle.9.png");

  const cancel = findButton(h.uploadDialog() as MockElement, "Cancel");
  assert.ok(cancel, "the dialog offers Cancel");
  cancel.click();
  await settle();

  assert.deepEqual(nativePromptMessages, []);
  assert.deepEqual(h.calls.filter((c) => c.method === "PUT"), [], "cancelling must upload nothing");
  assert.equal(h.calls.filter((c) => c.method === "GET").length, getsBefore, "cancelling must not even re-list");
  assert.equal(h.status()?.textContent, "1 assets", "the status line is untouched: it still shows the list it loaded");
  assert.equal(h.fileInput().value, "", "the file input is cleared so the same file can be picked again");
  assert.equal(h.uploadDialog(), null, "the dialog closes itself");
  assert.equal(panelManagerSizeForTest(), 1, "the manager stays open");
});

test("confirming uploads exactly the key that was typed", async () => {
  const h = await openManager();
  h.pick("castle.9.png");

  const field = h.keyField();
  assert.equal(field.value, "castle.9");
  field.value = "dragon.2";
  const go = findButton(h.uploadDialog() as MockElement, "Upload");
  assert.ok(go, "the dialog offers its confirm action");
  go.click();

  assert.equal(h.status()?.textContent, "Uploading...", "the resume path sets the same status it always did");
  await settle();

  assert.deepEqual(nativePromptMessages, []);
  const puts = h.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1, "confirming uploads exactly once");
  assert.match(puts[0].url, /dragon\.2$/, "and under the key that was typed, not the pre-filled one");
  assert.doesNotMatch(puts[0].url, /castle\.9/, "and under no other key");
  assert.equal(h.fileInput().value, "", "the file input is cleared after the upload");
  assert.equal(h.uploadDialog(), null, "the dialog closes itself once answered");
  assert.ok(h.status(), "and the list is re-listed");
});

test("an empty key aborts the upload exactly as `if (!key)` did", async () => {
  const h = await openManager();
  h.pick("castle.9.png");

  h.keyField().value = "";
  const go = findButton(h.uploadDialog() as MockElement, "Upload");
  assert.ok(go);
  go.click();
  await settle();

  assert.deepEqual(nativePromptMessages, []);
  assert.deepEqual(h.calls.filter((c) => c.method === "PUT"), [], "an empty key must upload nothing");
  assert.equal(h.status()?.textContent, "1 assets", "and must not claim to be uploading");
  assert.equal(h.fileInput().value, "", "the file input is cleared, as before");
  assert.equal(h.uploadDialog(), null);
});

after(() => {
  delete (globalThis as { prompt?: unknown }).prompt;
  resetPanelManagerForTest();
  restoreDom();
});
