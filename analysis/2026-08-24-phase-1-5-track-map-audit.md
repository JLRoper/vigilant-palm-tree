# Phase 1–5 Track Map Audit (2026-08-24)

*Audits: `plan/2026-08-17-consolidated-phase-1-5-track-map.md` and its companion
`plan/2026-08-19-phase-1-5-audit-issue-sequencing.md`, against the tree at
`main@0cff923` and live GitHub issue/PR state (`JLRoper/vigilant-palm-tree`).*

*Method: read both plan docs in full, then independently verified their load-bearing
claims against the actual code (`Read`/`Grep`), `git log`, `npm run build`,
`npm run lint:deps`, and `gh issue`/`gh pr` state — rather than trusting either
document's own narrative. Findings below are grouped by how they were confirmed.*

---

## Summary

Phases 1–4 are genuinely done; their track-map claims check out against the code
(build green, `lint:deps` 0 violations across 336 modules / 1013 deps, dual-write
and repository layer present as described). Phase 5 is further along than the
track-map's own prose suggests, but the document has stopped being the source of
truth for it — tracking moved to `plan/2026-08-19-phase-1-5-audit-issue-sequencing.md`
partway through, and that companion doc itself now has an internal contradiction
that a live GitHub comment thread already resolved, while the docs at rest in the
repo still say the old thing.

Four findings below matter enough to act on:

1. The track-map is stale relative to its own companion doc (§1).
2. The companion doc's most recent status update makes a claim about auth/trust
   that the shipped code contradicts, and that has already been corrected in a
   GitHub issue comment — but not in any committed document (§2).
3. Two issues opened in the last two days aren't referenced by either plan doc,
   one of which undermines the evidentiary basis ("`npm run test:all` green") that
   both docs lean on throughout (§3).
4. Everything else checked out (§4).

---

## 1. The track-map is stale — tracking moved to a companion doc it doesn't mention

`plan/2026-08-17-consolidated-phase-1-5-track-map.md`'s last entry is revision
note 12 (2026-08-23, closing issue #152). Since then, three more status passes
happened — but in `plan/2026-08-19-phase-1-5-audit-issue-sequencing.md`'s §0/§0.1/§0.2,
not in the track-map. The track-map was never updated to match, so it now
misstates status in at least these places:

- **§7.1 and §1**: still describe Track 5.A as "only #147 left." **#147 is closed.**
  Verified directly in code: `src/managers/SessionManager.ts:73-81`'s `manualSave()`
  now calls `turnController.flushPendingCommands()` and reads
  `getLastPersistedAt()` — the full-state `PATCH` the track-map describes is gone.
- **§12's issue table** still lists `#147` as an open wave-3 item with no
  strikethrough, contradicting its own §10/§7.1 prose elsewhere in the same
  revision.
- Neither the track-map nor its own revision-note history has any mention of
  issue #179 (auth wiring) or PR #181, both of which materially affect the status
  of #153 — see §2 below.

**Recommendation:** fold the sequencing doc's 2026-08-22 through -24 updates back
into the track-map in one pass, per the sequencing doc's own stated discipline
("each PR edits only its own status row; the full rewrite happens once, at the
end" — §6 of that doc). This is what issue #155 was for previously; that issue is
closed, so this needs a fresh one (opened as part of this audit — see below).

---

## 2. A live GitHub comment thread contradicts the committed doc — #153's trigger condition

This is the most interesting finding, because it isn't a case of "the doc is old
and code moved on" — it's a case of a *later* commit to the doc itself making a
claim that the code it describes doesn't support, and that mistake being caught
and corrected in a GitHub issue comment that never made it back into any
committed file.

**What the sequencing doc says (§0, dated 2026-08-24):**

> "**#153's blocker is now concretely in flight...** Net effect once PR #181
> merges: #153's second trigger condition has fired — every route requires an
> authenticated, seat-claimed caller."

**What actually shipped, verified by reading the code PR #181 merged:**

- `docs/auth-model.md` (added by #181): *"**Sign-in is optional everywhere** --
  see `src/screens/home/homeView.ts`'s footer message. Nothing rejects an
  anonymous caller; being signed in only ever adds protection on top of what an
  anonymous caller already gets."*
- `server/middleware/attachPlayerSeat.ts`: its own header comment states
  "Sign-in is optional -- this never rejects the request... anonymous or
  unclaimed callers just proceed with `req.playerSeat` left unset, falling back
  to the client-trusted `actor` field the same way the app worked before #179."

So the shipped behavior is the opposite of "every route requires an
authenticated, seat-claimed caller" — anonymous callers remain fully trusted on
whatever seat they claim to act as, exactly as before #179/#181.

**Why the doc got this wrong:** commit ordering. The sequencing-doc update
(`510b868`, "Update Phase 1-5 audit sequencing status for 2026-08-24") was
authored and committed *before* PR #181 finished — at that point #181 was still
open and, per the doc's own §0, had a different (hard-auth) design. PR #181
changed direction mid-review to the optional-auth design actually shipped, then
merged (`34b0cda`) *after* `510b868` was written. Because `510b868` shipped to
`main` as part of the auth-wiring branch itself, the doc's prediction about what
#181 would do landed in the repo unrevised, even though the PR it was predicting
had already changed shape by the time it merged.

**This was caught — on GitHub, not in the repo.** A later comment on issue #153
(posted after #181 actually merged) walks it back explicitly:

> "PR #181 changed direction mid-review. Sign-in is now **optional**, not
> required... That means this issue's second trigger — 'the game first accepts
> untrusted players' — doesn't quite fire the same way anymore... Worth
> re-deciding this issue's trigger once #181 lands rather than treating it as
> automatically satisfied."

Issue #153 is confirmed **open** on GitHub as of this audit (2026-08-24), which
matches the corrected comment, not the doc's committed claim.

**Recommendation:** when the track-map/sequencing doc is next refreshed (see §1),
correct the #153 status narrative to match the GitHub comment thread — either
re-scope the trigger condition per the comment's option (a)/(b), or leave it
open and cross-link the comment thread directly so the reasoning isn't
re-litigated from scratch next time someone reads the doc instead of the issue.

---

## 3. Two issues from the last two days aren't referenced by either plan doc

### #180 — `EntityMirror` built and wired, but not consumed by the render path

`src/render/scene/entityMirror.ts` is live-consumed by `src/io/multiplayerSync.ts`
(bootstraps on resync, advances per delta event), but `MapRenderer.draw()` /
`adventureScene.ts` / `cityRenderer.ts` still rebuild `Hero[]`/`Castle[]`/
`Settlement[]` directly from the `GameState`-derived snapshot rather than reading
the mirror. This is exactly the track-map's own §7.2 exit criterion's second
half ("hero movement animations interpolate smoothly driven by event
subscriptions") — the track-map correctly predicted this would be blocked until
Track A delivered delta events (revision note behind §7.2), but once #146/#152
closed that blocker, nothing re-opened this as a tracked item until #180 landed
three days later. Concretely: `HeroMoved` deltas currently produce a snap instead
of a tween, and `SettlementCaptured` owner-color updates don't reach the canvas
until the next full resync, even though the mirror already has both.

### #175 — `test/smoke.ts`'s real test flow has been dead code since 2026-07-30

More serious, and worth flagging because both plan docs lean on "`npm run
test:all` ... all green" as their primary evidence bar in nearly every revision
note. `test/smoke.ts`'s `run()` currently only waits for client init, reads spawn
coordinates, and prints `>> ALL TESTS PASSED` — it never calls
`runNewLoadSaveFlow`, `runTilesEndpointChecks`, or any of the helper functions
that actually exercise New/Load/Save, the tiles endpoint, movement, or battle
resolution. `git log -S"rest of the test flow unchanged" -- test/smoke.ts` traces
this to commit `4a0ea6b` (2026-07-30), a diagnostics-focused refactor that cut
`run()` from ~1100 lines to ~50 and left `// ... rest of the test flow unchanged
...` placeholder comments instead of the actual calls.

Practical effect: every revision note in the track-map since late July that cites
"`npm run test:all` ... all green" as verification was true only for the slice
smoke.ts still exercised (client boot) — Save/Load, tile coverage, movement, and
battle resolution went unverified by CI for roughly three weeks, spanning several
of the phase-completion claims in this plan (including parts of Phase 5's
renderer cutover, #148, which cites `test:all` green as its acceptance evidence
alongside the dedicated visual-regression gate).

**Recommendation:** neither issue needs new filing — both are already open and
well-specified (#180 has a 3-PR plan; #175 has a remediation plan). They just need
to be cross-linked from the track-map's §7.2 and §9 respectively so the next
reader doesn't have to rediscover them the way this audit did.

---

## 4. Confirmed accurate (spot-checked against code, not taken on the docs' word)

- **Phase 4's goal-vs-exit-criteria gap (#154, open, unowned).**
  `server/persistence/repositories/gameRepo.ts:145-146` still builds
  `sets = ["heroes = $1::jsonb", "settlements = $2::jsonb"]` on every
  `saveHeroesAndSettlements()` call — the normalized tables are still a second
  copy, not the copy, exactly as #154 and the track-map's R9 describe.
- **#153's underlying gap** (`upgradePopulationGate` client-trusted) — confirmed
  present in `packages/contracts/src/commands/upgradeSettlement.ts`, matches both
  docs' description (independent of the trigger-condition question in §2 above).
- **Build and dependency-boundary health.** `npm run build` succeeds cleanly;
  `npm run lint:deps` reports 0 violations across 336 modules / 1013 dependencies
  — consistent with the docs' running "all green" claims for the current tree
  (modulo the smoke-suite caveat in §3).
- **13 ported commands, all client-wired** — spot-checked `src/io/commands.ts`
  and `server/app/commandHandler.ts` against the sequencing doc's list; matches.

---

## Recommendation

1. Open a tracking issue for the doc refresh this audit implies (done — see PR
   description / issue link).
2. When that refresh happens, fold in the sequencing doc's 2026-08-22 → -24
   updates, correct the #153 narrative per §2, and cross-link #180/#175 from the
   relevant track-map sections per §3.
3. Consider whether `plan/2026-08-19-phase-1-5-audit-issue-sequencing.md` should
   keep being the place status updates land, or whether that should fold back
   into the track-map itself now that the original 13-issue audit set it was
   built around is nearly closed out (11 of 13, plus #179/#181 as an unplanned
   addendum). Splitting status across two docs is exactly the pattern that let
   finding §1 happen.
