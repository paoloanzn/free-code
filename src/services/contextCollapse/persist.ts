// contextCollapse - Persistence and recovery
// Full implementation for public builds

import type { ContextCollapseCommitEntry, ContextCollapseSnapshotEntry } from './types.js'
import { importState, setSnapshot } from './state.js'

/**
 * Restore context collapse state from persisted entries
 */
export function restoreFromEntries(
  commits: ContextCollapseCommitEntry[],
  snapshot: ContextCollapseSnapshotEntry | null
): void {
  let maxCollapseId = 0
  for (const commit of commits) {
    const idNum = parseInt(commit.collapseId, 10)
    if (!isNaN(idNum) && idNum > maxCollapseId) {
      maxCollapseId = idNum
    }
  }

  importState({
    commits,
    snapshot,
    nextCollapseId: maxCollapseId + 1,
  })
}

/**
 * Export current state for persistence
 */
export function exportEntries(): {
  commits: ContextCollapseCommitEntry[]
  snapshot: ContextCollapseSnapshotEntry | null
} {
  const { exportState } = require('./state.js')
  const exported = exportState()
  return {
    commits: exported.commits,
    snapshot: exported.snapshot,
  }
}

/**
 * Create a snapshot of current staged spans
 */
export function createSnapshot(
  staged: ContextCollapseSnapshotEntry['staged']
): ContextCollapseSnapshotEntry {
  const { getSessionId } = require('./state.js')
  return {
    type: 'marble-origami-snapshot',
    sessionId: getSessionId(),
    staged: [...staged],
  }
}

/**
 * Save current state as snapshot
 */
export function saveSnapshot(staged: ContextCollapseSnapshotEntry['staged']): void {
  setSnapshot(createSnapshot(staged))
}

/**
 * Check if a commit is still valid
 */
export function isCommitValid(
  commit: ContextCollapseCommitEntry,
  currentMessages: { uuid: string }[]
): boolean {
  return currentMessages.some((m) => m.uuid === commit.summaryUuid)
}

/**
 * Clean up stale commits
 */
export function cleanupStaleCommits(
  commits: ContextCollapseCommitEntry[],
  currentMessages: { uuid: string }[]
): ContextCollapseCommitEntry[] {
  return commits.filter((commit) => isCommitValid(commit, currentMessages))
}
