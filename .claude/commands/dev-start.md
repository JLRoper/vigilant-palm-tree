---
description: Start the local dev environment (db + api + client) for this worktree
---

Use the `dev-env` subagent (Agent tool, subagent_type: dev-env) with task "start": bring up the db, launch `npm run dev` in the background, wait for it to become healthy, and report the URLs. Run it in the foreground (not background) so you get the result immediately. If it comes back reporting an unexpected problem, relay that to me rather than trying to work around it yourself.
