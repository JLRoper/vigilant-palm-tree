# scripts/dev-status.ps1
#
# Reports whether this worktree's dev services (client, api, db) are up.
# Reads ports from .env in the current worktree. No arguments, no prompts -
# safe to run repeatedly. Intended to be invoked as `npm run dev:status` so
# the command text stays constant regardless of which ports this worktree
# was assigned.

$ErrorActionPreference = 'SilentlyContinue'

$worktree = (Get-Location).Path
$envFile = Join-Path $worktree '.env'

$ports = @{}
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^(API_PORT|WS_PORT|CLIENT_PORT|DB_PORT|REDIS_PORT)\s*=\s*(\d+)') {
            $ports[$Matches[1]] = [int]$Matches[2]
        }
    }
}

if ($ports.Count -eq 0) {
    Write-Host "No .env found in $worktree - ports have not been allocated yet (run npm run dev)."
    exit 1
}

function Test-Listening {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

$allOk = $true

Write-Host "Worktree: $worktree"

if ($ports.ContainsKey('CLIENT_PORT')) {
    $p = $ports['CLIENT_PORT']
    $listening = Test-Listening $p
    $status = if ($listening) { "LISTENING" } else { "DOWN" }
    Write-Host "  web  (vite)  port $p : $status  http://localhost:$p"
    if (-not $listening) { $allOk = $false }
}

$lanHost = $false
if (Test-Path -Path 'Env:LAN_HOST') { $lanHost = ($env:LAN_HOST -eq '1') }
if ($ports.ContainsKey('API_PORT')) {
    $p = $ports['API_PORT']
    $listening = Test-Listening $p
    if ($listening) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/health" -TimeoutSec 3 -UseBasicParsing
            Write-Host "  api  (tsx)   port $p : LISTENING  health=$($resp.StatusCode)  http://localhost:$p/api/health"
            if ($lanHost) {
                $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                    Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254\.' } |
                    Select-Object -ExpandProperty IPAddress
                foreach ($ip in $ips) {
                    Write-Host "             LAN URL: http://${ip}:$p/api"
                }
            }
        } catch {
            Write-Host "  api  (tsx)   port $p : LISTENING  health=UNREACHABLE ($($_.Exception.Message))"
            $allOk = $false
        }
    } else {
        Write-Host "  api  (tsx)   port $p : DOWN"
        $allOk = $false
    }
}

# DB runs in a shared docker-compose container (name/port are fixed in
# docker-compose.yml, not per-worktree), so check it by container name
# rather than by the DB_PORT in .env - that port is allocated per-worktree
# but compose does not actually honor it (hardcoded 5432:5432 mapping).
$dbStatus = docker ps --filter "name=^game_db$" --format "{{.Status}}" 2>$null
if ($dbStatus) {
    Write-Host "  db   (pg)    game_db container : $dbStatus"
    if ($dbStatus -notmatch 'Up') { $allOk = $false }
} else {
    Write-Host "  db   (pg)    game_db container : NOT RUNNING (run npm run db:up)"
    $allOk = $false
}

if ($allOk) {
    Write-Host "All services up."
    exit 0
} else {
    Write-Host "One or more services are not up."
    exit 1
}
