import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../server/persistence/db";
import { withRollback } from "../helpers/pgTestTx";
import {
  createUserRepo,
  DuplicateUserError,
  UserNotFoundError,
} from "../../server/persistence/repositories/userRepo";

after(() => pool.end());

function uniqueEmail(): string {
  return `test-user-repo-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

test("createUser stores trimmed case-preserved names and returns the row", async () => {
  await withRollback(async (client) => {
    const repo = createUserRepo(client);
    const email = uniqueEmail();
    const name = `MixedCase Name ${Date.now()}`;

    const row = await repo.createUser(`  ${name} `, `  ${email.toUpperCase()} `);

    assert.equal(row.account_name, name);
    assert.equal(row.email, email.toLowerCase());
    assert.equal(row.email_verified_at, null);
    assert.equal(typeof row.id, "number");
  });
});

test("createUser rejects a duplicate email case-insensitively with DuplicateUserError", async () => {
  await withRollback(async (client) => {
    const repo = createUserRepo(client);
    const email = uniqueEmail();

    await repo.createUser("First User", email);

    await assert.rejects(
      () => repo.createUser("Second User", email.toUpperCase()),
      DuplicateUserError,
    );
  });
});

test("createUser rejects a duplicate account name across whitespace with DuplicateUserError", async () => {
  await withRollback(async (client) => {
    const repo = createUserRepo(client);
    const name = `Repo Name ${Date.now()}`;

    await repo.createUser(name, uniqueEmail());

    await assert.rejects(
      () => repo.createUser(`   ${name}  `, uniqueEmail()),
      DuplicateUserError,
    );
  });
});

test("getUserByEmail and getUserByAccountName match case and whitespace-insensitively", async () => {
  await withRollback(async (client) => {
    const repo = createUserRepo(client);
    const name = `Lookup Name ${Date.now()}`;
    const email = uniqueEmail();
    const created = await repo.createUser(name, email);

    const byEmail = await repo.getUserByEmail(email.toUpperCase());
    assert.ok(byEmail);
    assert.equal(byEmail.id, created.id);

    const byName = await repo.getUserByAccountName(`  ${name} `.toUpperCase());
    assert.ok(byName);
    assert.equal(byName.id, created.id);

    assert.equal(await repo.getUserByEmail("missing@example.com"), null);
    assert.equal(await repo.getUser(-1), null);
  });
});

test("incrementGamesStarted starts at 1 and increments atomically on repeat", async () => {
  await withRollback(async (client) => {
    const repo = createUserRepo(client);
    const created = await repo.createUser("Counter User", uniqueEmail());

    assert.equal(await repo.incrementGamesStarted(client, created.id), 1);
    assert.equal(await repo.incrementGamesStarted(client, created.id), 2);
    assert.equal(await repo.incrementGamesStarted(client, created.id), 3);
  });
});

test("incrementGamesStarted throws UserNotFoundError for a missing user", async () => {
  await withRollback(async (client) => {
    const repo = createUserRepo(client);

    await assert.rejects(() => repo.incrementGamesStarted(client, -1), UserNotFoundError);
  });
});
