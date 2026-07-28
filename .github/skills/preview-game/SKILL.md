---
name: preview-game
description: "Use when: you need to start or restart the local game preview so you can see the latest version of the app."
argument-hint: "Do you want the normal dev preview or a fresh restart?"
---

# Preview the Game

Use this skill when you want to start or restart the local game preview from the project root so the latest changes are visible in the browser.

## Goal

Bring up the game through the repo’s existing npm scripts and confirm that the preview is serving the latest version.

## Workflow

1. Open the project root.
2. If the preview is already running, stop the old process first so you get a clean restart.
3. Choose the right command:
   - Use `npm run dev` for the normal live development preview with the client and API server.
   - Use `npm run dev:static` if you want the same setup but with the cleanup/static-port flow.
   - Use `npm run preview` only when you specifically want a build-style preview rather than the live dev server.
4. Run the command from the project root.
5. Wait for the terminal to report the local URL and confirm the server is ready.
6. Open the reported URL in the browser to verify the latest version is visible.

## Restart Pattern

If the app is already running and you want to refresh it:

1. Stop the current dev process.
2. Run `npm run dev` again.
3. If the browser still shows stale content, stop it once more, clear any old build output if needed, and rerun the command.

## Completion Checks

The preview is ready when:
- the terminal shows a local Vite or dev-server URL,
- the browser opens the app successfully, and
- the latest changes appear without needing a manual refresh.

## Example prompts

- Start the game preview.
- Restart the dev preview so I can see the latest version.
- Launch the local game preview with npm.
