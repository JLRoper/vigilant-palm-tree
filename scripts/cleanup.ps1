# scripts/cleanup.ps1
# Kill lingering dev processes from THIS worktree only.
#
# Previously this only checked processes bound to the ports currently listed
# in .env. That misses orphans: `predev` (scripts/allocate-ports.ts)
# preserves existing .env port values and only allocates fresh ones for keys
# that are missing, so if .env ever gets reset/rewritten between runs, the
# previous generation's processes keep running on ports no longer recorded
# anywhere - invisible to a port-based cleanup.
#
# So this scans the system process list directly for anything (node.exe /
# esbuild.exe) whose command line is rooted in this worktree path and looks
# like part of our dev stack (vite / tsx watch / server/index.ts /
# concurrently / esbuild service), regardless of what port it's bound to.

$ErrorActionPreference = 'SilentlyContinue'

$worktree = (Get-Location).Path
$pidRegistry = Join-Path $worktree 'test/.last-test-pids.json'

# Reap any PIDs the previous smoke test recorded but failed to clean up.
if (Test-Path -LiteralPath $pidRegistry) {
    $raw = Get-Content -LiteralPath $pidRegistry -Raw -ErrorAction SilentlyContinue
    if ($raw -and $raw.Trim()) {
        try {
            $registry = $raw | ConvertFrom-Json -ErrorAction Stop
            if ($registry.pids) {
                foreach ($entry in $registry.pids) {
                    $pid = [int]$entry.pid
                    if ($pid -le 0) { continue }
                    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                    if (-not $proc) { continue }
                    Write-Host "Killing leftover $($entry.role) pid=$pid (from .last-test-pids.json)"
                    if ($IsWindows) {
                        & taskkill.exe /F /T /PID $pid 2>$null | Out-Null
                    } else {
                        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                    }
                }
            }
        } catch {
            Write-Host "Could not parse $pidRegistry, skipping registry sweep."
        }
    }
}

# Markers that identify a process as part of this project's dev stack, so a
# worktree-path match alone (which any node process launched from this
# directory would satisfy, including an editor's language server) isn't
# enough on its own to justify killing it.
$devMarkers = @('vite', 'tsx watch', 'server[\\/]index\.ts', 'concurrently', 'esbuild')

function Test-DevProcessCommandLine {
    param([string]$CommandLine)
    if (-not $CommandLine) { return $false }
    if ($CommandLine -notlike "*$worktree*") { return $false }
    foreach ($marker in $devMarkers) {
        if ($CommandLine -match $marker) { return $true }
    }
    return $false
}

function Get-WorktreeDevProcesses {
    if ($IsWindows) {
        $procs = @()
        foreach ($name in @('node.exe', 'esbuild.exe')) {
            $procs += Get-WmiObject -Class Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue
        }
        return $procs | Where-Object { Test-DevProcessCommandLine $_.CommandLine } | ForEach-Object {
            @{ Id = [int]$_.ProcessId; Name = $_.Name }
        }
    }
    $matches = @()
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('node', 'esbuild') } | ForEach-Object {
        $cmdline = (Get-Content -LiteralPath "/proc/$($_.Id)/cmdline" -Raw -ErrorAction SilentlyContinue) -replace "\0", ' '
        if (Test-DevProcessCommandLine $cmdline) {
            $matches += @{ Id = $_.Id; Name = $_.ProcessName }
        }
    }
    return $matches
}

$killed = @()
foreach ($proc in (Get-WorktreeDevProcesses)) {
    Write-Host "Killing PID $($proc.Id) ($($proc.Name)) - worktree dev process match"
    if ($IsWindows) {
        & taskkill.exe /F /T /PID $proc.Id 2>$null | Out-Null
    } else {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    $killed += $proc.Id
}

if ($killed.Count -eq 0) {
    Write-Host "No lingering dev processes from this worktree found."
} else {
    Write-Host "Killed $($killed.Count) process(es) from this worktree."
}
