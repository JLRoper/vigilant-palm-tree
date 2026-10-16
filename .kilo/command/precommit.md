---
description: Run the build + test gate plus the version decision before committing. Blocks if anything fails.
---

Invoke the `precommit-checker` subagent (subagent_type: precommit-checker) in the foreground. It runs `npm run build`, `npm run lint:deps`, `node tools/docs-check.mjs --changed-from origin/main` (docs gate scoped to the changed modules) and `npm run test:all`, then decides and applies the version bump.

Tell it the intended commit type when you know it — `feat` means a real game addition (a **minor** bump); anything else (`fix`, `chore`, `docs`, `test`, `refactor`) is a **patch** bump. With no type given it infers one from the changeset and reports the evidence for its choice. It only bumps when the version has not already been bumped in this changeset, so a commit that carries its own bump is never double-bumped. In a worktree, the DB-backed suite steps honor PGDATABASE per the Phase-04 setup script (per-worktree isolation, shared-container writes never occur).

- If it returns PASS, report the gate result, the version decision and "safe to commit", then stop.
- If it returns BUILD FAIL, DEPS FAIL, DOCS FAIL or TEST FAIL, report the failure (failing file/line + tail of output) to the user and stop. Do NOT proceed to `git commit` on their behalf; let them decide.

Do not modify any code as part of this command — the only files the gate may change are the version line in `package.json` and the resulting `CHANGELOG.md` entry.
