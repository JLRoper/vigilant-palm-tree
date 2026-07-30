---
description: Stop the local dev environment (api + client) for this worktree
---

Use the `dev-env` subagent (Agent tool, subagent_type: dev-env) with task "stop": kill this worktree's dev processes and confirm they're down. Run it in the foreground (not background) so you get the result immediately. It will not touch the shared db container or anything outside this worktree on its own — if it thinks that's needed, it'll say so rather than doing it. If it comes back reporting an unexpected problem, relay that to me rather than trying to work around it yourself.
