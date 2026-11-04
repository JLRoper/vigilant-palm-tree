// Five DECLARED-NEVER-EMITTED `GameEvent` names, deleted from `src/core/events.ts`
// on main 55457c4 (0.53.4) — the family the `heroSpeedBonus` card left behind
// ("Measured but deliberately NOT touched ... the `calc:heroSpeed` EVENT name",
// CHANGELOG 0.53.4).
//
// Re-measured on 55457c4 by the event audit (`local/probe/event-audit.cjs` in the
// landing worktree: parse the union, then classify every literal in every `src/`,
// `packages/`, `server/`, `test/` file by whether a `bus.emit`/`bus.emitRaw` call or
// a `commit({ events: [...] })` array sits within four lines of it):
//
//   name                       emitters (prod / test)   listeners (prod / test)
//   calc:heroSpeed             none / none              none / none
//   calc:controlRange          none / none              none / none
//   calc:visionRange           none / none              none / none
//   economy:moraleChanged      none / none              none / none
//   economy:warehouseChanged   none / none              none / none
//
// Each of the four `calc:*`/`economy:moraleChanged` names was referenced by exactly one
// line in the whole tree: its own union member. `economy:warehouseChanged` had a second
// reference — a stale entry in `DEFAULT_BUS_EVENT_TYPES` (`src/debug/eventLog.ts`), the dev
// EventLog's `bus.onAny` filter, whose entry could never match because nothing emitted it.
// Its emitter (`commit({ events: [{ type: "economy:warehouseChanged", ... }] })` in
// `TurnController.transferResources`) was removed by c1debf9 on 2026-10-02 while the
// declaration and `docs/event-system.md`'s "Emit-only — dev log only, emitted by
// turnController.ts:562-563" row stayed; the doc row cited a line that is now
// `startMove`'s body. That is why the doc's disposition table was NOT evidence here.
//
// Deleting is behaviour-identical to main exactly because the emitter side is empty: with
// nothing firing, no listener of any kind could ever have been called. What remains is a
// pin on the whole union, not just on these five names:
//
//   * the retired names may not come back anywhere in `src/` or `packages/`;
//   * every OTHER declared `GameEvent` type must still have a real emitter, so the next
//     name added and left unwired fails here instead of waiting for a card like this one.
//
// The second rule is the one that would have caught all five when they first went dead; it
// also means a deliberate "declare first, wire next commit" is a red build, which is the
// repo's stated preference over an unwired parallel surface.
//
// TO REINSTATE ONE: give it a real emitter (a `bus.emit({...})`, or an entry in the
// `events:` array a `TurnController.commit()` call passes — that array IS emitted, see
// `turnController.ts`'s `for (const event of opts.events ?? []) bus.emit(event)`), add the
// union member back, restore its row in `docs/event-system.md` §7.4, and this file stays
// green. Wiring a LISTENER without an emitter does not satisfy it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DECLARATION = "src/core/events.ts";

/** Every retired name, with the measurement that retired it. */
const RETIRED: ReadonlyArray<{ name: string; why: string }> = [
  { name: "calc:heroSpeed", why: "left over from the deleted hero-speed plumbing; no emitter, no listener" },
  { name: "calc:controlRange", why: "no emitter, no listener" },
  { name: "calc:visionRange", why: "no emitter, no listener" },
  { name: "economy:moraleChanged", why: "no emitter, no listener" },
  {
    name: "economy:warehouseChanged",
    why: "emitter dropped 2026-10-02 (c1debf9); only the dev log's whitelist still named it",
  },
];

/** Every `.ts` under a source tree, as repo-relative POSIX paths. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(`${ROOT}${dir}`, { withFileTypes: true })) {
    const rel = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "generated"].includes(entry.name)) continue;
      out.push(...sourceFiles(`${rel}/`));
    } else if (entry.name.endsWith(".ts") && statSync(`${ROOT}${rel}`).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

const FILES = [...sourceFiles("src/"), ...sourceFiles("packages/")];

function read(rel: string): string {
  return readFileSync(`${ROOT}${rel}`, "utf8");
}

/** The `GameEvent` union as declared: inline members plus every named `Mp*Event` type. */
function declaredTypes(): string[] {
  const src = read(DECLARATION);
  const names = new Set<string>();
  for (const m of src.matchAll(/\|\s*\{\s*type:\s*"([^"]+)"/g)) names.add(m[1]);
  for (const m of src.matchAll(/export type \w*Event = \{\r?\n\s*type: "([^"]+)"/g)) names.add(m[1]);
  return [...names].sort();
}

/** True when the literal at `index` sits in an emitting call: a `bus.emit`/`bus.emitRaw`
    call or a `commit({ events: [...] })` array, within the four lines above it. */
function isEmitted(lines: string[], index: number): boolean {
  const window = lines.slice(Math.max(0, index - 4), index + 2).join(" ");
  return /bus\.(emit|emitRaw)\(/.test(window) || /events:\s*\[/.test(window);
}

const TYPES = declaredTypes();

test("the GameEvent union parses for real", () => {
  assert.ok(FILES.length > 100, `the scan inspected real source (${FILES.length} files)`);
  assert.ok(
    TYPES.length >= 15,
    `the union must be readable from ${DECLARATION} (read ${TYPES.length}: ${TYPES.join(", ")})`,
  );
});

test("no retired event name is declared or referenced in source", () => {
  const offenders: string[] = [];
  for (const { name } of RETIRED) {
    for (const file of FILES) {
      if (read(file).includes(name)) offenders.push(`${file} names ${name}`);
    }
    assert.ok(!TYPES.includes(name), `${name} must not be declared in the GameEvent union`);
  }
  assert.deepEqual(
    offenders,
    [],
    "these names were measured with no emitter and no listener and were deleted; a re-add needs its own emitter",
  );
});

test("every declared GameEvent type has a real emitter", () => {
  const unemitted: string[] = [];
  for (const type of TYPES) {
    const emitted = FILES.some((file) => {
      const lines = read(file).split(/\r?\n/);
      return lines.some((line, i) => line.includes(`"${type}"`) && isEmitted(lines, i));
    });
    if (!emitted) unemitted.push(type);
  }
  assert.deepEqual(
    unemitted,
    [],
    "a declared GameEvent type that nothing emits is a false wiring target: delete it, or emit it in the same change",
  );
});

test("the retired names are absent from the union's own source text", () => {
  const declared = read(DECLARATION);
  for (const { name, why } of RETIRED) {
    assert.ok(!declared.includes(name), `${name} is back in ${DECLARATION} (${why})`);
  }
});
