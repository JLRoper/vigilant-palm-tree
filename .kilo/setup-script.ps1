# .kilo/setup-script.ps1 - per-worktree setup for heroes-js.
#
# Intended to be run automatically by the Kilo CLI after `kilo worktree create`
# makes this checkout (worktree-workflow Phase 04; verified empirically in this
# phase). Safe to run manually from any checkout of this repo at any time.
#
# What it does (and nothing else):
#   1. Derives the current branch from this script's own location (no CLI-arg
#      or environment assumptions).
#   2. Ensures a dedicated Postgres database for this worktree exists inside
#      the SHARED game_db container: game_poc_<branch-slug>. Idempotent.
#   3. Merges PGDATABASE=<that db> into this worktree's .env (only if the key
#      is not already defined there) so `npm run dev` in this worktree is
#      isolated by default.
#
# What it deliberately does NOT do:
#   - No schema/migration work here: server/index.ts runs initSchema() on every
#     API boot (including the test harness's own API), which applies the schema
#     idempotently to whatever PGDATABASE points at.
#   - No DROP, no TRUNCATE, no data copies, nothing destructive. Failures are
#     logged and never fail the checkout (exit 0 always).
#
# Test runs must pass the database as a REAL process-env variable
# (PGDATABASE=... npm test): .env.test pins PGDATABASE=game_poc and is loaded
# after .env, so only the process environment wins over it.

$ErrorActionPreference = "Stop"
$script:logLines = @()
function Write-SetupLog([string]$message) {
    $script:logLines += $message
    Write-Host "[setup-script] $message"
}

$logPath = Join-Path (Split-Path -Parent $PSCommandPath) "setup-script.log"

try {
    $kiloDir = Split-Path -Parent $PSCommandPath   # <checkout>\.kilo
    $root = Split-Path -Parent $kiloDir            # <checkout>

    $branch = $null
    try { $branch = (& git -C $root rev-parse --abbrev-ref HEAD 2>$null) } catch {}
    if (-not $branch) { $branch = "unknown" }

    $slug = ($branch.ToLower() -replace '[^a-z0-9]+', '_').Trim('_')
    if (-not $slug) { $slug = "wt" }
    if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40) }
    $dbName = "game_poc_$slug"

    if ($branch -eq "main" -or $branch -eq "master") {
        Write-SetupLog "branch '$branch' is the primary branch; no per-worktree database created"
    }
    else {
        $exists = docker exec game_db psql -U gameuser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName';" 2>$null
        if ("$exists".Trim() -eq "1") {
            Write-SetupLog "database $dbName already exists in shared container game_db (idempotent no-op)"
        }
        else {
            docker exec game_db psql -U gameuser -d postgres -c "CREATE DATABASE $dbName OWNER gameuser;" | Out-Null
            Write-SetupLog "created database $dbName (owner gameuser) in shared container game_db"
        }

        $envPath = Join-Path $root ".env"
        $hasKey = $false
        if (Test-Path -LiteralPath $envPath) {
            $hasKey = (Select-String -LiteralPath $envPath -Pattern '^\s*PGDATABASE\s*=' -Quiet)
        }
        if ($hasKey) {
            Write-SetupLog ".env already defines PGDATABASE; left unchanged"
        }
        else {
            Add-Content -LiteralPath $envPath -Value "PGDATABASE=$dbName"
            Write-SetupLog "wrote PGDATABASE=$dbName to $envPath (dev isolation; tests pass it as process env)"
        }

        Write-SetupLog "usage in this worktree: dev reads .env automatically; test runs: set PGDATABASE=$dbName in the invoking shell"
    }
}
catch {
    Write-SetupLog ("ERROR (non-fatal, checkout continues): " + $_.Exception.Message)
    try { Write-SetupLog ("detail: " + $_.ErrorDetails.Message) } catch {}
}
finally {
    try {
        $stamp = (Get-Date).ToUniversalTime().ToString("o")
        Add-Content -LiteralPath $logPath -Value "[$stamp] $($script:logLines -join ' | ')"
    } catch {}
}
exit 0
