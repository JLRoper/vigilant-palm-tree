---
description: Run the build + test gate plus a doc sanity sweep before opening a PR. Blocks if anything fails.
---

1. Invoke the `precommit-checker` subagent in the foreground (build + deps + docs + tests). If it fails, report and stop — do not proceed.
2. If build + tests pass, invoke `doc-updater` in the foreground to sanity-sweep README.md / TECHNICAL_SPECIFICATIONS.MD / docs/*.
3. Report the combined result. Do NOT proceed to `gh pr create` on the user's behalf; let them decide whether to push.
4. Run from the requesting worktree: DB-backed suites (test:all, smoke) honor PGDATABASE per the Phase-04 setup script — real per-worktree isolation, shared-container writes never occur. Report the combined result; do NOT proceed to gh pr create on the user's behalf.

Do not modify any code as part of this command — only docs and the gate.
