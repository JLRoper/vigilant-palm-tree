---
description: Restart the local dev environment (api + client) for this worktree
---

Use the `dev-env` subagent (Agent tool, subagent_type: dev-env) with task "restart": stop this worktree's dev processes, then start them again and confirm they're healthy. Run it in the foreground (not background) so you get the result immediately. If it comes back reporting an unexpected problem, relay that to me rather than trying to work around it yourself.
