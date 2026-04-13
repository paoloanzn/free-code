import type { Command } from '../commands.js'
import { DIAMOND_OPEN } from '../constants/figures.js'
import type { AppState } from '../state/AppStateStore.js'
import type { LocalJSXCommandCall } from '../types/command.js'
import {
  startLocalUltraplan,
  stopLocalUltraplan,
} from '../utils/ultraplan/localSession.js'

function buildLaunchMessage(disconnectedBridge?: boolean): string {
  const prefix = disconnectedBridge
    ? 'Remote control was disconnected first. '
    : ''
  return `${DIAMOND_OPEN} ultraplan\n${prefix}Starting a local planner in a new terminal...`
}

function buildAlreadyActiveMessage(localRef: string | undefined): string {
  return localRef
    ? `ultraplan: already running. Current local run: ${localRef}`
    : 'ultraplan: already launching. Please wait for the local planner to start.'
}

export async function launchUltraplan(opts: {
  blurb: string
  seedPlan?: string
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  signal: AbortSignal
  disconnectedBridge?: boolean
  onSessionReady?: (msg: string) => void
}): Promise<string> {
  const {
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    onSessionReady,
    disconnectedBridge,
  } = opts

  const { ultraplanSessionUrl: active, ultraplanLaunching } = getAppState()
  if (active || ultraplanLaunching) {
    return buildAlreadyActiveMessage(active)
  }

  if (!blurb && !seedPlan) {
    return [
      'Usage: /ultraplan <prompt>, or include "ultraplan" in your prompt.',
      '',
      'This launches a new local terminal and runs a planning-only session.',
      'The planner inspects the repo, writes a deep plan locally, and then lets',
      'you insert that plan back into the current conversation.',
    ].join('\n')
  }

  setAppState(prev => ({
    ...prev,
    ultraplanLaunching: true,
  }))

  void startLocalUltraplan({
    topic: blurb || 'Refine the existing plan',
    seedPlan,
    getAppState,
    setAppState,
    onSessionReady,
  }).catch(error => {
    setAppState(prev => ({
      ...prev,
      ultraplanLaunching: undefined,
      ultraplanSessionUrl: undefined,
    }))
    console.error(error)
  })

  return buildLaunchMessage(disconnectedBridge)
}

export async function stopUltraplan(
  taskId: string,
  sessionId: string,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<void> {
  await stopLocalUltraplan(taskId, sessionId, setAppState)
}

const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const blurb = args.trim()

  if (!blurb) {
    const msg = await launchUltraplan({
      blurb,
      getAppState: context.getAppState,
      setAppState: context.setAppState,
      signal: context.abortController.signal,
    })
    onDone(msg, { display: 'system' })
    return null
  }

  const { ultraplanSessionUrl: active, ultraplanLaunching } =
    context.getAppState()
  if (active || ultraplanLaunching) {
    onDone(buildAlreadyActiveMessage(active), { display: 'system' })
    return null
  }

  context.setAppState(prev => ({
    ...prev,
    ultraplanLaunchPending: { blurb },
  }))
  onDone(undefined, { display: 'skip' })
  return null
}

export default {
  type: 'local-jsx',
  name: 'ultraplan',
  description:
    '~5-15 min · Launch a local planning session in a new terminal and bring the resulting plan back here',
  argumentHint: '<prompt>',
  isEnabled: () => true,
  load: () => Promise.resolve({ call }),
} satisfies Command
