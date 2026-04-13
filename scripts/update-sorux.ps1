param(
  [switch]$Build,
  [string]$CommandName = 'sorux',
  [string]$WrapperPath = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cliPath = Join-Path $repoRoot 'cli.exe'

if ($Build) {
  Write-Host "Building latest cli.exe with default features from $repoRoot ..." -ForegroundColor Cyan
  Push-Location $repoRoot
  try {
    bun run .\scripts\build.ts
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $cliPath)) {
  throw "cli.exe not found at $cliPath. Build first."
}

if ([string]::IsNullOrWhiteSpace($WrapperPath)) {
  $command = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    $WrapperPath = $command.Path
  } else {
    $WrapperPath = Join-Path $HOME ".local\bin\$CommandName.cmd"
  }
}

$wrapperDir = Split-Path -Parent $WrapperPath
if (-not (Test-Path -LiteralPath $wrapperDir)) {
  New-Item -ItemType Directory -Path $wrapperDir -Force | Out-Null
}

if (Test-Path -LiteralPath $WrapperPath) {
  $content = Get-Content -LiteralPath $WrapperPath -Raw
  if ($content -match 'set "FREECODE_ROOT=') {
    $updated = [regex]::Replace(
      $content,
      'set "FREECODE_ROOT=.*?"',
      { param($match) "set `"FREECODE_ROOT=$repoRoot`"" }
    )
    if ($updated -ne $content) {
      Set-Content -LiteralPath $WrapperPath -Value $updated -Encoding ascii
    }
  }
} else {
  $wrapper = @"
@echo off
setlocal
set "FREECODE_ROOT=$repoRoot"
cd /d "%FREECODE_ROOT%"
if exist ".\cli.exe" (
  ".\cli.exe" %*
  exit /b %errorlevel%
) else (
  echo cli.exe not found under %FREECODE_ROOT%
  exit /b 1
)
"@
  Set-Content -LiteralPath $WrapperPath -Value $wrapper -Encoding ascii
}

Write-Host "sorux wrapper: $WrapperPath" -ForegroundColor Green
Write-Host "repo root    : $repoRoot" -ForegroundColor Green
Write-Host "cli.exe      : $cliPath" -ForegroundColor Green
