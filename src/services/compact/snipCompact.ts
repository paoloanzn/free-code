// snipCompact - Context compression by snipping old messages
// LLM-powered implementation for public builds

import type { Message } from '../../types/message.js'
import { createCompactBoundaryMessage } from '../../utils/messages.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { estimateMessageTokens } from './microCompact.js'

// ============================================================================
// Types & Configuration
// ============================================================================

export interface SnipResult {
  messages: Message[]
  tokensFreed: number
  boundaryMessage?: Message
  /** Whether snip was actually executed (for QueryEngine compatibility) */
  executed: boolean
}

export interface SnipOptions {
  force?: boolean
  signal?: AbortSignal
}

/**
 * Configuration for snip behavior
 * Exported for customization and testing
 */
export interface SnipConfig {
  /** Token threshold to trigger snipping (default: 100000) */
  thresholdTokens: number
  /** Target tokens after snipping (default: 80000) */
  targetTokens: number
  /** Minimum messages to always keep (default: 10) */
  minMessagesToKeep: number
  /** Minimum messages to remove for snip to trigger (default: 5) */
  minMessagesToSnip: number
}

/** Default configuration values */
export const DEFAULT_SNIP_CONFIG: SnipConfig = {
  thresholdTokens: 100000,
  targetTokens: 80000,
  minMessagesToKeep: 10,
  minMessagesToSnip: 5,
}

// Module-level config (can be overridden for testing)
let globalConfig: SnipConfig = { ...DEFAULT_SNIP_CONFIG }

/** Nudge text for context efficiency reminders (exported for messages.ts) */
export const SNIP_NUDGE_TEXT =
  'Your context is getting long. Use the /snip command to reduce context length and improve performance.'

/**
 * Check if snip runtime is enabled (for messages.ts compatibility)
 * Always returns true in public builds
 */
export function isSnipRuntimeEnabled(): boolean {
  return true
}

/**
 * Update global snip configuration
 */
export function setSnipConfig(config: Partial<SnipConfig>): void {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Reset configuration to defaults
 */
export function resetSnipConfig(): void {
  globalConfig = { ...DEFAULT_SNIP_CONFIG }
}

/**
 * Get current configuration (for testing/inspection)
 */
export function getSnipConfig(): Readonly<SnipConfig> {
  return { ...globalConfig }
}

// ============================================================================
// Token Calculation (Performance Optimized)
// ============================================================================

/**
 * Cached token count for a single message
 * WeakMap allows garbage collection when Message is no longer referenced
 */
const tokenCache = new WeakMap<Message, number>()

/**
 * Calculate tokens for a single message with caching
 */
function calculateSingleMessageTokens(msg: Message): number {
  // Check cache first
  const cached = tokenCache.get(msg)
  if (cached !== undefined) {
    return cached
  }

  // Calculate and cache
  const tokens = estimateMessageTokens([msg])
  tokenCache.set(msg, tokens)
  return tokens
}

/**
 * Calculate total tokens for a list of messages
 * Uses caching for performance
 */
function calculateTotalTokens(messages: readonly Message[]): number {
  let total = 0
  for (const msg of messages) {
    total += calculateSingleMessageTokens(msg)
  }
  return total
}

// ============================================================================
// LLM Summary Generation
// ============================================================================

/**
 * Extract text content from a message
 */
function extractTextContent(msg: Message): string {
  if (!('message' in msg) || !msg.message) return ''

  const content = msg.message.content
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        return block.text
      }
    }
  }

  return ''
}

/**
 * Generate LLM summary for snipped messages
 *
 * DESIGN PRINCIPLE: All summaries MUST use LLM
 */
export async function generateSnipSummaryWithLLM(
  snippedMessages: Message[],
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  try {
    // P0 FIX: Limit total prompt length to avoid API errors
    const MAX_PROMPT_LENGTH = 6000
    const MAX_MESSAGES = 40
    const MAX_CONTENT_PER_MESSAGE = 200

    // Format messages for the prompt (with length limits)
    const conversationText = snippedMessages
      .slice(-MAX_MESSAGES) // Only use last N messages
      .map((m) => {
        const role = m.type === 'user' ? 'User' : 'Assistant'
        const content = extractTextContent(m).slice(0, MAX_CONTENT_PER_MESSAGE)
        return `${role}: ${content}${content.length >= MAX_CONTENT_PER_MESSAGE ? '...' : ''}`
      })
      .join('\n\n')
      .slice(0, MAX_PROMPT_LENGTH) // Hard limit on total length

    // Prompt inspired by src/services/compact/prompt.ts patterns
    // Optimized for archival snip summaries (shorter than contextCollapse)
    const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- Your entire response must be plain text: a single summary line.

`

    const prompt = NO_TOOLS_PREAMBLE +
`The following conversation history is being ARCHIVED (removed from active context to save space).
Provide a concise archival summary (max 150 characters) that captures:

1. **Topic**: Main subject or task discussed
2. **Key Files**: Important code files mentioned (if any)
3. **Status**: Completed, in-progress, or blocked

**Requirements**:
- One sentence, plain text only
- Prioritize file names and technical decisions
- Shorter is better (aim for 100 characters)
- Do NOT use markdown

**Example Outputs**:
- Refactored auth system: moved login logic to auth.ts, fixed token refresh bug.
- Debugged React rendering issue in Dashboard.tsx: root cause was missing key prop.
- Discussed API design for user endpoints, decided on REST over GraphQL.

**Conversation Being Archived**:
${conversationText}

**Archival Summary**:`

    // Dynamically import to avoid circular dependencies
    const { queryHaiku } = await import('../api/claude.js')
    const { asSystemPrompt } = await import('../../utils/systemPrompt.js')

    const response = await queryHaiku({
      systemPrompt: asSystemPrompt([
        'You are an archival conversation summarizer. Your task is to create concise, informative summaries of archived conversation segments. Focus on technical details, file names, and outcomes. Never call tools.',
      ]),
      userPrompt: prompt,
      signal: options.signal || new AbortController().signal,
      options: {
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        querySource: 'snip_compact',
        agents: [],
        mcpTools: [],
        enablePromptCaching: false,
      },
    })

    // Extract text from response
    const content = response.message.content
    let summary: string

    if (typeof content === 'string') {
      summary = content.trim()
    } else if (Array.isArray(content)) {
      summary = content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim()
    } else {
      summary = ''
    }

    return summary.slice(0, 200) || `[${snippedMessages.length} messages archived]`
  } catch (error) {
    // DESIGN PRINCIPLE: Fallback only on error
    console.warn('[snipCompact] LLM summary failed, using fallback:', error)
    return generateFallbackSnipSummary(snippedMessages)
  }
}

/**
 * Fallback summary (for tests/error cases only)
 */
function generateFallbackSnipSummary(messages: Message[]): string {
  const userMsgs = messages.filter((m) => m.type === 'user')
  const firstUser = userMsgs.find((m) => extractTextContent(m).trim().length > 0)

  if (firstUser) {
    const preview = extractTextContent(firstUser).slice(0, 60).trim()
    return `[${messages.length} messages] ${preview}${preview.length >= 60 ? '...' : ''}`
  }

  return `[${messages.length} messages archived]`
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Find the index where we should snip (cut off old messages)
 * Returns the index of the first message to KEEP (0 = keep all)
 *
 * Optimized: early termination, cached token calculations
 */
function findSnipIndex(
  messages: readonly Message[],
  targetTokens: number
): number {
  let accumulatedTokens = 0

  // Calculate token counts from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue

    const msgTokens = calculateSingleMessageTokens(msg)
    accumulatedTokens += msgTokens

    // Early termination: if we've reached target, return cutoff point
    if (accumulatedTokens >= targetTokens) {
      // Return the index of the next message (which we keep)
      return Math.max(0, i)
    }
  }

  // If we never hit the target, keep all messages
  return 0
}

/**
 * Determine if messages should be snipped based on token count
 */
function shouldSnip(
  messages: readonly Message[],
  force: boolean | undefined,
  thresholdTokens: number
): boolean {
  if (force) {
    logForDebugging('[SNIP] Force snip triggered')
    return true
  }

  const totalTokens = calculateTotalTokens(messages)
  const shouldTrigger = totalTokens > thresholdTokens

  logForDebugging(
    `[SNIP] Token check: ${totalTokens} > ${thresholdTokens} = ${shouldTrigger}`
  )

  return shouldTrigger
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Snip old messages to reduce context size
 * Keeps recent messages, removes old ones
 * Uses LLM to generate summary of snipped content
 *
 * @param messages - Full message list
 * @param options - Snip options (force to bypass threshold, signal for abort)
 * @returns SnipResult with trimmed messages and metadata
 */
export async function snipCompactIfNeeded(
  messages: readonly Message[],
  options?: SnipOptions
): Promise<SnipResult> {
  const config = globalConfig

  // Handle empty or small message lists
  if (messages.length === 0) {
    return { messages: [], tokensFreed: 0, executed: false }
  }

  if (messages.length <= config.minMessagesToKeep) {
    logForDebugging(`[SNIP] Skipped: only ${messages.length} messages`)
    return { messages: [...messages], tokensFreed: 0, executed: false }
  }

  // Check if snipping is needed
  if (!shouldSnip(messages, options?.force, config.thresholdTokens)) {
    return {
      messages: [...messages],
      tokensFreed: 0,
      executed: false,
    }
  }

  const preTokens = calculateTotalTokens(messages)

  // Find where to cut
  let snipIndex = findSnipIndex(messages, config.targetTokens)

  // Enforce minimum messages to keep
  const maxSnipIndex = Math.max(0, messages.length - config.minMessagesToKeep)
  snipIndex = Math.min(snipIndex, maxSnipIndex)

  logForDebugging(
    `[SNIP] Initial index: ${findSnipIndex(messages, config.targetTokens)}, ` +
      `clamped to: ${snipIndex} (max: ${maxSnipIndex})`
  )

  // Only snip if we're removing enough messages
  if (snipIndex < config.minMessagesToSnip) {
    logForDebugging(
      `[SNIP] Cancelled: would only remove ${snipIndex} messages ` +
        `(min: ${config.minMessagesToSnip})`
    )
    return {
      messages: [...messages],
      tokensFreed: 0,
      executed: false,
    }
  }

  // Get the messages being snipped for LLM summary
  const snippedMessages = messages.slice(0, snipIndex)

  // Generate LLM summary of snipped content
  const summary = await generateSnipSummaryWithLLM(snippedMessages, {
    signal: options?.signal,
  })

  // Keep messages from snipIndex onward
  const keptMessages = messages.slice(snipIndex)
  const snippedCount = snipIndex

  // Calculate tokens freed
  const postTokens = calculateTotalTokens(keptMessages)
  const tokensFreed = preTokens - postTokens

  // Create boundary message with LLM summary
  const lastSnippedMessage: Message | undefined = messages[snipIndex - 1]
  const boundaryMessage = createCompactBoundaryMessage(
    'auto',
    preTokens,
    lastSnippedMessage?.uuid,
    summary, // LLM-generated summary
    snippedCount
  )

  // Log analytics event
  logEvent('tengu_snip_compact', {
    tokensFreed,
    messagesSnipped: snippedCount,
    trigger: (options?.force ? 'force' : 'auto') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    preTokens,
    postTokens,
  })

  logForDebugging(
    `[SNIP] Completed: removed ${snippedCount} messages, ` +
      `freed ~${tokensFreed} tokens (${preTokens} -> ${postTokens}), ` +
      `summary: ${summary.slice(0, 50)}...`
  )

  return {
    messages: keptMessages,
    tokensFreed,
    boundaryMessage,
    executed: true,
  }
}

// ============================================================================
// Utility Exports (for testing and advanced use)
// ============================================================================

/**
 * Clear the token cache (useful for testing)
 */
export function clearTokenCache(): void {
  // WeakMap clears automatically when objects are garbage collected
  // This is a no-op but provided for API consistency
}

/**
 * Calculate tokens for a message (exposed for testing)
 */
export { calculateSingleMessageTokens as _calculateSingleMessageTokensForTest }
