# Fast-forward the heroes-js checkout's main to github/main

**Status:** DONE — local `main` fast-forwarded from `0e8a34c` to `b6646da`; all verifications pass.

## SHAs

| | SHA | Subject |
|---|---|---|
| Before | `0e8a34cf60e94dca14b26886da68fe9942983943` | docs(pods): document the pod entry points and the env handoff |
| After | `b6646daa7cc271ae7861f57db70157fbb77de692` | Merge pull request #278 from JLRoper/wtgui/fix-the-settlement-place-58da1e |
| github/main | `b6646daa7cc271ae7861f57db70157fbb77de692` | — |

## Verification (real output)

### HEAD equals github/main, both rev-list directions empty

```
$ git rev-parse HEAD
b6646daa7cc271ae7861f57db70157fbb77de692
$ git rev-parse github/main
b6646daa7cc271ae7861f57db70157fbb77de692
$ git rev-list --count HEAD..github/main
0
$ git rev-list --count github/main..HEAD
0
```

### The twelve incoming commits, by subject

```
b6646da Merge pull request #278 from JLRoper/wtgui/fix-the-settlement-place-58da1e
d7d8fd0 docs(cityview): record the placement feedback and the quiet confirm
d11e945 chore(release): 0.37.1 with the settlement-placement fixes
1cd805e fix(cityview): a repeated cart commit writes nothing
8d382e3 fix(cityview): a grid click places from its own coordinates, and a refusal says why
9b68473 Merge pull request #277 from JLRoper/wtgui/hero-resource-pickup-acc-f7e790
5012dba Merge remote-tracking branch 'github/main' into wtgui/hero-resource-pickup-acc-f7e790
1f3e3ec feat(heroes): pick resources up off the adventure map
87c4941 chore(scripts): helper shells inherit instead of opening their own
69c61cc fix(tooling): no repo script starts a process through a shell
11b108c fix(tests): the suites that spawn their own servers stop opening windows
7823196 fix(tests): stop the test/dev spawn chain opening console windows
```

### package.json version before and after

- Before (`0e8a34c`): `"version": "0.36.4",`
- After (`b6646da`): `"version": "0.37.1",`

### Working tree clean after the merge

```
$ git status --porcelain
(empty)
```

The pre-merge check was also empty; the tree was clean before the fast-forward and stayed clean after it. Nothing was stashed, and nothing was applied, popped, or dropped.

### Stash list unchanged — two entries, same subjects

```
stash@{0}: On main: WIP: wholesale deletion of packages/contracts + packages/engine (131 tracked paths, all under packages/, files absent from disk, no modifications and no untracked files beside them) - not authored by this session. Proven superseded by github/main before clearing: every one of the 131 paths exists on github/main (114 byte-identical, 17 are main's own forward edits) and all 746 exported symbols from those files are found by git grep on github/main; HEAD 9506422 is an ancestor of github/main. Stashed (never dropped) before ff to github/main.
stash@{1}: On main: WIP biome arena backgrounds (superseded by merged feat/battle-arena-backgrounds) - stashed 2026-10-23 before ff to github/main
```

## Merge transcript (tail)

```
Updating 0e8a34c..b6646da
Fast-forward
 66 files changed, 3170 insertions(+), 86 deletions(-)
```

New files the fast-forward brought in include `packages/contracts/src/commands/pickupResource.ts`, `packages/engine/src/hero/pickupResource.ts`, `server/migrations/034_resource_deposits.sql`, `src/screens/settlements/cityView/commitSignature.ts`, five new test files, and `tools/resolve-tool-entry.mjs` / `.d.mts`.

## Scope discipline

- The fast-forward was run on the primary checkout at `C:/ProjectDevelopment/heroes-js`, not inside any worktree.
- No worktree under `.worktrees` was touched (no files changed, no git state changed).
- Nothing was pushed to any remote from the primary checkout.
- No dev servers were started; `hermes update` was not run.
- The two existing stashes were left exactly as they were.
