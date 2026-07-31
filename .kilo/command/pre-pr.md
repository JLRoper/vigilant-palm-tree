---
description: Run the build + test gate plus a doc sanity sweep before opening a PR. Blocks if anything fails.
---

1. Invoke the `precommit-checker` subagent in the foreground (build + tests). If it fails, report and stop — do not proceed.
2. If build + tests pass, invoke `doc-updater` in the foreground to sanity-sweep README.md / TECHNICAL_SPECIFICATIONS.MD / docs/*.
3. Report the combined result. Do NOT proceed to `gh pr create` on the user's behalf; let them decide whether to push.

Do not modify any code as part of this command — only docs and the gate.
