# scripts/ports.ps1
#
# ============================================================
#  PORT ALLOCATOR (no launches, no Agent Manager)
# ============================================================
# Picks one free TCP port per service and writes them to .env in the
# current worktree. Idempotent and cheap; safe to run multiple times.
#
# USAGE
#   pwsh scripts/ports.ps1            # dynamic: free ports on every run
#   pwsh scripts/ports.ps1 --static   # static: deterministic per worktree
#
# The --static flag hashes the worktree's absolute path to derive a
# stable offset, so the SAME worktree always gets the SAME ports across
# runs, and DIFFERENT worktrees almost never collide. Use this when you
# want bookmarked URLs, pinned browser tabs, or stable port-forwarding.
# Omit --static (the default) when you just want any free ports.
#
# CONSUMERS OF .env
#   - Vite auto-loads .env files in cwd (no extra config needed for
#     `vite` to read CLIENT_PORT, API_PORT, etc.)
#   - Node 20+ scripts prefix with `node --env-file=.env`
#   - tsx forwards the Node flag: `tsx --env-file=.env ...`
#
# HOW IT FITS INTO package.json
#   "scripts": {
#     "predev":       "pwsh scripts/ports.ps1",
#     "dev":          "...your dev command reading .env...",
#     "dev:static":   "pwsh scripts/ports.ps1 --static && <dev command>",
#     "pretest":      "pwsh scripts/ports.ps1",
#     "test":         "...your test command reading .env...",
#     "test:static":  "pwsh scripts/ports.ps1 --static && <test command>"
#   }
#
# Run `npm run dev` for normal free-port allocation.
# Run `npm run dev:static` when you want stable ports for this worktree.
# ============================================================

[CmdletBinding()]
param(
    # Deterministic, hash-derived ports (same worktree = same ports).
    # Default ($false) picks fresh free ports on every invocation.
    [switch]$Static
)

$ErrorActionPreference = 'Stop'

# --- 0. Resolve worktree path ------------------------------------------
# No more Agent Manager / WORKTREE_PATH dependency. Just use cwd; that's
# always the worktree dir when invoked from `npm run ...` here.
$worktree = (Get-Location).Path
$envFile  = Join-Path $worktree '.env'

# --- 1. Load existing .env into process env (process env wins) ---------
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
            $name = $Matches[1]; $value = $Matches[2]
            if (-not (Test-Path -Path "Env:$name")) {
                Set-Item -Path "Env:$name" -Value $value
            }
        }
    }
}

# --- 2. Helpers ---------------------------------------------------------
function Test-PortFree {
    param([int]$Port)
    return -not [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}
function Find-FreePort {
    param([int]$Base, [int]$Max = 200)
    for ($i = 0; $i -lt $Max; $i++) {
        $p = $Base + $i
        if (Test-PortFree $p) { return $p }
    }
    throw "No free port found starting at $Base within $Max attempts."
}
function Get-StaticOffset {
    # SHA-256 of the worktree path; first 4 bytes -> uint32 -> mod 200 -> * 5
    # gives an offset in [0, 1000), stepping by 5. Stable across runs.
    $bytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [Text.Encoding]::UTF8.GetBytes($worktree))
    return ([BitConverter]::ToUInt32($bytes, 0) % 200) * 5
}

# --- 3. Pick port for each service --------------------------------------
$serviceBases = [ordered]@{
    API_PORT    = 4000
    WS_PORT     = 4100
    CLIENT_PORT = 5173
    DB_PORT     = 5432
    REDIS_PORT  = 6379
}

$offset = 0
if ($Static) { $offset = Get-StaticOffset }

foreach ($name in $serviceBases.Keys) {
    # Skip if already set in process env (manual override wins)
    if (Test-Path -Path "Env:$name") { continue }

    if ($Static) {
        # Deterministic: base + offset. No port-free check (one-time setup
        # decision; if a port is taken now, leave it - retry on next run).
        Set-Item -Path "Env:$name" -Value ([string]($serviceBases[$name] + $offset))
    } else {
        # Dynamic: first free port scanning upward from base
        Set-Item -Path "Env:$name" -Value ([string](Find-FreePort $serviceBases[$name]))
    }
}

# --- 4. Write the final port set back to .env (preserve other keys) ----
$existing = @{}
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
            $existing[$Matches[1]] = $Matches[2]
        }
    }
}
$changed = $false
foreach ($name in $serviceBases.Keys) {
    $current = (Get-Item -Path "Env:$name").Value
    if (-not $existing.ContainsKey($name) -or $existing[$name] -ne $current) {
        $existing[$name] = $current
        $changed = $true
    }
}
if ($changed -or -not (Test-Path -LiteralPath $envFile)) {
    $existing.GetEnumerator() | Sort-Object Key |
        ForEach-Object { "$($_.Key)=$($_.Value)" } |
        Set-Content -LiteralPath $envFile -Encoding UTF8
}

# --- 5. Report ----------------------------------------------------------
$branch = (& git -C $worktree rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch) { $branch = '(detached)' }
$mode = if ($Static) { 'static' } else { 'dynamic' }
Write-Host "Worktree: $branch  [$mode]  ($worktree)"
foreach ($name in $serviceBases.Keys) {
    Write-Host "  $name=$((Get-Item -Path "Env:$name").Value)"
}
