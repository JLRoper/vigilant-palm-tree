$ErrorActionPreference = "Stop"
$repoRoot = "C:\ProjectDevelopment\heroes-js"
$resourcesDir = "$repoRoot\src\resources"
$script = "$repoRoot\scripts\remove_background.py"

$directories = @(
    "$resourcesDir",
    "$resourcesDir\buildings",
    "$resourcesDir\units",
    "$resourcesDir\units\horse\commander-1",
    "$resourcesDir\units\horse\commander-2",
    "$resourcesDir\units\horse\commander-3",
    "$resourcesDir\units\horse\commander-4",
    "$resourcesDir\units\horse\commander-5",
    "$resourcesDir\units\horse\commander-6",
    "$resourcesDir\units\horse\commander-7",
    "$resourcesDir\units\horse\commander-8"
)

foreach ($dir in $directories) {
    $pngCount = (Get-ChildItem -LiteralPath $dir -Filter "*.png" -File -ErrorAction SilentlyContinue).Count
    if ($pngCount -gt 0) {
        Write-Host "`n=== Processing $dir ($pngCount PNGs) ==="
        python "$script" "$dir"
    } else {
        Write-Host "`n=== Skipping $dir (no PNGs) ==="
    }
}

Write-Host "`n=== Replacing originals with transparent versions ==="

foreach ($dir in $directories) {
    $transparentDir = Join-Path $dir "transparent_output"
    if (-not (Test-Path $transparentDir)) { continue }

    Get-ChildItem -LiteralPath $transparentDir -Filter "*_transparent.png" -File | ForEach-Object {
        $transparentName = $_.Name
        $originalName = $transparentName -replace "_transparent\.png$", ".png"
        $originalPath = Join-Path $dir $originalName

        if (Test-Path $originalPath) {
            Copy-Item -LiteralPath $_.FullName -Destination $originalPath -Force
            Write-Host "  Replaced: $originalName"
        }
    }
}

Write-Host "`nDone. All originals replaced with transparent versions."
