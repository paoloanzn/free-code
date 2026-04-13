import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getClaudeConfigHomeDir } from '../envUtils.js'

export type UltraplanRunStatus =
  | 'pending'
  | 'launching'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'

export type UltraplanStatusFile = {
  status: UltraplanRunStatus
  updatedAt: number
  message?: string
}

export type UltraplanSummaryFile = {
  startedAt?: number
  completedAt?: number
  launcher?: string
  commandPreview?: string
  error?: string
}

export type UltraplanRequestFile = {
  id: string
  topic: string
  cwd: string
  createdAt: number
  profile?: 'fast' | 'deep' | 'max'
  sourceSessionId?: string
  seedPlan?: string
}

export type UltraplanRunPaths = {
  id: string
  dir: string
  requestPath: string
  statusPath: string
  summaryPath: string
  workspaceSnapshotPath: string
  workspaceSnapshotJsonPath: string
  planPath: string
  promptPath: string
  systemPromptPath: string
  scriptPath: string
  stdoutPath: string
  stderrPath: string
}

const STATUS_FALLBACK: UltraplanStatusFile = {
  status: 'pending',
  updatedAt: 0,
}

function getRunDir(id: string): string {
  return join(getClaudeConfigHomeDir(), 'ultraplan', 'runs', id)
}

export async function createUltraplanRunPaths(): Promise<UltraplanRunPaths> {
  const id = randomUUID()
  const dir = getRunDir(id)
  await mkdir(dir, { recursive: true })
  return {
    id,
    dir,
    requestPath: join(dir, 'request.json'),
    statusPath: join(dir, 'status.json'),
    summaryPath: join(dir, 'summary.json'),
    workspaceSnapshotPath: join(dir, 'workspace-snapshot.md'),
    workspaceSnapshotJsonPath: join(dir, 'workspace-snapshot.json'),
    planPath: join(dir, 'plan.md'),
    promptPath: join(dir, 'prompt.txt'),
    systemPromptPath: join(dir, 'system-prompt.txt'),
    scriptPath: join(dir, process.platform === 'win32' ? 'run.ps1' : 'run.sh'),
    stdoutPath: join(dir, 'stdout.log'),
    stderrPath: join(dir, 'stderr.log'),
  }
}

export async function writeUltraplanRequest(
  paths: UltraplanRunPaths,
  request: UltraplanRequestFile,
): Promise<void> {
  await writeJson(paths.requestPath, request)
}

export async function writeUltraplanStatus(
  paths: UltraplanRunPaths,
  status: UltraplanRunStatus,
  message?: string,
): Promise<void> {
  await writeJson(paths.statusPath, {
    status,
    updatedAt: Date.now(),
    ...(message ? { message } : {}),
  } satisfies UltraplanStatusFile)
}

export async function writeUltraplanSummary(
  paths: UltraplanRunPaths,
  summary: UltraplanSummaryFile,
): Promise<void> {
  await writeJson(paths.summaryPath, summary)
}

export async function readUltraplanStatus(
  paths: Pick<UltraplanRunPaths, 'statusPath'>,
): Promise<UltraplanStatusFile> {
  return (await readJson(paths.statusPath)) ?? STATUS_FALLBACK
}

export async function readUltraplanSummary(
  paths: Pick<UltraplanRunPaths, 'summaryPath'>,
): Promise<UltraplanSummaryFile> {
  return (await readJson(paths.summaryPath)) ?? {}
}

export async function readUltraplanPlan(
  paths: Pick<UltraplanRunPaths, 'planPath'>,
): Promise<string | null> {
  try {
    return await readFile(paths.planPath, 'utf8')
  } catch {
    return null
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
