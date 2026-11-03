// A DISTRICT NOT RE-OPENING AFTER RELOAD (test:districts, districts.e2e.ts:372).
//
// The e2e reloads the page and double-clicks a district hex beside the home
// castle; the CityView never opened. Measured at the culprit commit by running
// the suite at the commit on either side of it (green on adcbc18 / 0.38.13, red
// on 0bc64b7 / 0.38.14 = PR #296, the load-path/seat-resolver landing), and the
// mechanism read out of the running client:
//
//   seat={"seat":null,"source":"unknown"} claimed={"0":{"handle":"Player 1",…}}
//   centre={"q":17.5,"r":13,"source":"map-centre"}   (the castle is at (2,9))
//
// So the reload resolved NO seat: the "New Game" form claims seat 0 for this
// browser server-side (GameSessionManager.handleNewGame) but never remembered
// it, and `resolveLocalSeat` -- correctly -- refuses to guess which seat is ours
// from the claim map alone. Before the seat resolver landed, the load path fell
// back to the LOWEST claimed seat, which happened to be the creator's 0 and hid
// the missing memory. With the seat unknown the camera centred the whole map,
// the district hex landed off screen, and the double-click never reached it.
//
// The fix is the missing memory, not a softened guess: every self-claim records
// the browser's own seat (`rememberSelfClaim`, src/players/localPlayer.ts), the
// same thing the multiplayer lobby's Host/Join tabs already did. These tests pin
// that the remembered seat is what identifies the browser on reload, and that no
// claim site in src/ forgets to remember.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getLocalClaimHandle,
  getLocalPlayerId,
  rememberSelfClaim,
} from "../../src/players/localPlayer";
import { resolveLocalSeat, type ClaimedSeatMap } from "../../src/players/localSeat";
import { resolveLoadCameraCenter } from "../../src/game/loadCamera";
import type { GameState, HeroState, SettlementState } from "@heroes/contracts";

const store = new Map<string, string>();
const savedWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  store.clear();
  (globalThis as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
});

after(() => {
  (globalThis as { window?: unknown }).window = savedWindow;
});

const GAME = "districts-e2e";
// Exactly what the server holds after the New Game form's self-claim: seat 0,
// handle "Player 1" for an anonymous creator (GameSessionManager.handleNewGame).
const SOLE_SELF_CLAIM: ClaimedSeatMap = {
  "0": { handle: "Player 1", claimedAt: "2026-11-03T05:15:59.376Z" },
};

const MAP = { width: 36, height: 27 };
const CASTLE = { q: 2, r: 9 };

function state(): Pick<GameState, "heroes" | "settlements"> {
  const settlement = { id: "castle-1-2-9", name: "unused", ownerId: 0, q: CASTLE.q, r: CASTLE.r } as unknown as SettlementState;
  const hero = { id: "p0-hero", name: "unused", ownerId: 0, q: CASTLE.q, r: CASTLE.r } as unknown as HeroState;
  return { heroes: { "p0-hero": hero }, settlements: { [settlement.id]: settlement } };
}

/** The identity GameSessionManager.loadGame hands the resolver on a reload. */
function reloadIdentity(name: string) {
  return {
    rememberedSeat: getLocalPlayerId(name),
    handle: getLocalClaimHandle(name),
    email: null,
  };
}

test("without the self-claim memory the reload resolves NO seat -- the regression", () => {
  const seat = resolveLocalSeat(SOLE_SELF_CLAIM, reloadIdentity(GAME));
  assert.deepEqual(seat, { seat: null, source: "unknown" });
  // And with no seat the camera leaves the seat's own stronghold for the map
  // centre -- which is what put the district hex off screen.
  assert.deepEqual(resolveLoadCameraCenter(state(), seat.seat, MAP), { q: 17.5, r: 13, source: "map-centre" });
});

test("the self-claim the New Game form makes IS what identifies the browser on reload", () => {
  rememberSelfClaim(GAME, 0, "Player 1");
  const seat = resolveLocalSeat(SOLE_SELF_CLAIM, reloadIdentity(GAME));
  assert.deepEqual(seat, { seat: 0, source: "remembered" });
  // The camera follows the same seat back to the castle: the district hex is
  // on screen again, which is the property districts.e2e.ts:372 needs.
  assert.deepEqual(resolveLoadCameraCenter(state(), seat.seat, MAP), { q: CASTLE.q, r: CASTLE.r, source: "seat-hero" });
});

test("a remembered seat the server no longer backs asserts nothing (the memory is not a licence)", () => {
  rememberSelfClaim(GAME, 0, "Player 1");
  // A re-created game / wiped lobby: seat 0 is not claimed any more.
  const seat = resolveLocalSeat({ "1": { handle: "Joiner" } } as ClaimedSeatMap, reloadIdentity(GAME));
  assert.deepEqual(seat, { seat: null, source: "unknown" });
});

test("EVERY server-side claim site in src/ remembers the browser's own seat", () => {
  // The invariant that would have caught this: claiming a seat and remembering
  // it are one act. The rule is read out of the source rather than listed, so a
  // new claim site cannot be added without remembering (or without this test
  // telling you).
  const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(srcDir);

  const REMEMBERS = /rememberSelfClaim\(|setLocalClaimHandle\(|setLocalPlayerId\(/;
  const offenders: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      // A CALL site (`x.claimLobbySeat(...)`), not the api seam's own property
      // definition (`claimLobbySeat: (name, …) =>`).
      if (!/\.\s*claimLobbySeat\s*\(/.test(line) || /^\s*\/\//.test(line)) return;
      // SessionManager's method of that name IS the passthrough to the api
      // seam -- it claims nothing itself, so there is no seat for it to
      // remember; the caller that resolved the seat remembers it.
      const isPassthrough = lines.slice(Math.max(0, i - 3), i)
        .some((prev) => /^\s*(async\s+)?claimLobbySeat\s*\(/.test(prev));
      if (isPassthrough) return;
      // The seat is remembered at the claim site: the same statement or the few
      // lines after it (the claim is awaited first), before the surrounding
      // block ends.
      const following = lines.slice(i, i + 6).join("\n");
      if (!REMEMBERS.test(following)) {
        offenders.push(`${file.slice(srcDir.length)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `claim sites that do not remember the seat:\n${offenders.join("\n")}`);
});
