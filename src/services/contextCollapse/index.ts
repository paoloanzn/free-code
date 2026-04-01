// contextCollapse - Smart context compression service
// Full implementation for public builds

import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { randomUUID } from 'crypto'
import {
  projectView,
  findCollapsibleSpans,
  commitSpanWithLLM,
  getSummaries,
  registerSummary,
} from './operations.js'
import { restoreFromEntries } from './persist.js'
import {
  getStats,
  subscribe,
  getState,
  setEnabled,
  resetState,
  getStaged,
  clearStaged,
} from './state.js'
import type { ContextCollapseCommitEntry, ContextCollapseSnapshotEntry } from './types.js'

export type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
  StagedSpan,
  CollapseStats,
  SummaryGenerator,
  PendingSummary,
} from './types.js'

// Re-export operations
export {
  projectView,
  getSummaries,
  registerSummary,
  generateSummaryWithLLM,
  commitSpanWithLLM,
} from './operations.js'
export { restoreFromEntries }
export { getStats, subscribe }

// ============================================================================
// Core API
// ============================================================================

/**
 * Check if context collapse is enabled
 */
export function isContextCollapseEnabled(): boolean {
  return getState().enabled
}

/**
 * Enable/disable context collapse
 */
export function setContextCollapseEnabled(enabled: boolean): void {
  setEnabled(enabled)
}

/**
 * Reset context collapse state
 */
export function resetContextCollapse(): void {
  resetState()
}

// ============================================================================
// Apply Collapses
// ============================================================================

interface CollapseApplyResult {
  messages: Message[]
  committed: number
  staged: number
}

/**
 * Apply collapses if needed
 * Main entry point called by query.ts
 *
 * DESIGN PRINCIPLE: Uses LLM for all summaries
 */
export async function applyCollapsesIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  _querySource: QuerySource
): Promise<CollapseApplyResult> {
  if (!isContextCollapseEnabled()) {
    return { messages, committed: 0, staged: 0 }
  }

  // P0 FIX: Signal is required for LLM calls. If not available, skip LLM summary.
  const signal = toolUseContext?.abortController?.signal
  if (!signal) {
    // No abort signal available - skip LLM summarization to avoid hanging
    return { messages, committed: 0, staged: 0 }
  }

  // First, project any existing commits onto the messages
  let projected = projectView(messages)

  // Find new collapsible spans
  const spans = findCollapsibleSpans(projected)
  if (spans.length === 0) {
    return { messages: projected, committed: 0, staged: 0 }
  }

  // Stage the spans (don't commit immediately)
  let committed = 0
  const staged = spans.length

  for (const span of spans) {
    // Check if already collapsed
    const alreadyCollapsed = projected.some(
      (m, idx) =>
        idx >= span.startIdx &&
        idx <= span.endIdx &&
        m.type === 'user' &&
        m.uuid &&
        getState().commits.some((c) => c.summaryUuid === m.uuid)
    )

    if (!alreadyCollapsed && !signal.aborted) {
      // Use LLM for summary (DESIGN PRINCIPLE)
      const commit = await commitSpanWithLLM(
        projected,
        span.startIdx,
        span.endIdx,
        { signal }
      )
      if (commit) {
        committed++
      }
    }
  }

  // Re-project after commits
  projected = projectView(messages)

  return { messages: projected, committed, staged }
}

// ============================================================================
// Overflow Recovery
// ============================================================================

interface RecoveryResult {
  messages: Message[]
  committed: number
}

/**
 * Recover from token overflow
 * Called when API returns 413 (payload too large)
 *
 * DESIGN PRINCIPLE: Uses LLM for all summaries
 */
export async function recoverFromOverflow(
  messages: Message[],
  querySource: QuerySource,
  toolUseContext?: ToolUseContext
): Promise<RecoveryResult> {
  if (!isContextCollapseEnabled()) {
    return { messages, committed: 0 }
  }

  // P0 FIX: Signal is required for LLM calls. If not available, skip.
  const signal = toolUseContext?.abortController?.signal
  if (!signal || signal.aborted) {
    return { messages, committed: 0 }
  }

  // Force collapse of the oldest available span
  const spans = findCollapsibleSpans(messages, { minSpanSize: 2 })
  if (spans.length === 0) {
    return { messages, committed: 0 }
  }

  // Collapse the oldest span using LLM
  const oldestSpan = spans[0]!
  const commit = await commitSpanWithLLM(
    messages,
    oldestSpan.startIdx,
    oldestSpan.endIdx,
    { signal }
  )

  if (commit) {
    const projected = projectView(messages)
    return { messages: projected, committed: 1 }
  }

  return { messages, committed: 0 }
}

// ============================================================================
// Withheld Prompt Handling
// ============================================================================

/**
 * Check if a withheld prompt is too long
 * Used for handling paused/resumed prompts
 */
export function isWithheldPromptTooLong(
  message: Message,
  isPromptTooLongMessage: (m: Message) => boolean,
  _querySource: QuerySource
): boolean {
  if (!isContextCollapseEnabled()) {
    return false
  }

  // Check if this is a "prompt too long" error message
  if (isPromptTooLongMessage(message)) {
    return true
  }

  // Also check message content length
  if (message.type === 'user' || message.type === 'assistant') {
    const content =
      typeof message.message?.content === 'string'
        ? message.message.content
        : JSON.stringify(message.message?.content)

    // Rough estimate: 1 token ~ 4 characters
    const estimatedTokens = content.length / 4
    if (estimatedTokens > 100000) {
      return true
    }
  }

  return false
}
