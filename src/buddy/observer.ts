import type { Message } from '../types/message.js'
import { getGlobalConfig } from '../utils/config.js'
import { getCompanion, rollWithSeed } from './companion.js'

const TURN_COOLDOWN_MS = 30_000
let lastReactionAt = 0
let lastReactionKey = ''

const SUCCESS_REACTIONS = [
  'That looked cleaner than I expected.',
  'Acceptable progress. Keep the momentum.',
  'Green lights suit this repo.',
  'A small correct step is still a win.',
] as const

const FAILURE_REACTIONS = [
  'There it is. The real problem just introduced itself.',
  'Good. Now we have a concrete failure to work with.',
  'Messy, but informative.',
  'At least the bug stopped hiding.',
] as const

const ADDRESS_REACTIONS = [
  'I am listening.',
  'Proceed. Prefer specifics.',
  'I noticed.',
  'You have my attention.',
] as const

const IDLE_REACTIONS = [
  'I am still watching the edges.',
  'This feels close to the actual fix.',
  'Plan first. Then cut cleanly.',
  'There is usually one smaller move that works.',
] as const

function getMessageText(message: Message): string {
  if (message.type === 'user' || message.type === 'assistant') {
    const content = (message as { message?: { content?: unknown[] } }).message
      ?.content
    if (!Array.isArray(content)) return ''
    return content
      .map(block =>
        typeof block === 'object' &&
        block !== null &&
        'text' in block &&
        typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : '',
      )
      .filter(Boolean)
      .join('\n')
  }

  if (message.type === 'system') {
    return (message as { content?: string }).content ?? ''
  }

  return ''
}

function pickDeterministic<T>(seed: string, values: readonly T[]): T {
  return values[rollWithSeed(seed).inspirationSeed % values.length]!
}

function classifyRecentMessages(
  messages: Message[],
  companionName: string,
): { key: string; reaction?: string; bypassCooldown?: boolean } {
  const recent = messages.slice(-8)
  const transcript = recent.map(getMessageText).join('\n').trim()
  if (!transcript) return { key: '' }

  const lower = transcript.toLowerCase()
  const nameLower = companionName.toLowerCase()
  const seedBase = `${nameLower}:${transcript.slice(-300)}`

  if (
    lower.includes(nameLower) ||
    lower.includes('/buddy pet') ||
    lower.includes('/buddy ')
  ) {
    return {
      key: `address:${seedBase}`,
      reaction: pickDeterministic(`address:${seedBase}`, ADDRESS_REACTIONS),
      bypassCooldown: true,
    }
  }

  if (
    /\b(failed|error|exception|traceback|not defined|access denied|cannot|unable to|exit code [1-9]|test failed)\b/i.test(
      transcript,
    )
  ) {
    return {
      key: `failure:${seedBase}`,
      reaction: pickDeterministic(`failure:${seedBase}`, FAILURE_REACTIONS),
      bypassCooldown: true,
    }
  }

  if (
    /\b(completed|success|fixed|done|built|compiled|created|updated|wrote|passed)\b/i.test(
      transcript,
    )
  ) {
    return {
      key: `success:${seedBase}`,
      reaction: pickDeterministic(`success:${seedBase}`, SUCCESS_REACTIONS),
    }
  }

  const idleRoll = rollWithSeed(`idle:${seedBase}`).inspirationSeed % 5
  if (idleRoll === 0) {
    return {
      key: `idle:${seedBase}`,
      reaction: pickDeterministic(`idle:${seedBase}`, IDLE_REACTIONS),
    }
  }

  return { key: `none:${seedBase}` }
}

export async function fireCompanionObserver(
  messages: Message[],
  onReaction: (reaction: string) => void,
): Promise<void> {
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return

  const result = classifyRecentMessages(messages, companion.name)
  if (!result.reaction || !result.key) return
  if (result.key === lastReactionKey) return

  const now = Date.now()
  if (!result.bypassCooldown && now - lastReactionAt < TURN_COOLDOWN_MS) return

  lastReactionAt = now
  lastReactionKey = result.key
  onReaction(result.reaction)
}

