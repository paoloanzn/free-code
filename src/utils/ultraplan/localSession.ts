import { writeFile } from 'fs/promises'
import {
  createTaskStateBase,
  generateTaskId,
  type SetAppState,
} from '../../Task.js'
import { getSessionId } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { enqueuePendingNotification } from '../messageQueueManager.js'
import { registerTask, updateTaskState } from '../task/framework.js'
import {
  createUltraplanRunPaths,
  readUltraplanPlan,
  readUltraplanStatus,
  readUltraplanSummary,
  writeUltraplanRequest,
  writeUltraplanStatus,
  writeUltraplanSummary,
  type UltraplanRunPaths,
} from './artifacts.js'
import {
  buildUltraplanSystemPrompt,
  buildUltraplanUserPrompt,
} from './plannerPrompt.js'
import {
  getUltraplanProfileConfig,
  type UltraplanProfile,
} from './profile.js'
import { launchUltraplanTerminal } from './terminalLauncher.js'
import {
  buildWorkspaceSnapshotMarkdown,
  collectWorkspaceSnapshot,
} from './workspaceSnapshot.js'

const POLL_MS = 1200

export async function startLocalUltraplan(opts: {
  topic: string
  profile?: UltraplanProfile
  seedPlan?: string
  getAppState: () => AppState
  setAppState: SetAppState
  onSessionReady?: (message: string) => void
}): Promise<string> {
  const {
    topic,
    profile = 'deep',
    seedPlan,
    getAppState,
    setAppState,
    onSessionReady,
  } = opts
  const paths = await createUltraplanRunPaths()
  const taskId = createUltraplanTask(setAppState, topic, paths.dir)
  const profileConfig = getUltraplanProfileConfig(profile)

  await writeUltraplanRequest(paths, {
    id: paths.id,
    topic,
    cwd: process.cwd(),
    createdAt: Date.now(),
    profile,
    sourceSessionId: getSessionId(),
    ...(seedPlan ? { seedPlan } : {}),
  })
  await writeUltraplanStatus(paths, 'launching', 'Preparing local planner')
  const workspaceSnapshot = await collectWorkspaceSnapshot(process.cwd())
  const workspaceSnapshotMarkdown =
    buildWorkspaceSnapshotMarkdown(workspaceSnapshot)
  await writeFile(
    paths.workspaceSnapshotJsonPath,
    JSON.stringify(workspaceSnapshot, null, 2),
    'utf8',
  )
  await writeFile(
    paths.workspaceSnapshotPath,
    workspaceSnapshotMarkdown,
    'utf8',
  )
  await writeFile(
    paths.systemPromptPath,
    buildUltraplanSystemPrompt(profile),
    'utf8',
  )
  await writeFile(
    paths.promptPath,
    buildUltraplanUserPrompt(topic, workspaceSnapshotMarkdown, profile, seedPlan),
    'utf8',
  )
  await writePlannerScript(paths, profile)

  const launched = await launchUltraplanTerminal(paths.scriptPath)
  await writeUltraplanSummary(paths, {
    startedAt: Date.now(),
    launcher: launched.launcher,
    commandPreview: launched.commandPreview,
    ...(launched.error ? { error: launched.error } : {}),
  })

  if (!launched.ok) {
    await writeUltraplanStatus(paths, 'failed', launched.error)
    markUltraplanTask(taskId, setAppState, 'failed', launched.error)
    return `ultraplan: failed to open a local terminal.\nRun dir: ${paths.dir}\nReason: ${launched.error}`
  }

  setAppState(prev => ({
    ...prev,
    ultraplanSessionUrl: `local:${paths.dir}`,
    ultraplanLaunching: undefined,
  }))
  markUltraplanTask(taskId, setAppState, 'running', 'Planner terminal launched')
  onSessionReady?.(
    `Ultraplan (${profileConfig.name}) started in a new local terminal.\nRun dir: ${paths.dir}`,
  )
  void pollLocalUltraplan(paths, taskId, getAppState, setAppState)
  return `ultraplan\nLaunching ${profileConfig.name} local planner in a new terminal...`
}

export async function stopLocalUltraplan(
  taskId: string,
  runDirOrLocalRef: string,
  setAppState: SetAppState,
): Promise<void> {
  const runDir = runDirOrLocalRef.startsWith('local:')
    ? runDirOrLocalRef.slice('local:'.length)
    : runDirOrLocalRef
  const paths = materializeRunPaths(runDir)
  await writeUltraplanStatus(paths, 'stopped', 'Stopped from the main session')
  markUltraplanTask(taskId, setAppState, 'killed', 'Stopped')
  setAppState(prev => ({
    ...prev,
    ultraplanSessionUrl: undefined,
    ultraplanPendingChoice: undefined,
    ultraplanLaunching: undefined,
  }))
  enqueuePendingNotification({
    value: `Ultraplan stopped.\nRun dir: ${runDir}`,
    mode: 'task-notification',
  })
}

function createUltraplanTask(
  setAppState: SetAppState,
  topic: string,
  runDir: string,
): string {
  const taskId = generateTaskId('local_workflow')
  const task: LocalWorkflowTaskState = {
    ...createTaskStateBase(taskId, 'local_workflow', `Ultraplan: ${topic}`),
    type: 'local_workflow',
    status: 'running',
    workflowName: 'ultraplan',
    summary: `Planning in ${runDir}`,
    agentCount: 1,
    agents: [{ id: 'planner', name: 'planner', status: 'running' }],
    isBackgrounded: true,
  }
  registerTask(task, setAppState)
  return taskId
}

function markUltraplanTask(
  taskId: string,
  setAppState: SetAppState,
  status: LocalWorkflowTaskState['status'],
  summary?: string,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => ({
    ...task,
    status,
    summary: summary ?? task.summary,
    endTime:
      status === 'running' || status === 'pending' ? task.endTime : Date.now(),
    agents: (task.agents ?? []).map(agent => ({
      ...agent,
      status:
        status === 'completed'
          ? 'completed'
          : status === 'failed'
            ? 'failed'
            : status === 'killed'
              ? 'skipped'
              : 'running',
    })),
  }))
}

async function pollLocalUltraplan(
  paths: UltraplanRunPaths,
  taskId: string,
  getAppState: () => AppState,
  setAppState: SetAppState,
): Promise<void> {
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
    if (getAppState().ultraplanSessionUrl !== `local:${paths.dir}`) return

    const status = await readUltraplanStatus(paths)
    if (status.status === 'launching' || status.status === 'pending') {
      continue
    }
    if (status.status === 'running') {
      markUltraplanTask(taskId, setAppState, 'running', status.message)
      continue
    }

    if (status.status === 'completed') {
      const plan = (await readUltraplanPlan(paths))?.trim()
      if (!plan) {
        const summary = await readUltraplanSummary(paths)
        await writeUltraplanStatus(
          paths,
          'failed',
          summary.error ?? 'Planner exited without producing a plan',
        )
        markUltraplanTask(taskId, setAppState, 'failed', summary.error)
        enqueuePendingNotification({
          value: `Ultraplan failed: no plan.md was produced.\nRun dir: ${paths.dir}`,
          mode: 'task-notification',
        })
        setAppState(prev => ({
          ...prev,
          ultraplanSessionUrl: undefined,
        }))
        return
      }

      markUltraplanTask(taskId, setAppState, 'running', 'Plan ready for review')
      setAppState(prev => ({
        ...prev,
        ultraplanPendingChoice: {
          plan,
          sessionId: paths.dir,
          taskId,
        },
      }))
      enqueuePendingNotification({
        value: `Ultraplan plan is ready.\nRun dir: ${paths.dir}`,
        mode: 'task-notification',
      })
      return
    }

    const summary = await readUltraplanSummary(paths)
    markUltraplanTask(
      taskId,
      setAppState,
      status.status === 'stopped' ? 'killed' : 'failed',
      summary.error ?? status.message,
    )
    setAppState(prev => ({
      ...prev,
      ultraplanSessionUrl: undefined,
    }))
    enqueuePendingNotification({
      value: `Ultraplan ${status.status}: ${summary.error ?? status.message ?? 'unknown error'}\nRun dir: ${paths.dir}`,
      mode: 'task-notification',
    })
    return
  }
}

async function writePlannerScript(
  paths: UltraplanRunPaths,
  profile: UltraplanProfile,
): Promise<void> {
  if (process.platform !== 'win32') {
    await writeFile(
      paths.scriptPath,
      '#!/usr/bin/env bash\necho "Local ultraplan terminal launch currently supports Windows first."\n',
      'utf8',
    )
    return
  }

  const q = (value: string) => `'${value.replace(/'/g, "''")}'`
  const cliPath = process.execPath
  const model = process.env.ANTHROPIC_MODEL || ''
  const profileConfig = getUltraplanProfileConfig(profile)
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$runDir = ${q(paths.dir)}`,
    `$statusPath = ${q(paths.statusPath)}`,
    `$summaryPath = ${q(paths.summaryPath)}`,
    `$promptPath = ${q(paths.promptPath)}`,
    `$systemPromptPath = ${q(paths.systemPromptPath)}`,
    `$planPath = ${q(paths.planPath)}`,
    `$stdoutPath = ${q(paths.stdoutPath)}`,
    `$stderrPath = ${q(paths.stderrPath)}`,
    `$cliPath = ${q(cliPath)}`,
    `$cwd = ${q(process.cwd())}`,
    '$prompt = Get-Content -LiteralPath $promptPath -Raw',
    'Set-Location -LiteralPath $cwd',
    `@{ status = 'running'; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); message = 'Planner is reading the repo (${profileConfig.name})' } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding utf8`,
    'try {',
    '  $arguments = @(',
    "    '-p',",
    "    '--bare',",
    "    '--output-format','text',",
    "    '--allowedTools','Read,Glob,Grep',",
    "    '--append-system-prompt-file',$systemPromptPath,",
    `    '--max-turns','${profileConfig.maxTurns}'`,
    '  )',
    ...(model ? [`  $arguments += @('--model', ${q(model)})`] : []),
    '  $arguments += $prompt',
    '  & $cliPath @arguments 2> $stderrPath | Tee-Object -FilePath $planPath | Tee-Object -FilePath $stdoutPath',
    '  $exitCode = $LASTEXITCODE',
    '  if ($exitCode -ne 0) { throw "planner exited with code $exitCode" }',
    '  if (-not (Test-Path -LiteralPath $planPath)) { throw "planner did not create plan.md" }',
    '  $plan = (Get-Content -LiteralPath $planPath -Raw).Trim()',
    '  if ([string]::IsNullOrWhiteSpace($plan)) { throw "planner returned empty output" }',
    `  @{ status = 'completed'; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); message = 'Plan completed (${profileConfig.name})' } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding utf8`,
    `  @{ completedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); launcher = 'powershell'; commandPreview = 'cli --print ultraplan --${profileConfig.name}' } | ConvertTo-Json | Set-Content -LiteralPath $summaryPath -Encoding utf8`,
    '} catch {',
    '  $message = $_.Exception.Message',
    `  @{ status = 'failed'; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); message = $message } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding utf8`,
    `  @{ completedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); launcher = 'powershell'; error = $message } | ConvertTo-Json | Set-Content -LiteralPath $summaryPath -Encoding utf8`,
    '  Write-Host ""',
    '  Write-Host "Ultraplan failed: $message" -ForegroundColor Red',
    '}',
    'Write-Host ""',
    'Write-Host "Ultraplan artifacts: $runDir" -ForegroundColor Cyan',
  ].join('\n')

  await writeFile(paths.scriptPath, script, 'utf8')
}

function materializeRunPaths(dir: string): UltraplanRunPaths {
  return {
    id: dir.split(/[\\/]/).at(-1) ?? 'unknown',
    dir,
    requestPath: `${dir}/request.json`,
    statusPath: `${dir}/status.json`,
    summaryPath: `${dir}/summary.json`,
    workspaceSnapshotPath: `${dir}/workspace-snapshot.md`,
    workspaceSnapshotJsonPath: `${dir}/workspace-snapshot.json`,
    planPath: `${dir}/plan.md`,
    promptPath: `${dir}/prompt.txt`,
    systemPromptPath: `${dir}/system-prompt.txt`,
    scriptPath: `${dir}/${process.platform === 'win32' ? 'run.ps1' : 'run.sh'}`,
    stdoutPath: `${dir}/stdout.log`,
    stderrPath: `${dir}/stderr.log`,
  }
}
