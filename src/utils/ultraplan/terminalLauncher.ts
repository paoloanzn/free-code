import { spawn } from 'child_process'

export type LocalTerminalLaunchResult = {
  ok: boolean
  launcher: string
  commandPreview: string
  error?: string
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export async function launchUltraplanTerminal(
  scriptPath: string,
): Promise<LocalTerminalLaunchResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      launcher: 'unsupported',
      commandPreview: scriptPath,
      error: 'Local ultraplan terminal launch currently supports Windows first.',
    }
  }

  const commandPreview = `powershell.exe -NoExit -ExecutionPolicy Bypass -File "${scriptPath}"`
  const startCommand = [
    'Start-Process',
    'powershell.exe',
    '-WindowStyle',
    'Normal',
    '-ArgumentList',
    `@('-NoExit','-ExecutionPolicy','Bypass','-File',${psSingleQuote(scriptPath)})`,
  ].join(' ')

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', startCommand],
      {
        detached: true,
        stdio: 'ignore',
      },
    )
    child.unref()
    return {
      ok: true,
      launcher: 'powershell',
      commandPreview,
    }
  } catch (error) {
    return {
      ok: false,
      launcher: 'powershell',
      commandPreview,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
