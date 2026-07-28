---
mode: agent
---

Start or restart the local development preview for this project so I can see the latest version of the game.

Use the project’s existing npm workflow:
- Prefer `npm run dev` for the normal live development preview.
- If the current preview is already running and you need a fresh restart, stop the old process first and then run `npm run dev` again.
- If the repo specifically needs the static cleanup flow, use `npm run dev:static`.

Verify the preview is serving locally before reporting back.
