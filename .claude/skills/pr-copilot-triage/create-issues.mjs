import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [file, repo, pr, tracker] = process.argv.slice(2);
if (!file || !repo || !pr || !tracker) {
  console.error("usage: node create-issues.mjs <issues.json> <owner/repo> <PR#> <tracker#>");
  process.exit(2);
}

const prUrl = `https://github.com/${repo}/pull/${pr}`;
const issues = JSON.parse(readFileSync(file, "utf8"));

for (const issue of issues) {
  const thread = issue.thread ? ` Copilot thread: ${prUrl}#${issue.thread}` : "";
  const body = `${issue.body}\n\n---\nFrom the review of #${pr} (full review: #${tracker}).${thread}`;
  const args = ["issue", "create", "--repo", repo, "--title", issue.title, "--body", body];
  if (issue.label) args.push("--label", issue.label);
  const url = execFileSync("gh", args, { encoding: "utf8" }).trim();
  console.log(`${url} | ${issue.title}`);
}
