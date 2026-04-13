param(
  [switch]$Build,
  [string]$CommandName = 'sorux',
  [string]$WrapperPath = ''
)

$ErrorActionPreference = 'Stop'

$args = @('run', (Join-Path $PSScriptRoot 'update-sorux.ts'))
if ($Build) {
  $args += '--build'
}
if ($CommandName -and $CommandName -ne 'sorux') {
  $args += @('--command-name', $CommandName)
}
if ($WrapperPath) {
  $args += @('--wrapper-path', $WrapperPath)
}

& bun @args
exit $LASTEXITCODE
