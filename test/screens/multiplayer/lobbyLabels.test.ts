// The multiplayer lobby's host panel asked two different questions with one
// name: the 2/3/4 chip row (multiplayerLobby.ts:150) and the numeric input
// below it (:184) both read "Number of human players", so the player could not
// tell which control they were setting. They are not the same control -- the
// chips BOUND the count (their value sets the numeric input's `max` and clamps
// it on click) while the input IS the count (`humanSlots` on the wire, and the
// seats the server builds the lobby with, `server/routes.ts`: seats = humanSlots)
// -- but as labelled they were indistinguishable.
//
// A test that pinned the two strings would pass again the moment a copy-paste
// renamed both controls back to one sentence, so this pins the thing that
// matters instead: the two controls carry DISTINCT, non-empty accessible
// names, each naming its own subject. It drives the real screen
// (createMultiplayerLobby) over the hand-rolled DOM stand-in the other screen
// suites use and reads the names off the elements assistive tech sees.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, restoreDom, findAll, type MockElement } from "../../helpers/mockDom";
import { createMultiplayerLobby } from "../../../src/screens/multiplayer/multiplayerLobby";

let body: MockElement;

function openLobbyHostPanel(): void {
  createMultiplayerLobby({
    isBackendOk: () => true,
    onEnterGame: () => {},
    onJoinGame: async () => {},
  });
}

/** Every element the lobby gave an accessible name to, in tree order. */
function namedControls(): MockElement[] {
  return findAll(body, (el) => el.getAttribute("aria-label") !== null);
}

/** The seat-count chip row: the only named control that groups its buttons. */
function chipRow(): MockElement {
  const found = namedControls().find((el) => el.getAttribute("role") === "group");
  assert.ok(found, "the chip row must carry an accessible name of its own");
  return found;
}

/** The numeric human-player input: the only named control that takes typing. */
function countInput(): MockElement {
  const found = namedControls().find((el) => el.tagName === "INPUT");
  assert.ok(found, "the human-player count input must carry an accessible name");
  return found;
}

function accessibleName(el: MockElement): string {
  return el.getAttribute("aria-label") ?? "";
}

function visibleLabels(): string[] {
  return findAll(body, (el) => el.tagName === "LABEL").map((el) => el.textContent);
}

beforeEach(() => {
  // refreshUrl reads window.location.origin, which the shared stand-in leaves out.
  const dom = installDom();
  (dom.window as { location?: unknown }).location = { origin: "http://127.0.0.1:5173" };
  body = dom.body;
});

afterEach(() => {
  body.replaceChildren();
  restoreDom();
});

test("the seat chips and the human-player count carry distinct, non-empty accessible names", () => {
  openLobbyHostPanel();
  const chips = accessibleName(chipRow());
  const count = accessibleName(countInput());
  assert.ok(chips.length > 0, "the chip row's accessible name is non-empty");
  assert.ok(count.length > 0, "the count input's accessible name is non-empty");
  assert.notEqual(chips, count, "two different controls must not share one name");
});

test("each name says what its own control sets, and neither takes the other's subject", () => {
  openLobbyHostPanel();
  const chips = accessibleName(chipRow());
  const count = accessibleName(countInput());
  assert.match(chips, /seat/i, "the chip row names seats");
  assert.doesNotMatch(chips, /human/i, "the chip row is not the human-player control");
  assert.match(count, /human player/i, "the input names the human-player count");
  assert.match(count, /maximum seats/i, "the input names the bound the chips set on it");
});

test("both names are the words on screen, and the chips' name cites the range they offer", () => {
  openLobbyHostPanel();
  const chips = chipRow();
  const chipsName = accessibleName(chips);
  const countName = accessibleName(countInput());

  const labels = visibleLabels();
  assert.ok(labels.includes(chipsName), `a visible label reads "${chipsName}"`);
  assert.ok(labels.includes(countName), `a visible label reads "${countName}"`);

  const buttons = findAll(chips, (el) => el.tagName === "BUTTON").map((el) => el.textContent);
  assert.deepEqual(buttons, ["2", "3", "4"], "the chip row still offers 2/3/4");
  assert.ok(
    chipsName.includes(`(${buttons[0]}-${buttons[buttons.length - 1]})`),
    `the chip row's name cites its own range: ${chipsName}`,
  );
  assert.equal(countInput().type, "number", "the count input is still a number input");
  assert.equal(countInput().value, "2", "the count input's default is unchanged");
});
