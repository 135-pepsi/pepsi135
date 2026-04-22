param(
  [string]$OutputDir = "dist/synology-static",
  [switch]$ExportSeedFromSupabase
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$targetDir = Join-Path $projectRoot $OutputDir

if ($ExportSeedFromSupabase) {
  $exportScript = Join-Path $projectRoot "scripts/export-static-seed.ps1"
  if (-not (Test-Path $exportScript)) {
    throw "Cannot find export script: scripts/export-static-seed.ps1"
  }
  & powershell -ExecutionPolicy Bypass -File $exportScript
}

if (Test-Path $targetDir) {
  Remove-Item -Path $targetDir -Recurse -Force
}
New-Item -ItemType Directory -Path $targetDir | Out-Null

$requiredFiles = @(
  "index.html",
  "material.html",
  "audit.html",
  "styles.css",
  "app.js",
  "material.js",
  "audit.js",
  "shared.js",
  "seed-data.js",
  "supabase.min.js",
  "xlsx.full.min.js",
  "config.prod.js"
)

foreach ($file in $requiredFiles) {
  $source = Join-Path $projectRoot $file
  if (-not (Test-Path $source)) {
    throw "Missing required file: $file"
  }
  Copy-Item -Path $source -Destination (Join-Path $targetDir $file) -Force
}

$runtimeConfig = Join-Path $projectRoot "config.runtime.js"
$runtimeConfigExample = Join-Path $projectRoot "config.runtime.example.js"
$runtimeTarget = Join-Path $targetDir "config.runtime.js"

if (Test-Path $runtimeConfig) {
  Copy-Item -Path $runtimeConfig -Destination $runtimeTarget -Force
  Write-Host "Copied config.runtime.js with your runtime settings."
} else {
  Copy-Item -Path $runtimeConfigExample -Destination $runtimeTarget -Force
  Write-Warning "config.runtime.js not found. Copied config.runtime.example.js as config.runtime.js, please edit before deployment."
}

Copy-Item -Path (Join-Path $projectRoot "DEPLOY_DS218J.md") -Destination (Join-Path $targetDir "DEPLOY_DS218J.md") -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Build completed."
Write-Host "Static package directory: $targetDir"
