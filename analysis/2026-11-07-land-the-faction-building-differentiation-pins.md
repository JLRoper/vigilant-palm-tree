# Landing report — the faction building-set pins (PR #380)

**Verdict: LANDED.** PR #380 merged into `main` as `d665ff0` at 2026-11-07T08:44:31Z. Nothing was re-measured: the five pinned tests, the mutation-checked pin and the shipped-data report are the branch's own bytes, unchanged.

## What was landed

Branch `wtgui/measure-the-buildings-si-d28c03` at `e48040f` — one commit, four files: `test/data/factionBuildingDifferentiation.test.ts` (215 lines, 5 tests), `analysis/2026-11-07-faction-building-differentiation.md` (198 lines), a `CHANGELOG.md` entry and the `package.json` bump. The PR carried no status checks and was `CONFLICTING / DIRTY` when this card picked it up.

Final head `c018fa9` (`chore(release): 0.53.20 …`), merge commit `d665ff0`.

## The conflict, and the number

`git fetch github`, then main came into the branch **by name** — three times, because main moved twice while the gate was running:

| brought in | main's version | what conflicted | my resolution |
|---|---|---|---|
| `a4e755c` (#379, debug surface) | 0.53.17 | `CHANGELOG.md` only | main's entry kept, branch bumped to **0.53.18** |
| `0bec8ef` (#377, visual baselines) | 0.53.18 | `CHANGELOG.md` only | main's entry kept, branch bumped to **0.53.19** |
| `73b08df` (#381, collision art wave 2) | 0.53.19 | `CHANGELOG.md` only | main's entry kept, branch bumped to **0.53.20** |

Only `CHANGELOG.md` ever conflicted. `package.json` auto-merged each time, because both sides had bumped to the *same* number — so the tree silently inherited main's version and the branch's number had to be taken one patch above it, by `node scripts/bump-version.mjs 0.53.X`, never by hand-editing past the gate. No hook was bypassed or `--no-verify`'d for a refused gate; the pre-commit/pre-push hooks on this box are the panel's push guard (policy `allow`) and no version hook exists, so the gate was applied procedurally from `.kilo/agent/precommit-checker.md`: changeset is test + analysis + version only, so **patch**, taken above main each round.

## The two measured files did not move

Byte-identical at every step — compared by git blob, which is exact and CRLF-independent:

| file | blob at `e48040f` (measured) | blob at `c018fa9` | blob on `main` (`d665ff0`) |
|---|---|---|---|
| `test/data/factionBuildingDifferentiation.test.ts` | `2cfa8ee886c7d771ef499fc8982fcef514d16235` | same | same |
| `analysis/2026-11-07-faction-building-differentiation.md` | `14c7a8136419ddab672db3d048b021202506e4bf` | same | same |

The working-tree sha256 recorded before the first merge (`1dbd7aa6…` for the test, `eb1684e1…` for the report) also re-verified after each merge. The faction sets were not re-derived by hand; the tests are the measurement and they ran as written.

## Gate on the resolved tree (`c018fa9`)

Every step run in this worktree, on the exact tree that was pushed:

- `npm run build` — tsc + vite, **built** (chunk-size warnings only, pre-existing).
- `npm run lint:deps` — **no violations**, 547 modules / 1841 dependencies.
- `npm run test:types` — application **clean** (0 errors); test tree **296 known / baseline 296**, no regression, no stale entry.
- `node tools/docs-check.mjs --changed-from github/main` — **passed**, selective: 4 changed files, freshness enforced for the 4 owned docs (`docs/army.md`, `docs/asset-provenance.md`, `docs/sprite-pipelines.md`, `src/render/docs/technical-spec.md`), 221 local links, 567 source paths.
- `npm run test:unit` — **3035 / 3035 pass, 0 fail** (3034 on the first resolution; `#381` added one).
- The pin file alone: `npx tsx --test test/data/factionBuildingDifferentiation.test.ts` — **5 / 5**.
- Game-wiping suites, against a database of my own (`PGDATABASE=game_poc_land_bldg_5c0b4d9a`, local docker Postgres — three sibling cards are live on theirs): `smoke` **PASS**, `cityview` **PASS**, `districts` **PASS**, each `0 failed, 0 did not run`. `smoke` is the suite that deletes every game in the database it is pointed at, which is why it ran on a private one.

`visual` was not re-run: this changeset touches no rendering code or baseline, and the branch's own card ran 13/13 scenes.

## Verified from main, by content

After the merge, from `github/main` at `d665ff0`:

- `test/data/factionBuildingDifferentiation.test.ts` **present**, blob `2cfa8ee8…` — identical to the measured commit.
- `analysis/2026-11-07-faction-building-differentiation.md` **present**, blob `14c7a813…` — identical.
- `package.json` `"version": "0.53.20"` — the number this card pushed.
- `git diff github/main..c018fa9` for `test/data` and `analysis` — **empty**: every added line the branch carried is on main.

## Mechanics worth knowing

The branch was checked out in the sibling worktree `…/.worktrees/measure-the-buildings-si-d28c03`, and git refuses one branch in two trees. That tree was clean at `e48040f`, so it was detached (`git checkout --detach`) — same files, same commit, nothing lost — the branch was checked out here, and after the merge the sibling was put back on it. A landing card that has to merge another card's branch will hit this same wall.

## What this landing did NOT do

The measurement's own finding stands unaddressed: 7 duplicate groups in the 123-file registered pixel family, one of them cross-faction (`building-pixel-ramPens-1.png` == `building-pixel-stables-1.png`, ironmark == human), so 1 of the 6 seat-faction pairs still ships byte-identical building art. That is the report's E1 and it is not pinned, because a distinctness test would fail today. Landing #380 pins only what holds.
