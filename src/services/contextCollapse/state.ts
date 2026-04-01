// contextCollapse - State management
// Full implementation for public builds

import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import type {
  CollapseState,
  CollapseStats,
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
  StagedSpan,
} from './types.js'

// ============================================================================
// Module State
// ============================================================================

const state: CollapseState = {
  enabled: true,
  commits: [],
  snapshot: null,
  staged: [],
  nextCollapseId: 1,
  subscribers: new Set(),
}

const sessionId: UUID = randomUUID()

// ============================================================================
// State Accessors
// ============================================================================

export function getState(): Readonly<CollapseState> {
  return state
}

export function getSessionId(): UUID {
  return sessionId
}

export function getCommits(): ContextCollapseCommitEntry[] {
  return [...state.commits]
}

export function getStaged(): StagedSpan[] {
  return [...state.staged]
}

export function getNextCollapseId(): string {
  const id = state.nextCollapseId.toString().padStart(16, '0')
  state.nextCollapseId++
  return id
}

// ============================================================================
// State Modifiers
// ============================================================================

export function addCommit(commit: ContextCollapseCommitEntry): void {
  state.commits.push(commit)
  // Keep commits ordered by collapseId
  state.commits.sort((a, b) => a.collapseId.localeCompare(b.collapseId))
  notifySubscribers()
}

export function setStaged(staged: StagedSpan[]): void {
  state.staged = [...staged]
  notifySubscribers()
}

export function addStaged(span: StagedSpan): void {
  state.staged.push(span)
  notifySubscribers()
}

export function removeStaged(startUuid: string): void {
  state.staged = state.staged.filter((s) => s.startUuid !== startUuid)
  notifySubscribers()
}

export function clearStaged(): void {
  state.staged = []
  notifySubscribers()
}

export function setSnapshot(snapshot: ContextCollapseSnapshotEntry | null): void {
  state.snapshot = snapshot
}

export function setEnabled(enabled: boolean): void {
  state.enabled = enabled
  notifySubscribers()
}

export function resetState(): void {
  state.commits = []
  state.snapshot = null
  state.staged = []
  state.nextCollapseId = 1
  notifySubscribers()
}

// ============================================================================
// Subscription System (for TokenWarning component)
// ============================================================================

export function subscribe(callback: () => void): () => void {
  state.subscribers.add(callback)
  return () => {
    state.subscribers.delete(callback)
  }
}

function notifySubscribers(): void {
  for (const callback of state.subscribers) {
    try {
      callback()
    } catch {
      // Ignore subscriber errors
    }
  }
}

// ============================================================================
// Stats Generation
// ============================================================================

export function getStats(): CollapseStats {
  return {
    collapsedSpans: state.commits.length,
    stagedSpans: state.staged.length,
    health: {
      totalErrors: 0,
      totalEmptySpawns: 0,
      emptySpawnWarningEmitted: false,
    },
  }
}

// ============================================================================
// Persist/Restore Helpers
// ============================================================================

export function exportState(): {
  commits: ContextCollapseCommitEntry[]
  snapshot: ContextCollapseSnapshotEntry | null
  nextCollapseId: number
} {
  return {
    commits: [...state.commits],
    snapshot: state.snapshot ? { ...state.snapshot } : null,
    nextCollapseId: state.nextCollapseId,
  }
}

export function importState(data: {
  commits?: ContextCollapseCommitEntry[]
  snapshot?: ContextCollapseSnapshotEntry | null
  nextCollapseId?: number
}): void {
  if (data.commits) {
    state.commits = [...data.commits]
  }
  if (data.snapshot !== undefined) {
    state.snapshot = data.snapshot
  }
  if (data.nextCollapseId !== undefined) {
    state.nextCollapseId = data.nextCollapseId
  }
  notifySubscribers()
}
