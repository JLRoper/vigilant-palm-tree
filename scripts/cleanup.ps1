# scripts/cleanup.ps1
# Kill lingering node processes from THIS worktree only.
# Reads .env to know which ports this worktree uses, then checks if those
# processes are actually running from this worktree directory by examining
# the command line (which includes the script path).

$ErrorActionPreference = 'SilentlyContinue'

$worktree = (Get-Location).Path
$envFile = Join-Path $worktree '.env'

# Read ports from .env (this worktree's assigned ports)
$ports = @()
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^(API_PORT|WS_PORT|CLIENT_PORT|DB_PORT|REDIS_PORT)\s*=\s*(\d+)') {
            $ports += [int]$Matches[2]
        }
    }
}

if ($ports.Count -eq 0) {
    Write-Host "No ports found in .env, nothing to clean up."
    exit 0
}

Write-Host "Checking worktree ports: $($ports -join ', ')"

$killed = @()
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            # Check if this process is from THIS worktree by examining command line
            # Node/tsx processes started from this worktree will reference files here
            try {
                $wmi = Get-WmiObject -Class Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
                $cmdline = $wmi.CommandLine
                
                # Check if command line contains this worktree path
                if ($cmdline -and $cmdline -like "*$worktree*") {
                    Write-Host "Killing PID $($proc.Id) ($($proc.ProcessName)) on port $port (worktree match)"
                    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                    $killed += $proc.Id
                } else {
                    Write-Host "Skipping PID $($proc.Id) on port $port (no worktree match in cmdline)"
                }
            } catch {
                Write-Host "Could not examine PID $($proc.Id), skipping."
            }
        }
    }
}

if ($killed.Count -eq 0) {
    Write-Host "No lingering processes from this worktree found."
} else {
    Write-Host "Killed $($killed.Count) process(es) from this worktree."
}
