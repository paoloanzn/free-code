// contextCollapse - Types for smart context compression
// Full implementation for public builds

import type { UUID } from 'crypto'
import type { Message } from '../../types/message.js'

// ============================================================================
// Collapse State Types
// ============================================================================

export interface StagedSpan {
  startUuid: string
  endUuid: string
  summary: string
  risk: number
  stagedAt: number
}

export interface CollapseState {
  enabled: boolean
  commits: ContextCollapseCommitEntry[]
  snapshot: ContextCollapseSnapshotEntry | null
  staged: StagedSpan[]
  nextCollapseId: number
  subscribers: Set<() => void>
}

export interface CollapseStats {
  collapsedSpans: number
  stagedSpans: number
  health: {
    totalErrors: number
    totalEmptySpawns: number
    emptySpawnWarningEmitted: boolean
  }
}

// ============================================================================
// Log Entry Types (from types/logs.ts)
// ============================================================================

export type ContextCollapseCommitEntry = {
  type: 'marble-origami-commit'
  sessionId: UUID
  collapseId: string
  summaryUuid: string
  startUuid: string
  endUuid: string
  summaryContent: string
  summary: string
}

export type ContextCollapseSnapshotEntry = {
  type: 'marble-origami-snapshot'
  sessionId: UUID
  staged: Array<{
    startUuid: string
    endUuid: string
    summary: string
    risk: number
    stagedAt: number
  }>
  spawnTrigger?: {
    lastSpawnAt: number
    intervalMs: number
  }
}

// ============================================================================
// LLM Summary Service Types
// ============================================================================

/**
 * LLM-based summary generator interface
 * All implementations must use LLM (no rule-based summaries allowed)
 */
export interface SummaryGenerator {
  /**
   * Generate a semantic summary of conversation messages
   * Must use LLM API, not heuristic extraction
   */
  generateSummary(messages: Message[]): Promise<string>

  /**
   * Generate summary with specific focus/persona
   * e.g., "technical", "planning", "debugging"
   */
  generateSummaryWithFocus(
    messages: Message[],
    focus: 'general' | 'technical' | 'planning' | 'debugging'
  ): Promise<string>
}

/**
 * Pending summary that will be filled by LLM async
 */
export interface PendingSummary {
  collapseId: string
  messages: Message[]
  placeholder: string
  promise: Promise<string>
  status: 'pending' | 'completed' | 'failed'
}

// ============================================================================
// Operation Types
// ============================================================================

export interface CollapseOptions {
  thresholdTokens?: number
  minMessagesToCollapse?: number
  maxSummaryLength?: number
}

export interface CollapseResult {
  messages: Message[]
  committed: number
  staged: number
}

export interface RecoveryResult {
  messages: Message[]
  committed: number
  recovered: boolean
}
