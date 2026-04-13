import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

import {
  renderSoruxWrapper,
  updateSoruxWrapperContent,
} from '../src/utils/soruxWrapper.js'

function getArgValue(flag: string): string | undefined {
  const index = process.argv.findIndex(arg => arg === flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function runCommand(cmd: string[]): { stdout: string; code: number } {
  const proc = Bun.spawnSync({
    cmd,
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'inherit',
  })
  return {
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    code: proc.exitCode ?? 1,
  }
}

function findWrapperPath(commandName: string): string {
  if (process.platform === 'win32') {
    const found = runCommand(['where.exe', commandName])
    if (found.code === 0) {
      const first = found.stdout.split(/\r?\n/).find(Boolean)
      if (first) return first
    }
    return join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.local', 'bin', `${commandName}.cmd`)
  }

  const found = runCommand(['which', commandName])
  if (found.code === 0 && found.stdout) return found.stdout.split(/\r?\n/)[0]!
  return join(process.env.HOME ?? '.', '.local', 'bin', commandName)
}

async function main(): Promise<void> {
  const build = hasFlag('--build')
  const commandName = getArgValue('--command-name') ?? 'sorux'
  const wrapperPath = getArgValue('--wrapper-path') ?? findWrapperPath(commandName)
  const repoRoot = process.cwd()
  const cliPath = join(repoRoot, 'cli.exe')

  if (build) {
    console.log(`Building latest cli.exe with default features from ${repoRoot} ...`)
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', './scripts/build.ts'],
      cwd: repoRoot,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if ((result.exitCode ?? 1) !== 0) process.exit(result.exitCode ?? 1)
  }

  if (!existsSync(cliPath)) {
    throw new Error(`cli.exe not found at ${cliPath}. Build first.`)
  }

  await mkdir(dirname(wrapperPath), { recursive: true })

  if (existsSync(wrapperPath)) {
    const content = await readFile(wrapperPath, 'utf8')
    const updated = updateSoruxWrapperContent(content, repoRoot)
    if (updated !== content) {
      await writeFile(wrapperPath, updated, 'ascii')
    }
  } else {
    await writeFile(wrapperPath, renderSoruxWrapper(repoRoot), 'ascii')
  }

  console.log(`sorux wrapper: ${wrapperPath}`)
  console.log(`repo root    : ${repoRoot}`)
  console.log(`cli.exe      : ${cliPath}`)
}

await main()
