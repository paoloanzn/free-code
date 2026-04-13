export function renderSoruxWrapper(repoRoot: string): string {
  return [
    '@echo off',
    'setlocal',
    '',
    `set "FREECODE_ROOT=${repoRoot}"`,
    'if exist "%FREECODE_ROOT%\\cli.exe" (',
    '  "%FREECODE_ROOT%\\cli.exe" %*',
    '  exit /b %errorlevel%',
    ') else if exist "%FREECODE_ROOT%\\cli-dev.exe" (',
    '  "%FREECODE_ROOT%\\cli-dev.exe" %*',
    '  exit /b %errorlevel%',
    ') else (',
    '  echo cli-dev.exe / cli.exe not found under %FREECODE_ROOT%',
    '  exit /b 1',
    ')',
    '',
  ].join('\r\n')
}

export function updateSoruxWrapperContent(
  existing: string,
  repoRoot: string,
): string {
  let updated = existing.replace(
    /set "FREECODE_ROOT=.*?"/,
    `set "FREECODE_ROOT=${repoRoot}"`,
  )

  updated = updated.replace(/\r?\ncd \/d "%FREECODE_ROOT%"\r?\n/i, '\r\n')
  updated = updated.replace(
    /if exist "\.\\cli\.exe" \(/i,
    'if exist "%FREECODE_ROOT%\\cli.exe" (',
  )
  updated = updated.replace(
    /"\.\\cli\.exe"/gi,
    '"%FREECODE_ROOT%\\cli.exe"',
  )
  updated = updated.replace(
    /else if exist "\.\\cli-dev\.exe" \(/i,
    'else if exist "%FREECODE_ROOT%\\cli-dev.exe" (',
  )
  updated = updated.replace(
    /"\.\\cli-dev\.exe"/gi,
    '"%FREECODE_ROOT%\\cli-dev.exe"',
  )

  return updated
}
