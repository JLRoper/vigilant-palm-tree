# Plan: Sign-In Flow Enhancements

*Authored 2026-08-24, in worktree `plan-sign-in-enhancements` off `main` at `0cff923`. Follows up on `plan/2026-08-17-auth-wiring-and-per-game-membership.md` (issue #179, PRs #181/#182), which is fully merged: magic-link (OTP-code) sign-in exists end-to-end -- `server/auth.ts`, `src/io/auth.ts` + `authStorage.ts`, and a modal in `src/screens/home/homeView.ts`. Sign-in is deliberately optional (`docs/auth-model.md`); this plan does not revisit that decision.*

**Status (2026-08-24): not started, no PRs open.** This plan is scoped to *enhancing* the existing flow -- closing gaps found by reading the current implementation, not building sign-in from scratch.

---

## 1. Context: what exists today

Verified by reading the code directly in this worktree, not from the (now partly stale) follow-up list in the original #179 plan doc:

- `server/auth.ts`: `POST /auth/request-code` generates a 6-digit code, hashes it (`sha256(email:code)`), stores it in `auth_codes` with a 10-minute TTL, and **`console.log`s the plaintext code** (`server/auth.ts:102`). Outside `NODE_ENV=production` it also echoes the code back in the JSON response as `devCode` (`server/auth.ts:107`), which is how tests and local dev drive the flow.
- `POST /auth/verify-code` checks the hash, marks the code consumed, and issues a 32-byte random bearer token stored in `user_sessions` with a 30-day sliding TTL (`SESSION_TTL_MS`, refreshed on every authenticated request via `loadSession`).
- Client: `src/io/auth.ts` wraps the two endpoints plus `checkSession`/`logout`; `authStorage.ts` caches `{ token, email }` in `localStorage`.
- UI: `homeView.ts` has an email input, a 6-digit code input (disabled until a code is requested), send/verify/cancel buttons, and a status line. No other sign-in surface exists.
- Docs: `docs/auth-model.md` covers the *authorization* side (attachAuth/attachPlayerSeat, actor-vs-seat) well. It says nothing about delivery, rate limiting, or session lifecycle beyond the sliding TTL.

## 2. Gaps found (this plan's actual scope)

### 2.1 No production email delivery -- the flow cannot ship to real users as-is

There is no email-sending dependency anywhere in `package.json` (checked: no `nodemailer`, `sendgrid`, `postmark`, `resend`, `aws-sdk`). In production (`NODE_ENV=production`), `devCode` is withheld from the response, but nothing sends the code anywhere else -- it only reaches `console.log`. A real user in production has no way to receive their code today. This is the highest-priority item: everything else in this plan is about hardening a flow that currently cannot function for a real off-localhost user.

### 2.2 No rate limiting or brute-force protection

- `POST /auth/request-code` has no throttle -- anyone can spam codes to an arbitrary email (email-bombing) or hammer the endpoint for load.
- `POST /auth/verify-code` has no per-email/per-IP attempt counter or lockout. The code space is 6 digits (1,000,000 values) with a 10-minute window and no backoff, which is guessable at scale without a rate limit.

### 2.3 `auth_codes` / `user_sessions` grow unbounded

No migration or cron was found (`server/migrations/` has no cleanup job) that deletes expired `auth_codes` rows or expired `user_sessions` rows. `loadSession` lazily deletes a session row *the first time* an expired token is presented, but a token that's simply never reused again (abandoned session) is never cleaned up, and consumed/expired `auth_codes` rows are never deleted at all.

### 2.4 "Cross-device continuity" is promised but not implemented

The home screen's footer message (added in the #179 optional-sign-in follow-up) names cross-device continuity as a signed-in benefit. But `src/io/userGames.ts` -- the "your games" list shown on the home screen -- is **pure `localStorage`**, keyed by nothing account-related. Signing in on a second device will not surface games played on the first. This is the biggest gap between what's advertised and what's built.

### 2.5 No session management surface

Logout only clears the *current* token. There's no "sign out everywhere," no list of active sessions, and no way to revoke a session from another device (e.g. after losing a device that stayed logged in).

### 2.6 Naming mismatch: "magic-link" vs. what's actually built

Docs and code consistently call this "magic-link auth," but nothing clickable is ever emailed -- it's an OTP code the user types in manually. Worth a decision: rename references to "sign-in code" / "OTP," or actually add a click-through link as an alternative to typing the code.

### 2.7 Sign-in modal UX gaps (`src/screens/home/homeView.ts:452-561`)

- No resend button or cooldown timer once a code has been sent.
- No visible code-expiry countdown, even though the server already returns `expiresAt`.
- Enter key doesn't submit either input; only clicking the buttons works.
- Failure messages surface the raw `Error.message` text directly to the user (`` `Failed: ${msg}` ``), which can leak internal wording (e.g. raw HTTP body text from `request-code failed: 500 ...`).

### 2.8 No "remember me" / session lifetime choice

Every session is a flat 30-day sliding TTL with no shorter-lived option for a shared or public device, and no absolute cap independent of activity.

## 3. Priority ordering

| # | Item | Why this priority |
|---|---|---|
| 1 | §2.1 Email delivery | Blocks any real off-localhost usage; everything else is polish on top of a flow nobody outside dev can complete today |
| 2 | §2.2 Rate limiting | Security gap, cheap to close, should land alongside/before wider exposure once email delivery makes the endpoint reachable by real traffic |
| 3 | §2.4 Cross-device continuity | Closes the gap between what's advertised on the home screen and what's actually delivered |
| 4 | §2.3 Row cleanup | Operational hygiene, not urgent but cheap (one migration + a scheduled query or TTL index) |
| 5 | §2.5 Session management | Nice-to-have, no current user complaint driving it |
| 6 | §2.7 Modal UX polish | Low risk, low effort, can land anytime |
| 7 | §2.6 Naming | Cosmetic; bundle with whichever PR touches the modal or docs next |
| 8 | §2.8 Remember me | Defer until there's a concrete request for shared-device support |

## 4. Decisions (2026-08-24 walkthrough)

1. **Email provider (§2.1): Resend.** Fits a self-hosted, low-volume hobby deploy (confirmed: no existing email infra -- `.env.example` has no email vars, README already tracks "real email delivery comes later" as a known gap; deploy target is the Docker image on `tufton-harvester`, not any corporate mail system). New dependency (`resend` npm package or plain HTTPS call to its API), one new secret (`RESEND_API_KEY`) added to `.env.example` and the deploy environment. Domain verification with Resend is a nice-to-have for deliverability, not a hard blocker for a v1 -- can start from their default sending domain.
2. **§2.4 scope: games list *and* in-progress UI state move server-side.** Broader than the original recommendation -- in addition to `src/io/userGames.ts`'s list, other client-local UI state (e.g. settings, last-viewed screen) should also sync across devices for a signed-in user, not just the games list. This widens §2.4's eventual PR scope; needs its own inventory pass (which `localStorage` keys are account-scoped vs. genuinely device-local, e.g. window/canvas sizing) before implementation.
3. **§2.2 rate-limit shape: per-email throttle only**, no separate per-IP layer for v1. `request-code` gets a minimum interval between codes per email address; `verify-code` gets a failed-attempt lockout per email within the code's TTL window.
4. **§2.5 session management: single "sign out everywhere" button**, no dedicated sessions-list UI. Add one control near the existing logout that deletes all of a user's `user_sessions` rows, not just the current token's.

All four open questions are now resolved.

---

## 5. PR breakdown & status chart

| PR | Title | Status | Files | Depends on |
|---|---|---|---|---|
| **PR-B1** | Per-email rate limiting on `/auth/request-code` + `/auth/verify-code` | ⬜ not started | 1 new src, 1 modified (`auth.ts`), 1 new test | — |
| **PR-B2** | Real email delivery via Resend | ⬜ not started | 1 new src, 1 modified (`auth.ts`), `.env.example`, `package.json` | B1 (recommended, not code-blocking) |
| **PR-B3** | Cleanup job for expired `auth_codes` / `user_sessions` | ⬜ not started | 1 new migration, 1 new src (or modified startup) | — (parallel-safe) |
| **PR-B4** | "Sign out everywhere" | ⬜ not started | 1 modified (`auth.ts`), 1 modified (`src/io/auth.ts`), 1 modified (`homeView.ts`) | — (parallel-safe) |
| **PR-B5** | Cross-device continuity: server-side profile storage | ⬜ not started | 1 new migration, 1 new router, 1 new test | — (parallel-safe) |
| **PR-B6** | Cross-device continuity: client wiring (games list + UI state) | ⬜ blocked on B5 | modified `userGames.ts`, new `src/io/userProfile.ts`, modified `homeView.ts` | B5 |
| **PR-B7** | Sign-in modal UX polish + "magic-link" → "sign-in code" naming cleanup | ⬜ not started | modified `homeView.ts`, `docs/auth-model.md`, `README.md` | Best after B2 + B4 (see §5.2) |

**Status legend:** ⬜ not started · 🟡 in progress · ✅ merged · 🚫 blocked / deferred

### 5.1 Combined / can-merge-together status

| Combo | Why it can land together | When |
|---|---|---|
| **B1 alone first** | Pure hardening of the existing endpoints; useful even before real email ships (protects the current devCode-returning endpoint from abuse in any exposed dev/staging deployment) | First |
| **B1 + B2** | B2 is what makes the endpoints reachable by real, untrusted traffic in production — landing it without B1 already merged means shipping the abuse window this plan explicitly flagged in §2.2/§2.1's priority ordering | B2 should not merge ahead of B1 |
| **B3, B4** | Both fully independent of the B1/B2/B5/B6 chain — no shared files, no ordering constraint | Anytime, parallel-safe |
| **B5 + B6** | B6 is pure client consumption of B5's new endpoints; could theoretically land as one PR, but B5 alone (schema + endpoints + tests, no client changes) is a safe, independently reviewable/mergeable unit | Prefer separate; B6 immediately after B5 |
| **B7 last** | Touches the same modal file that B4 adds a button to; sequencing after B2 also means the "check your email" / "sending…" copy in the modal can be finalized against real delivery instead of the current devCode-shaped copy | Last |

### 5.2 Recommended PR shape

Seven PRs, landed roughly in this order: **B1 → B2 → (B3, B4 whenever, parallel) → B5 → B6 → B7**. B3 and B4 have no dependencies and can be picked up in parallel with the B1/B2 pair or the B5/B6 pair by a second contributor if useful.

---

## 6. File-level changes per PR

### 6.1 PR-B1 — Per-email rate limiting

**New files:**
- `server/middleware/authRateLimit.ts`
  - In-memory `Map<email, { lastRequestAt: number; failedAttempts: number; lockedUntil?: number }>` (mirrors the existing 5s per-process membership cache pattern in `attachPlayerSeat.ts` — no new infra needed for this scale).
  - `checkRequestCodeThrottle(email): boolean` — rejects if a code was requested for this email within the last N seconds (suggest 30-60s; exact value is a tuning call, not architectural).
  - `recordFailedVerify(email): void` / `isVerifyLocked(email): boolean` — locks further `verify-code` attempts for an email after 5 consecutive failures, until a fresh code is requested (which resets the counter) or the lock TTL (suggest matching `CODE_TTL_MS`, 10 min) expires.

**Modified files:**
- `server/auth.ts`
  - `POST /request-code` (line 87): call `checkRequestCodeThrottle` before generating a code; `429 { error: "rate_limited", retryAfterMs }` on reject.
  - `POST /verify-code` (line 115): call `isVerifyLocked` first (`429 { error: "too_many_attempts" }`); on a failed hash match, call `recordFailedVerify`; on success, clear the entry.

**New test file:** `test/server/authRateLimit.test.ts` — throttle rejects a second request-code within the window; succeeds after the window; verify-code locks out after N failures; lock clears on a fresh request-code.

**Test-suite impact:** none expected — `test/helpers/authFlow.ts`'s `uniqueTestEmail()` generates a fresh email per call, so per-email throttling never collides with the existing test suite's rapid-fire login flow.

### 6.2 PR-B2 — Real email delivery via Resend

**New files:**
- `server/email.ts`
  - `sendLoginCodeEmail(email: string, code: string, expiresAt: Date): Promise<void>`, calling Resend's HTTPS API directly (a single `fetch` call is enough — avoids adding the full `resend` SDK as a dependency for one call site, though the SDK is fine too if preferred for its typings).
  - Reads `RESEND_API_KEY` from `process.env`; throws if unset and `NODE_ENV === "production"` (fail loud rather than silently not sending in prod).

**Modified files:**
- `server/auth.ts`
  - `POST /request-code` (line 87): after generating the code, call `sendLoginCodeEmail` **only when `NODE_ENV === "production"`** — mirrors the existing `devCode` gate exactly (line 107), so dev and the entire test suite are unaffected and never make a real network call to Resend. Log-and-continue on send failure rather than failing the request (the code is already persisted; a transient email failure shouldn't block a retry).
- `.env.example`: add `RESEND_API_KEY=` with a comment explaining it's required in production only.
- `package.json`: no new dependency if using a plain `fetch` call; otherwise add `resend`.

**Decision needed before merge:** sending domain — start from Resend's default shared domain (works immediately, weaker deliverability/branding) vs. verifying a real domain first (better deliverability, requires DNS access to whatever domain the game is deployed under). Not a blocker either way; can switch domains later without a code change.

### 6.3 PR-B3 — Cleanup job for expired auth rows

**New files:**
- `server/migrations/012_auth_cleanup_indexes.sql` (next available migration number as of this writing — confirm no collision with other in-flight branches before merging) — adds indexes on `auth_codes(expires_at)` and `user_sessions(last_seen_at)` to make the delete queries below cheap.
- `server/jobs/authCleanup.ts` — a `setInterval` job started alongside the server (pattern: check how `presenceRegistry.ts` or similar in-process background work is started today and match it) that periodically runs:
  - `DELETE FROM auth_codes WHERE expires_at < now()`
  - `DELETE FROM user_sessions WHERE last_seen_at < now() - interval '30 days'` (matches `SESSION_TTL_MS`)

**No route or client changes.** Purely operational; no behavior change to the auth flow itself.

### 6.4 PR-B4 — "Sign out everywhere"

**Modified files:**
- `server/auth.ts`: new `authRouter.post("/logout-all", ...)` — reads the bearer token via `readBearerToken`, resolves the session to get `email` (401 if no valid session — this is the one auth endpoint where being unauthenticated is meaningfully an error, since "sign out everywhere" is meaningless without an identity to act on), then `DELETE FROM user_sessions WHERE email = $1`.
- `src/io/auth.ts`: new `logoutAll(token: string): Promise<void>`, same shape as the existing `logout`.
- `src/screens/home/homeView.ts`: add a "Sign out everywhere" control next to the existing logout button (around the same UI region as `handleLogout`, line 563), with a brief confirming label since it's a broader action than the current logout.

### 6.5 PR-B5 — Cross-device continuity: server-side storage

**New files:**
- `server/migrations/013_user_profiles.sql` — new table:
  ```sql
  CREATE TABLE user_profiles (
    email TEXT PRIMARY KEY,
    games JSONB NOT NULL DEFAULT '[]',
    ui_state JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
  Keyed directly by email (no surrogate `users` table exists today, and nothing else in the schema needs one yet — matches this codebase's existing preference for JSONB-on-a-natural-key over new junction tables, per §2.1 of the #179 plan).
- `server/user.ts` (or `server/http/routes/user.ts`, matching the `server/http/routes/commands.ts` convention) — new router:
  - `GET /user/profile` — requires `req.authEmail` (401 if unset); returns `{ games, uiState }`, upserting an empty row on first read.
  - `PUT /user/profile` — requires `req.authEmail`; body `{ games?, uiState? }`, merges into the row, bumps `updated_at`.
  - Mounted in `server/routes.ts` behind `attachAuth` only (same pattern as `/lobby/claim`): `router.use("/user", attachAuth, userRouter)`.
- `test/server/userProfile.test.ts` — round-trip read/write, 401 when signed out, merge semantics (a `PUT` with only `games` doesn't clobber an existing `uiState`).

**No client changes in this PR** — server-side only, reviewable and testable in isolation before any client wiring exists.

### 6.6 PR-B6 — Cross-device continuity: client wiring

**Preliminary step (do first, before writing code):** the inventory pass called for in §4 item 2 — walk every `localStorage` key currently written by the client (`heroesJs.userGames`, `heroesJs.authToken`/`heroesJs.authEmail` themselves, plus whatever else exists — a repo-wide grep for `localStorage.setItem` will find them all) and classify each as account-scoped (belongs in `user_profiles.ui_state`) vs. genuinely device-local (e.g. window/canvas sizing, anything tied to the physical screen). Record the classification in this plan doc (or a short addendum) before touching code, since it's the actual scope-defining decision for this PR.

**New files:**
- `src/io/userProfile.ts` — `fetchUserProfile()`, `pushUserProfile(partial)`, thin wrappers over the new `/user/profile` endpoints, following `src/io/auth.ts`'s existing shape.

**Modified files:**
- `src/io/userGames.ts` — on sign-in, pull the server copy and reconcile with whatever's in `localStorage` (last-write-wins by `lastSeenAt` per game is the simplest merge rule); on every local mutation (`rememberGame`/`forgetGame`/`bumpLastSeen`) while signed in, push the updated list to the server (debounced, not on every keystroke-equivalent event). `localStorage` stays as the offline/anonymous-play cache — this is additive, not a replacement.
- Whichever modules own the account-scoped keys identified in the inventory step above, same pattern.
- `src/screens/home/homeView.ts` — trigger the initial profile pull right after a successful `verifyLoginCode` / `checkSession` resolves (near line 200 and line 539).

### 6.7 PR-B7 — Modal UX polish + naming cleanup

**Modified files:**
- `src/screens/home/homeView.ts` (lines ~452-561):
  - Resend button + cooldown timer (disable "Send code" for the same window PR-B1 enforces server-side, so the UI doesn't invite a 429 the user can't explain).
  - Show the code's `expiresAt` (already returned by `requestLoginCode`, currently discarded) as a live countdown or a static "expires at HH:MM" line.
  - Enter-key submit on both the email and code inputs (currently mouse-only).
  - Map known server error codes (`invalid code`, `code expired`, `code already used`, the new `rate_limited`/`too_many_attempts` from B1) to friendly copy instead of interpolating the raw `Error.message` into `` `Failed: ${msg}` `` (line 546).
- `docs/auth-model.md`, `README.md` (line 39): replace "magic-link" phrasing with "sign-in code" throughout, since nothing clickable is ever emailed — this PR is also a natural place to note real email delivery has landed (removing the README's "real email delivery comes later" line from the deferred list).

---

## 7. Validation gates

Every PR must pass the existing suite: `npm run build`, `npm run lint:deps`, `npm run validate-assets`, `npm run test:all`.

**Additional gate for B2:** confirm via a manual check (not CI, since it'd require a live Resend key) that a production-mode run actually sends mail — e.g. a one-off local run with `NODE_ENV=production` and a real `RESEND_API_KEY` against a throwaway inbox.

**Additional gate for B5:** migration runs cleanly against a fresh Postgres and is idempotent (re-running is a no-op, matching the existing migration conventions in this repo).

**Additional gate for B6:** manually verify the actual cross-device scenario end-to-end (sign in on two browser profiles / devices, confirm a game remembered on one appears on the other) — this is the one behavior in this whole plan that no automated test can meaningfully assert without a second real client.
