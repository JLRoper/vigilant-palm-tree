import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandError } from "../../src/io/commands";

test("CommandError.fromResponse extracts the server's `error` field as `.reason` and `.message`", () => {
  const err = CommandError.fromResponse(409, "Conflict", JSON.stringify({ error: "hero_not_at_fromTile" }));
  assert.equal(err.status, 409);
  assert.equal(err.reason, "hero_not_at_fromTile");
  assert.equal(err.message, "hero_not_at_fromTile");
  assert.equal(err.name, "CommandError");
});

test("CommandError.fromResponse combines `error` and `message` when the server sends both (500s)", () => {
  const err = CommandError.fromResponse(
    500,
    "Internal Server Error",
    JSON.stringify({ error: "internal", message: 'relation "game_events" does not exist' }),
  );
  assert.equal(err.reason, 'internal: relation "game_events" does not exist');
});

test("CommandError.fromResponse falls back to the raw body when it isn't the { error } JSON shape", () => {
  const err = CommandError.fromResponse(500, "Internal Server Error", "<html>...stack trace...</html>");
  assert.equal(err.reason, "<html>...stack trace...</html>");
});

test("CommandError.fromResponse falls back to the status line when the body is empty", () => {
  const err = CommandError.fromResponse(504, "Gateway Timeout", "");
  assert.equal(err.reason, "504 Gateway Timeout");
});

test("CommandError.fromResponse ignores a JSON body whose `error` field isn't a string", () => {
  const err = CommandError.fromResponse(400, "Bad Request", JSON.stringify({ error: 42 }));
  assert.equal(err.reason, JSON.stringify({ error: 42 }));
});
