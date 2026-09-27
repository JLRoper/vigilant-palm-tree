# Live Verification + Next-Steps Plan

*Authored: 2026-08-17*
*Follows: `plan/2026-08-17-track-map-doc-audit-findings.md` (doc-bookkeeping audit of the consolidated Phase 1–5 track map). This doc covers what changed after actually standing up the dev environment and running the app.*

---

## 1. What was verified live (new — not just doc review)

The dev environment did not previously exist on this machine. Getting it running required installing Node.js LTS, PowerShell Core, and Playwright's Chromium binaries (see §2.2). With it running, all four of the track map's own verification gates were re-run directly, plus a live in-browser check that wasn't previously possible:

| Check | Result |
| :--- | :--- |
| `npm run build` | ✅ clean |
| `npm run lint:deps` | ✅ 311 modules / 888 deps, 0 violations |
| `npm run test:all` | ✅ 148/148 unit tests; smoke suite "ALL TESTS PASSED"; multiplayer smoke OK; cityView suite all green |
| `npm run validate-assets` | ✅ `tools/sprites/validate-assets.mjs`: all 31 registered sprites present; asset validation passed |
| Live browser render check | ✅ created a game, sampled canvas pixel data directly (screenshots unavailable in this session — used `getImageData`): adventure map renders with 526 distinct sampled colors in a coherent hex-terrain palette; Test Battle arena renders with 531 distinct colors. Zero console errors, zero failed network/asset requests (all 200 OK) across both screens. |

**Why this matters:** the consolidated track map claims the Phase 5.B scene-builder work (`battleScene.ts`, `cityScene.ts`, `entityMirror.ts`, `paint2d/`'s dispatcher shell) is purely additive/unwired and carries "zero regression risk." That was previously only supported by the doc's own narrative and a `grep` spot-check of stub counts. It's now directly confirmed: the live render path renders correctly with no errors, exactly as expected if that new code genuinely isn't wired into anything yet.

---

## 2. New findings from standing the environment up

### 2.1 `docker/Dockerfile` is broken (real, unrelated to Phase 1–5 work)

`docker/Dockerfile` does `COPY shared ./shared`. `shared/` was renamed to `packages/engine` in commit `628db7c`; the Dockerfile was never updated. Consequence: `docker compose up -d` (the full `db`/`api`/`web` stack) fails on every attempt — worked around here by starting only the `db` service directly, since that's all `npm run dev` actually needs (it talks to Postgres on host port 5432, not through the `api`/`web` containers).

**Impact:** any container-based deploy or full-stack-in-Docker dev workflow is currently non-functional. Low urgency if nobody's actually deploying via this Dockerfile right now, but worth knowing before someone assumes it works.

### 2.2 Fresh-clone onboarding has undocumented gaps

This machine had none of the following, and hit friction on each in turn:
- **Node.js** — not mentioned as a prerequisite anywhere in the README; no `engines` field in `package.json` to at least fail loudly with a version mismatch.
- **PowerShell Core (`pwsh`)** — required because `npm run cleanup` and `npm run dev:status` shell out to `pwsh scripts/*.ps1`. Not documented as a Windows prerequisite.
- **Playwright browser binaries** — `npm test` (per the README, step 3 of "Quick start") launches a headless browser via Playwright, but nothing installs its browser binaries. First run failed with a `browserType.launch: Executable doesn't exist` error; fixed with a manual `npx playwright install chromium`.

None of this is a bug in the app itself — everything works once these are in place — but it's real friction for anyone else cloning fresh, especially on Windows.

---

## 3. Consolidated findings (carried over, still open)

From the prior audit pass (`plan/2026-08-17-track-map-doc-audit-findings.md`), untouched by this session:

1. Duplicate "Revision note 6" in the consolidated track map (two independent worktrees both self-numbered the same note; the collision merged silently because the two insertions land at different points in the file).
2. §11 "Open PRs Awaiting Merge" is stale — still lists merge order ending at #95 / "None open," but `main` has since merged #96, #104–#109.
3. PR #106 (global error middleware + command-rejection toasts) touched `src/io/commands.ts` and `src/game/turnHooks.ts` — both inside Track 5.A's owned surface — but isn't mentioned in the track map at all.

---

## 4. Next-steps plan, prioritized

### P0 — cheap, unblocks nothing else, do first
1. **Fix `docker/Dockerfile`'s stale `COPY shared ./shared`** → `COPY packages/engine ./packages/engine` (plus whatever else the image actually needs post-rename — worth a quick audit of the full `COPY`/`WORKDIR` set while in there, not just the one broken line).
2. **Add an `engines` field to `package.json`** pinning the Node major version actually in use (24.x here), and a `postinstall: "playwright install chromium"` (or document it explicitly in the README's Quick Start) so `npm test` doesn't fail on first run for the next fresh clone.
3. **Document the Windows prerequisite on `pwsh`** (PowerShell Core, not Windows PowerShell 5.1) in the README or `TECHNICAL_SPECIFICATIONS.MD`, since `npm run cleanup`/`npm run dev:status` silently require it.
4. **Doc fixes from the prior audit** (renumber the duplicate revision note, refresh §11, add PR #106) — five minutes, prevents anyone else building on top of the duplicate-note pattern.

### P1 — the real Phase 5 work, sequenced by the track map's own (validated) risk ordering
This session's live verification didn't change the substance of what's left — it confirmed the doc's existing plan is accurate, so I'd keep its ordering:
5. **`paint2d/` per-kind Canvas transcription** — turn the 28 no-op stubs into real Canvas calls (Commits 3–10 per the paint2d design doc), plus the two files that are deliberately the *only* ones allowed to touch Vite-coupled assets: `src/render/paint2dDefaults.ts` and `src/render/skybox.ts`.
6. **Decide event-cursor/SSE ownership** (§7.1/§8 of the track map — currently unassigned) — this is a real blocking decision, not busywork: `multiplayerSync.ts`'s rewrite and `GameSessionManager.ts`'s cursor init both depend on it, and it's been sitting unowned since Phase 5.A work started.
7. **`manualBattleArena.ts` decomposition** — higher risk, live interactive screen, no pre-agreed target structure yet (per the track map's own risk note).
8. **`renderer.ts`/`cityRenderer.ts` rewrite to consume `SceneNode[]`** — deliberately last; this is the only step in the whole Phase 5 plan that touches the live render path, and today's live-render verification (§1) is the baseline to diff against once this lands.

### P2 — tracked but not blocking
9. Turn the dangling #89 follow-up (`commandHandler.test.ts` regression assertions for `settlement_snapshots`/`resource_transactions` writes, open since PR #92) into a real tracked issue instead of a doc footnote.
10. Branch cleanup — 57 remote branches at last count, several referenced in commit messages as already-landed work (e.g. `architecture/circular-dep-cleanup`) and at least one branch name (`phase5/track-b-battlescene-renderer-rewrite`) reused across two unrelated PRs (#104 and #109), which is the same kind of bookkeeping confusion that caused the duplicate revision-note bug.
