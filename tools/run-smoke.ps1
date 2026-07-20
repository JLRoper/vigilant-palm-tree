param(
  [int]$TimeoutSec = 60
)

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "npx"
$psi.ArgumentList.Add("tsx")
$psi.ArgumentList.Add("test/smoke.ts")
$psi.UseShellExecute = $true

$proc = [System.Diagnostics.Process]::Start($psi)
$timeout = (Get-Date).AddSeconds($TimeoutSec)

while (-not $proc.HasExited) {
  Start-Sleep -Milliseconds 200
  if ((Get-Date) -gt $timeout) {
    Write-Host "[launcher] timeout, killing"
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
    break
  }
}

if (-not $proc.HasExited) {
  try { Stop-Process -Id $proc.Id -Force } catch {}
  Start-Sleep -Milliseconds 300
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force } catch {}
  }
}

$exitCode = if ($proc.ExitCode -ne $null) { $proc.ExitCode } else { -1 }
Write-Host "[launcher] done exit=$exitCode"
exit $exitCode
