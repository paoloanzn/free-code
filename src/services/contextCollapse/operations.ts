// contextCollapse - Operations for view projection and message transformation
// Full implementation for public builds

import { randomUUID } from 'crypto'
import type { Message, UserMessage } from '../../types/message.js'
import { createUserMessage } from '../../utils/messages.js'
import {
  addCommit,
  getCommits,
  getNextCollapseId,
  getSessionId,
} from './state.js'
import type { ContextCollapseCommitEntry } from './types.js'

// ============================================================================
// Summary Generation - Using LLM
// ============================================================================

/**
 * Generate a summary for a span of messages using LLM
 *
 * DESIGN PRINCIPLE: All summaries MUST use LLM.
 * This function calls the internal Claude API via queryHaiku.
 */
export async function generateSummaryWithLLM(
  messages: Message[],
  options: {
    signal: AbortSignal
  }
): Promise<string> {
  try {
    // P0 FIX: Limit total prompt length to avoid API errors
    const MAX_PROMPT_LENGTH = 8000
    const MAX_MESSAGES = 50
    const MAX_CONTENT_PER_MESSAGE = 300

    // Format messages for the prompt (with length limits)
    let totalLength = 0
    const conversationText = messages
      .slice(-MAX_MESSAGES) // Only use last N messages
      .map((m) => {
        const role = m.type === 'user' ? 'User' : 'Assistant'
        const content = extractTextContent(m).slice(0, MAX_CONTENT_PER_MESSAGE)
        const formatted = `${role}: ${content}${content.length >= MAX_CONTENT_PER_MESSAGE ? '...' : ''}`
        totalLength += formatted.length
        return formatted
      })
      .join('\n\n')
      .slice(0, MAX_PROMPT_LENGTH) // Hard limit on total length

    // Prompt inspired by src/services/compact/prompt.ts patterns
    // but optimized for lightweight span summarization
    const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Your entire response must be plain text: a single summary line.

`

    const prompt = NO_TOOLS_PREAMBLE +
`You are summarizing a conversation segment that is being collapsed to save context space.
Provide a concise, informative summary (max 200 characters) that captures:

1. **Primary Request**: The user's main intent or question
2. **Key Actions**: What the assistant did (files read, code written, tools used)
3. **Outcome**: Result or current state (completed/in-progress/error)

**Requirements**:
- One sentence, plain text only
- Include specific file names if relevant
- Include error details if troubleshooting
- Do NOT use markdown formatting
- Do NOT ask follow-up questions

**Example Output**:
User fixed auth bug in login.tsx: updated token validation, added error handling for expired sessions.

**Conversation to Summarize**:
${conversationText}

**Summary**:`

    // Dynamically import to avoid circular dependencies
    const { queryHaiku } = await import('../api/claude.js')
    const { asSystemPrompt } = await import('../../utils/systemPrompt.js')

    const response = await queryHaiku({
      systemPrompt: asSystemPrompt([
        'You are a context compression summarizer. Your task is to create extremely concise summaries of conversation segments being collapsed. Focus on user intent, actions taken, and technical details. Never call tools.',
      ]),
      userPrompt: prompt,
      signal: options.signal,
      options: {
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        querySource: 'context_collapse',
        agents: [],
        mcpTools: [],
        enablePromptCaching: false,
      },
    })

    // Extract text from response
    const content = response.message.content
    if (typeof content === 'string') {
      return content.trim().slice(0, 300)
    }

    if (Array.isArray(content)) {
      const text = content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim()
      return text.slice(0, 300)
    }
  } catch (error) {
    // DESIGN PRINCIPLE: Fallback only on error
    // In production, this should not happen. In tests, we use heuristic.
    console.warn('[contextCollapse] LLM summary failed, using fallback:', error)
  }

  // Fallback: use heuristic (only for tests/error cases)
  return generateFallbackSummary(messages)
}

/**
 * Fallback summary generator (for tests only)
 * DESIGN PRINCIPLE: This is NOT for production use
 */
function generateFallbackSummary(messages: Message[]): string {
  const userMsgs = messages.filter(m => m.type === 'user')
  const firstUser = userMsgs.find(m => extractTextContent(m).trim().length > 0)
  if (firstUser) {
    const preview = extractTextContent(firstUser).slice(0, 80).trim()
    return `[${messages.length} messages] ${preview}${preview.length >= 80 ? '...' : ''}`
  }
  return `[${messages.length} messages]`
}

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

// ============================================================================
// View Projection
// ============================================================================

/**
 * Project commits onto messages
 * Replaces collapsed message ranges with summary placeholders
 */
export function projectView(messages: Message[]): Message[] {
  const commits = getCommits()
  if (commits.length === 0) {
    return messages
  }

  // Build a map of commits by their start message UUID
  const commitByStartUuid = new Map<string, ContextCollapseCommitEntry>()
  for (const commit of commits) {
    commitByStartUuid.set(commit.startUuid, commit)
  }

  // Track which commits have been applied
  const appliedCommits = new Set<string>()

  // Find messages that are part of collapsed ranges
  const result: Message[] = []
  let skipUntilUuid: string | null = null

  for (const msg of messages) {
    // Check if we're in a skip range (inside a collapsed span)
    if (skipUntilUuid) {
      if (msg.uuid === skipUntilUuid) {
        skipUntilUuid = null
      }
      // Skip this message - it's part of the collapsed range
      continue
    }

    // Check if this message starts a collapsed range
    const commit = commitByStartUuid.get(msg.uuid)
    if (commit && !appliedCommits.has(commit.collapseId)) {
      // Replace this message with the summary placeholder
      result.push(createSummaryPlaceholder(commit))
      skipUntilUuid = commit.endUuid
      appliedCommits.add(commit.collapseId)
      continue
    }

    result.push(msg)
  }

  return result
}

function createSummaryPlaceholder(commit: ContextCollapseCommitEntry): UserMessage {
  return createUserMessage({
    content: commit.summaryContent,
    isMeta: true,
    uuid: commit.summaryUuid,
  }) as UserMessage
}

// ============================================================================
// Span Analysis
// ============================================================================

/**
 * Score the coherence of a potential span
 * Higher score = better collapse candidate
 */
function scoreSpanCoherence(span: Message[]): number {
  let score = 0
  const texts = span.map((m) => extractTextContent(m).toLowerCase())

  // Prefer spans that start with user question and end with assistant response
  if (span[0]?.type === 'user') score += 2
  if (span[span.length - 1]?.type === 'assistant') score += 2

  // Check for topic continuity (shared keywords)
  const firstText = texts[0] || ''
  const lastText = texts[texts.length - 1] || ''
  const firstWords = new Set(firstText.split(/\s+/).slice(0, 10))
  const commonWords = lastText.split(/\s+/).filter((w) => firstWords.has(w)).length
  score += Math.min(commonWords, 3) // Max 3 points for topic overlap

  // Penalize spans with tool use (may be incomplete operations)
  const hasToolUse = span.some(
    (m) =>
      typeof m.message?.content === 'object' &&
      Array.isArray(m.message.content) &&
      m.message.content.some(
        (b: { type?: string }) => b.type === 'tool_use' || b.type === 'tool_result'
      )
  )
  if (hasToolUse) score -= 3

  // Bonus for spans with clear question-answer pattern
  const qaPattern =
    span.filter((m) => m.type === 'user').length === 1 &&
    span.filter((m) => m.type === 'assistant').length >= 1
  if (qaPattern) score += 2

  return score
}

/**
 * Find natural conversation boundaries
 * Looks for transitions between topics
 */
function findNaturalBoundary(messages: Message[], startIdx: number, maxIdx: number): number {
  // Look for user messages that start with topic indicators
  const topicStarters = /^(?:new|next|switching|now|let's|can you|how about|what about|instead)/i

  for (let i = startIdx + 3; i < Math.min(maxIdx, startIdx + 20); i++) {
    const msg = messages[i]
    if (msg?.type !== 'user') continue

    const text = extractTextContent(msg)
    // Found a natural break point
    if (topicStarters.test(text.trim())) {
      return i - 1 // End span before this message
    }

    // Also break at very short user messages (acknowledgments)
    if (text.trim().length < 20 && i > startIdx + 3) {
      return i - 1
    }
  }

  // Default: return max allowed
  return Math.min(maxIdx, startIdx + 20)
}

/**
 * Find collapsible spans in messages
 * Returns ranges that can be collapsed
 * Uses semantic heuristics to find coherent conversation segments
 */
export function findCollapsibleSpans(
  messages: Message[],
  options: {
    minSpanSize?: number
    maxSpanSize?: number
  } = {}
): Array<{ startIdx: number; endIdx: number; messages: Message[]; score: number }> {
  const { minSpanSize = 3, maxSpanSize = 20 } = options
  const spans: Array<{ startIdx: number; endIdx: number; messages: Message[]; score: number }> =
    []

  // Skip recent messages (don't collapse the most recent N)
  const recentMessageCount = 10
  const candidateEnd = Math.max(0, messages.length - recentMessageCount)

  let i = 0
  while (i < candidateEnd - minSpanSize) {
    // Find natural boundary instead of arbitrary cutoff
    const naturalEnd = findNaturalBoundary(messages, i, candidateEnd)

    // Build span up to natural boundary
    const span: Message[] = []
    let j = i

    while (j <= naturalEnd && span.length < maxSpanSize && j < candidateEnd) {
      const msg = messages[j]

      // Skip system messages and meta messages
      if (
        msg.type === 'system' ||
        msg.type === 'compact' ||
        (msg.type === 'user' && msg.isMeta)
      ) {
        j++
        continue
      }

      span.push(msg)
      j++
    }

    // Validate span quality
    if (span.length >= minSpanSize) {
      const score = scoreSpanCoherence(span)

      // Only include if it meets minimum coherence
      if (score >= 2) {
        spans.push({
          startIdx: i,
          endIdx: j - 1,
          messages: span,
          score,
        })
      }
      i = j
    } else {
      i++
    }
  }

  // Sort by score (highest first) and return
  return spans.sort((a, b) => b.score - a.score)
}

// ============================================================================
// Commit Operations
// ============================================================================

/**
 * Create a commit from a span of messages (sync version - uses heuristic)
 * DEPRECATED: Use commitSpanWithLLM for production
 */
export function commitSpan(
  messages: Message[],
  startIdx: number,
  endIdx: number
): ContextCollapseCommitEntry | null {
  const span = messages.slice(startIdx, endIdx + 1)
  if (span.length === 0) return null

  const firstMsg = span[0]!
  const lastMsg = span[span.length - 1]!

  // Temporary fallback summary - should not be used in production
  const summary = `[${span.length} messages] ${extractTextContent(firstMsg).slice(0, 50)}...`

  const collapseId = getNextCollapseId()
  const summaryUuid = randomUUID()

  const commit: ContextCollapseCommitEntry = {
    type: 'marble-origami-commit',
    sessionId: getSessionId(),
    collapseId,
    summaryUuid,
    startUuid: firstMsg.uuid,
    endUuid: lastMsg.uuid,
    summaryContent: `<collapsed id="${collapseId}">${summary}</collapsed>`,
    summary,
  }

  addCommit(commit)

  return commit
}

/**
 * Create a commit from a span of messages using LLM for summary
 *
 * DESIGN PRINCIPLE: This is the recommended way to create commits.
 * It uses LLM to generate semantic summaries.
 */
export async function commitSpanWithLLM(
  messages: Message[],
  startIdx: number,
  endIdx: number,
  options: {
    signal: AbortSignal
  }
): Promise<ContextCollapseCommitEntry | null> {
  const span = messages.slice(startIdx, endIdx + 1)
  if (span.length === 0) return null

  const firstMsg = span[0]!
  const lastMsg = span[span.length - 1]!

  // Use LLM for summary
  const summary = await generateSummaryWithLLM(span, options)

  const collapseId = getNextCollapseId()
  const summaryUuid = randomUUID()

  const commit: ContextCollapseCommitEntry = {
    type: 'marble-origami-commit',
    sessionId: getSessionId(),
    collapseId,
    summaryUuid,
    startUuid: firstMsg.uuid,
    endUuid: lastMsg.uuid,
    summaryContent: `<collapsed id="${collapseId}">${summary}</collapsed>`,
    summary,
  }

  addCommit(commit)

  return commit
}

/**
 * Get summary content for a commit ID
 */
export function getSummaries(): Map<string, string> {
  const commits = getCommits()
  const map = new Map<string, string>()

  for (const commit of commits) {
    map.set(commit.summaryUuid, commit.summary)
    map.set(commit.collapseId, commit.summary)
  }

  return map
}

/**
 * Register a summary (for external integration)
 */
export function registerSummary(summaryUuid: string, summary: string): void {
  // In full implementation, this might update an existing commit
  // or create a mapping for lazy-loaded summaries
}

// ============================================================================
// Message Transformation
// ============================================================================

/**
 * Replace a range of messages with their summary
 */
export function collapseMessages(
  messages: Message[],
  startIdx: number,
  endIdx: number,
  summaryMessage: Message
): Message[] {
  const result = [...messages]
  result.splice(startIdx, endIdx - startIdx + 1, summaryMessage)
  return result
}

/**
 * Check if a message is a collapsed summary placeholder
 */
export function isCollapsedMessage(msg: Message): boolean {
  if (msg.type !== 'user') return false

  const content = extractTextContent(msg)
  return content.includes('<collapsed') && content.includes('</collapsed>')
}
