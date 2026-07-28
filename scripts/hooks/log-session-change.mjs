import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const TRACKED_TOOLS = new Set([
  'apply_patch',
  'create_file',
  'edit_notebook_file',
  'vscode_renameSymbol',
  'mcp_gitkraken_cli_git_add',
  'mcp_gitkraken_cli_git_commit'
]);

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function normalizeToolName(rawToolName) {
  if (!rawToolName) return '';
  const trimmed = String(rawToolName).trim();
  const withoutPrefix = trimmed.startsWith('functions.') ? trimmed.slice('functions.'.length) : trimmed;
  const parts = withoutPrefix.split('.');
  return parts[parts.length - 1];
}

function findToolName(payload, rawText) {
  const candidates = [
    payload?.toolName,
    payload?.tool_name,
    payload?.tool,
    payload?.hookSpecificInput?.toolName,
    payload?.hookSpecificInput?.tool_name,
    payload?.input?.toolName,
    payload?.input?.tool_name,
    payload?.recipient_name,
    payload?.name
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeToolName(candidate);
    }
    if (candidate && typeof candidate === 'object' && typeof candidate.name === 'string') {
      return normalizeToolName(candidate.name);
    }
  }

  const match = rawText.match(/"(recipient_name|toolName|tool_name|name)"\s*:\s*"([^"]+)"/i);
  if (match && match[2]) {
    return normalizeToolName(match[2]);
  }

  return '';
}

function collectPaths(value, results) {
  if (!value) return;

  if (typeof value === 'string') {
    if (/[/\\]/.test(value) || /\.[A-Za-z0-9]+$/.test(value)) {
      results.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPaths(item, results);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/filePath|path|dirPath|old_path|new_path|oldPath|newPath|files/i.test(key)) {
        collectPaths(item, results);
      } else if (typeof item === 'object') {
        collectPaths(item, results);
      }
    }
  }
}

function toWorkspaceRelative(p, rootDir) {
  try {
    const absolute = path.isAbsolute(p) ? p : path.resolve(rootDir, p);
    const relative = path.relative(rootDir, absolute);
    if (!relative || relative.startsWith('..')) return p.replace(/\\/g, '/');
    return relative.replace(/\\/g, '/');
  } catch {
    return p.replace(/\\/g, '/');
  }
}

function getActor(rootDir) {
  try {
    const name = execSync('git config user.name', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim();
    if (name) return name;
  } catch {
    // ignore
  }

  try {
    const email = execSync('git config user.email', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim();
    if (email) return email;
  } catch {
    // ignore
  }

  return 'Unknown';
}

function dateStamp(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeStamp(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function ensureDailyLog(logFile, date, actor) {
  if (fs.existsSync(logFile)) return;
  const initial = [
    `# Session Tracking Log - ${date}`,
    '',
    '## Session Metadata',
    `- Date: ${date}`,
    `- Actor: ${actor}`,
    '',
    '## Entries',
    ''
  ].join('\n');
  fs.writeFileSync(logFile, initial, 'utf8');
}

function appendEntry(logFile, data) {
  const lines = [];
  lines.push(`### ${data.date} ${data.time}`);
  lines.push(`- Source: Hook PostToolUse`);
  lines.push(`- Actor: ${data.actor}`);
  lines.push(`- Tool: ${data.toolName || 'Unknown'}`);
  lines.push('- Files changed:');

  if (data.files.length === 0) {
    lines.push('  - Unknown (tool arguments did not include file paths)');
  } else {
    for (const f of data.files) {
      lines.push(`  - ${f}`);
    }
  }

  lines.push('- Notes:');
  lines.push('  - Auto-logged after a successful write/edit tool invocation.');
  lines.push('- Revert notes:');

  if (data.files.length === 0) {
    lines.push('  - Use git diff to identify touched files, then run git restore --source=HEAD -- <file>.');
  } else {
    lines.push(`  - git restore --source=HEAD -- ${data.files.join(' ')}`);
  }

  lines.push('');
  fs.appendFileSync(logFile, lines.join('\n') + '\n', 'utf8');
}

async function main() {
  const raw = await readStdin();
  const payload = safeParseJson(raw);
  const toolName = findToolName(payload, raw);

  if (!TRACKED_TOOLS.has(toolName)) {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  const rootDir = process.cwd();
  const now = new Date();
  const date = dateStamp(now);
  const time = timeStamp(now);
  const actor = getActor(rootDir);

  const discovered = new Set();
  collectPaths(payload, discovered);
  const files = [...discovered]
    .map((p) => toWorkspaceRelative(p, rootDir))
    .filter((p) => p && p !== '.');

  const logDir = path.join(rootDir, 'sessionTracking');
  const logFile = path.join(logDir, `${date}.md`);
  fs.mkdirSync(logDir, { recursive: true });
  ensureDailyLog(logFile, date, actor);
  appendEntry(logFile, { date, time, actor, toolName, files });

  process.stdout.write(JSON.stringify({ continue: true }));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
});
