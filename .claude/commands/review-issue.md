---
description: Review a branch (or PR) against the GitHub issue it claims to close, plus a general pass against the project docs
argument-hint: [branch|PR#] [issue#]
---

Use the `code-review-issues` subagent (Agent tool, subagent_type: code-review-issues) to review a branch against its issue. Run it in the foreground so I get the report immediately.

Arguments I passed: `$ARGUMENTS`

Interpret them loosely and pass what you worked out to the subagent:

- Two values → the first is the branch (or PR number), the second is the issue. Either may be written bare (`88`), with a hash (`#88`), or prefixed (`issue88`, `issue-88`, `pr-42`) — strip the decoration.
- One value → tell the subagent that's all I gave, and let it resolve the other side (issue number from the branch name/commits, or the branch from an open PR referencing the issue).
- No arguments → the target is the current branch; the subagent resolves the issue from there.

If the branch I named is `main`, that's almost certainly not what I meant — check with me before reviewing `main` against an issue.

Do not review the diff yourself first, and do not pre-empt or summarize away the subagent's findings. Relay its report as written. It's a read-only review: nothing gets edited, committed, pushed, or posted to GitHub off the back of it unless I ask separately.
