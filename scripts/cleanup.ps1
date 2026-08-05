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

function Test-TcpListening {
    param([int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect([System.Net.IPAddress]::Loopback, $Port)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Get-ProcessOnPort {
    param([int]$Port)
    if ($IsWindows) {
        $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if ($conn) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) { return @{ Id = $proc.Id; Name = $proc.ProcessName } }
        }
        return $null
    }
    $line = (& ss -tlnp 2>$null) -split "`n" | Where-Object { $_ -match ":$Port\s" } | Select-Object -First 1
    if ($line -and $line -match 'pid=(\d+)') {
        $pid = [int]$Matches[1]
        $name = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName
        return @{ Id = $pid; Name = $name }
    }
    return $null
}

function Get-ProcessCommandLine {
    param([int]$Pid)
    if ($IsWindows) {
        try {
            $wmi = Get-WmiObject -Class Win32_Process -Filter "ProcessId = $Pid" -ErrorAction SilentlyContinue
            return $wmi.CommandLine
        } catch { return $null }
    }
    try {
        return Get-Content -LiteralPath "/proc/$Pid/cmdline" -Raw -ErrorAction SilentlyContinue | ForEach-Object { $_ -replace "\0", ' ' }
    } catch { return $null }
}

$killed = @()
foreach ($port in $ports) {
    if (-not (Test-TcpListening $port)) { continue }
    $info = Get-ProcessOnPort $port
    if (-not $info) { continue }
    try {
        $cmdline = Get-ProcessCommandLine $info.Id
        if ($cmdline -and $cmdline -like "*$worktree*") {
            Write-Host "Killing PID $($info.Id) ($($info.Name)) on port $port (worktree match)"
            Stop-Process -Id $info.Id -Force -ErrorAction SilentlyContinue
            $killed += $info.Id
        } else {
            Write-Host "Skipping PID $($info.Id) on port $port (no worktree match in cmdline)"
        }
    } catch {
        Write-Host "Could not examine PID $($info.Id), skipping."
    }
}

if ($killed.Count -eq 0) {
    Write-Host "No lingering processes from this worktree found."
} else {
    Write-Host "Killed $($killed.Count) process(es) from this worktree."
}
