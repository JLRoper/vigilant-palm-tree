---
description: Run the build + test gate before committing. Blocks if anything fails.
---

Invoke the `precommit-checker` subagent (subagent_type: precommit-checker) in the foreground. It runs `npm run build` then `npm run test:all`.

- If it returns PASS, report "Build + tests pass — safe to commit" and stop.
- If it returns BUILD FAIL or TEST FAIL, report the failure (failing file/line + tail of output) to the user and stop. Do NOT proceed to `git commit` on their behalf; let them decide.

Do not modify any code as part of this command.
