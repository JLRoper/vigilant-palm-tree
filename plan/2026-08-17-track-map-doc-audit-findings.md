# Doc Audit: `plan/2026-08-17-consolidated-phase-1-5-track-map.md`

*Authored: 2026-08-17*
*Scope: review of the consolidated Phase 1–5 track map against the actual `main` git history. Doc-only findings — no code changes proposed here.*

---

## TL;DR

The track map's engineering content holds up — I spot-checked several of its claims (paint2d stub count, `renderer.ts`/`cityRenderer.ts` untouched) directly against the repo and they're accurate. The problem is the doc's own bookkeeping has drifted from `main`: it hasn't been edited since commit `44f624b`, but `main` has since merged **7 more PRs** (#96, #104–#109) that aren't reflected. One of those gaps is a genuine duplicate-numbering bug worth fixing before anyone else adds "Revision note 7" on top of it.

Everything below is reproducible from `git log` — commit hashes included so the team can verify independently.

---

## Finding 1 — Duplicate "Revision note 6" (doc lines 11–12)

The file currently has **two** sections both labeled "Revision note 6" — one from the `paint2d` worktree, one from the `charterPort` worktree. This isn't a typo; reconstructing the timeline from `git log` shows exactly how it happened:

| Time (2026-08-17) | Commit | Event |
| :--- | :--- | :--- |
| 06:39 | `5a7a337` | PR #104 (battleScene) merges, adds "Revision note 5" |
| 06:54 | `499fc41` | PR #105 (charterPort) merges. Per its own text, this branch *also* wrote itself as "note 5," hit a literal merge conflict against #104's note, and manually resolved by renumbering itself to "note 6" |
| 08:49 | `44f624b` | paint2d branch commit adds its own "Revision note 6" — written independently, from a branch that never picked up charterPort's renumbering |
| 12:24 | `cd345b0` | PR #108 (paint2d) merges. Because the two notes insert at *different points* in the file, git merges them with no text conflict — so nothing forced anyone to notice the duplicate |

One collision (note 5) got caught because both branches inserted at the same location and forced a manual merge-conflict resolution. The other (note 6) didn't, purely because the insertion points differed. That's a process gap, not a one-off mistake — the same silent-duplicate failure mode will recur any time two parallel worktrees both self-number the next revision note.

**Compounding detail:** commit `c96d51b` (11:44, *"docs(plan): refresh stale status indicators across plan docs"*) explicitly reviewed this file and stated *"revision notes 1-5 already in main... next session will add note 6 there once PR #108 merges."* That was already inaccurate when written — PR #105's "note 6" had merged nearly 5 hours earlier. So the dedicated staleness-audit pass had a blind spot on the exact file it named as "the live source of truth."

**Fix:** renumber the second "Revision note 6" (the charterPort one, doc line 12) to "Revision note 7."

---

## Finding 2 — §11 "Open PRs Awaiting Merge" is stale

Currently reads:

> *"None open. Merge order on 2026-08-17 ... #92 → #91 → #93 → #94 → #95. **Phase 4 is now fully done.**"*

`main`'s actual history since then:

```
499fc41  PR #105  phase3/track-a-charter-port
8180f29  PR #106  fix/issue-98-100-error-handling-and-feedback
27c166f  PR #107  phase3/track-a-charter-port (Copilot review follow-up)
cd345b0  PR #108  phase5/track-b-paint2d-canvas2d-painter
edb8f21  PR #109  phase5/track-b-battlescene-renderer-rewrite (doc-only — see note below)
```

(plus PR #96 and #104, already referenced in the doc's own revision notes 3–6 but never rolled into this section).

**Fix:** refresh the merge-order list through #109, or drop the hand-maintained list in favor of a pointer to `git log --oneline main`.

*Side note on #109: despite the branch name (`phase5/track-b-battlescene-renderer-rewrite`, same name as #104), this PR's diff is doc-only — it's the `c96d51b`/`8071da6` stale-status-refresh commits, not a second renderer rewrite. The branch name is a leftover/reused name, not a signal that the live-render rewrite has started. Worth a one-line clarification if this file gets updated, so nobody misreads the branch name as meaning `renderer.ts` work has begun.*

---

## Finding 3 — PR #106 touched Track 5.A's surface but isn't tracked

PR #106 (`fix/issue-98-100-error-handling-and-feedback` — global error middleware, `NODE_ENV` handling, command-rejection toasts) modified:

- `src/io/commands.ts`
- `src/game/turnHooks.ts`

Both are inside Track 5.A's owned surface per the doc's own ownership matrix (§2, §8), but the PR isn't mentioned anywhere in the track map.

**Fix:** add a line noting PR #106's touch on these files under §7.1 (Track 5.A).

---

## What I verified holds up (no action needed)

To make sure this wasn't purely a documentation-process critique, I spot-checked a few of the doc's substantive engineering claims against the current repo state:

- `src/render/scene/paint2d/index.ts` still contains 33 stub/no-op/TODO markers — consistent with the doc's "28 stubs, all no-ops, not yet transcribed" claim (§7.2).
- `src/render/renderer.ts` and `src/render/cityRenderer.ts` haven't been touched since before Phase 5 work started (last real change: `400b5e2`, the scene-graph-builders commit) — confirms the doc's claim that the live-render-path rewrite genuinely hasn't started, and that PR #109 (despite its branch name) didn't touch it either.

The underlying phase/track status reporting is trustworthy; it's specifically the meta-layer (revision-note numbering, the open-PR ledger) that's fallen behind.

---

## Recommended actions

1. Renumber the duplicate "Revision note 6" → "Revision note 7" (doc line 12).
2. Refresh §11 to reflect PRs #96, #104–#109, or replace it with a `git log` pointer.
3. Add PR #106 to Track 5.A's history (§7.1).
4. **Process suggestion:** the revision-note preamble is now 7 entries of dense prose ahead of the actual status tables, and it just produced a silent duplicate because two branches numbered notes independently with no shared counter. Consider fixing this by requiring the *last* branch to merge into `main` before opening a plan-doc PR to always rebase and re-check the current highest revision-note number, or the harder-but-stabler fix — fold each note's substance directly into the relevant table row when it lands (the doc already does this well in a lot of places) and keep the prose down to a short changelog line, so there's no numbered sequence for parallel worktrees to collide on at all.
