# .kilo/setup-script.ps1 - thin hook for `kilo worktree create`.
#
# The per-worktree preparation itself lives in ONE place now:
# `scripts/worktree-setup.mjs`, run as `npm run worktree:setup`. That path is
# repo-owned, cross-platform, and is the one the Tier-3 recipe and
# docs/operations.md name, so a `git worktree add` checkout and a Kilo-created
# checkout are prepared by the same code -- one rule for the database name, one
# for the launchers, one for the ports.
#
# This file only forwards to it. It is safe to run manually from any checkout at
# any time, it is idempotent, and it never fails the checkout (exit 0 always).
#
# What it used to do on its own -- derive game_poc_<branch-slug>, create that
# database in the shared game_db container, merge PGDATABASE into .env -- is now
# steps 1-2 of the setup path, with the same slug rule (lowercased branch, runs
# of non-alphanumerics to `_`, trimmed, capped at 40). On top of that the setup
# path also seeds .env from .env.example, allocates this worktree's ports through
# scripts/allocate-ports.ts, and makes node_modules/.bin resolve -- a freshly cut
# worktree has neither .env nor node_modules, so `tsx`/`tsc`/`vite` are not
# found until something lays them down.
#
# Schema/migration work is still deliberately NOT done here: server/index.ts runs
# initSchema() on every API boot. Nothing is dropped, truncated or copied.

$ErrorActionPreference = "Continue"
$kiloDir = Split-Path -Parent $PSCommandPath   # <checkout>\.kilo
$root = Split-Path -Parent $kiloDir            # <checkout>
$logPath = Join-Path $kiloDir "setup-script.log"
$script = Join-Path $root "scripts\worktree-setup.mjs"

function Write-SetupLog([string]$message) {
    Write-Host "[setup-script] $message"
    try {
        $stamp = (Get-Date).ToUniversalTime().ToString("o")
        Add-Content -LiteralPath $logPath -Value "[$stamp] $message"
    } catch {}
}

try {
    if (-not (Test-Path -LiteralPath $script)) {
        Write-SetupLog "scripts/worktree-setup.mjs not found in $root; nothing to do"
    }
    else {
        $output = & node $script 2>&1
        $code = $LASTEXITCODE
        $flat = (($output | Out-String).Trim()) -replace "`r?`n", " | "
        Write-SetupLog "worktree-setup.mjs exited $code | $flat"
    }
}
catch {
    Write-SetupLog ("ERROR (non-fatal, checkout continues): " + $_.Exception.Message)
}
exit 0
