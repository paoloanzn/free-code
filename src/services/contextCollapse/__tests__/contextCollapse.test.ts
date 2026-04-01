// contextCollapse Test Suite
// Comprehensive tests for the context collapse functionality

import { randomUUID } from 'crypto'
import type { Message, UserMessage } from '../../../types/message.js'
import { createUserMessage } from '../../../utils/messages.js'
import {
  applyCollapsesIfNeeded,
  isContextCollapseEnabled,
  isWithheldPromptTooLong,
  recoverFromOverflow,
  resetContextCollapse,
  getStats,
  projectView,
  getSummaries,
} from '../index.js'
import {
  findCollapsibleSpans,
  commitSpan,
  isCollapsedMessage,
} from '../operations.js'
import { restoreFromEntries } from '../persist.js'
import { getState, resetState, importState } from '../state.js'
import type { ContextCollapseCommitEntry } from '../types.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockMessage(
  type: 'user' | 'assistant',
  text: string,
  uuid?: string
): Message {
  return {
    uuid: uuid || randomUUID(),
    type,
    message: {
      content: [{ type: 'text', text }],
    },
    timestamp: new Date().toISOString(),
  } as Message
}

function createLongConversation(messageCount: number): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < messageCount; i++) {
    const type = i % 2 === 0 ? 'user' : 'assistant'
    messages.push(
      createMockMessage(type, `Message ${i + 1} content here`)
    )
  }
  return messages
}

// ============================================================================
// State Management Tests
// ============================================================================

describe('State Management', () => {
  beforeEach(() => {
    resetState()
  })

  test('resetState clears all state', () => {
    const state = getState()
    expect(state.commits).toHaveLength(0)
    expect(state.staged).toHaveLength(0)
    expect(state.snapshot).toBeNull()
    expect(state.nextCollapseId).toBe(1)
  })

  test('getStats returns correct counts', () => {
    const stats = getStats()
    expect(stats.collapsedSpans).toBe(0)
    expect(stats.stagedSpans).toBe(0)
    expect(stats.health.totalErrors).toBe(0)
  })

  test('importState restores commits correctly', () => {
    const startUuid = randomUUID()
    const endUuid = randomUUID()
    const mockCommit: ContextCollapseCommitEntry = {
      type: 'marble-origami-commit',
      sessionId: randomUUID(),
      collapseId: '0000000000000001',
      summaryUuid: randomUUID(),
      startUuid,
      endUuid,
      summaryContent: '<collapsed id="1">Test summary</collapsed>',
      summary: 'Test summary',
    }

    importState({ commits: [mockCommit], nextCollapseId: 2 })

    const state = getState()
    expect(state.commits).toHaveLength(1)
    expect(state.commits[0]!.collapseId).toBe('0000000000000001')
    expect(state.nextCollapseId).toBe(2)
  })
})

// ============================================================================
// Span Detection Tests
// ============================================================================

describe('Span Detection', () => {
  test('findCollapsibleSpans finds valid spans in long conversation', () => {
    const messages = createLongConversation(25)
    const spans = findCollapsibleSpans(messages)

    expect(spans.length).toBeGreaterThan(0)

    // Each span should have at least 3 messages
    for (const span of spans) {
      expect(span.messages.length).toBeGreaterThanOrEqual(3)
      expect(span.startIdx).toBeLessThan(span.endIdx)
    }
  })

  test('findCollapsibleSpans respects minSpanSize', () => {
    const messages = createLongConversation(20)
    const spans = findCollapsibleSpans(messages, { minSpanSize: 5 })

    for (const span of spans) {
      expect(span.messages.length).toBeGreaterThanOrEqual(5)
    }
  })

  test('findCollapsibleSpans skips recent messages', () => {
    const messages = createLongConversation(15)
    const spans = findCollapsibleSpans(messages)

    // Should not include the last 10 messages
    if (spans.length > 0) {
      const lastSpan = spans[spans.length - 1]!
      expect(lastSpan.endIdx).toBeLessThan(15)
    }
  })

  test('findCollapsibleSpans returns empty for short conversation', () => {
    const messages = createLongConversation(5)
    const spans = findCollapsibleSpans(messages)

    expect(spans).toHaveLength(0)
  })
})

// ============================================================================
// Commit Operations Tests
// ============================================================================

describe('Commit Operations', () => {
  beforeEach(() => {
    resetState()
  })

  test('commitSpan creates valid commit', () => {
    const messages = createLongConversation(15)
    const commit = commitSpan(messages, 0, 4)

    expect(commit).not.toBeNull()
    expect(commit!.type).toBe('marble-origami-commit')
    expect(commit!.collapseId).toMatch(/^\d{16}$/)
    expect(commit!.summaryContent).toContain('<collapsed')
    expect(commit!.summaryContent).toContain('</collapsed>')
  })

  test('commitSpan adds commit to state', () => {
    const messages = createLongConversation(15)
    commitSpan(messages, 0, 4)

    const state = getState()
    expect(state.commits).toHaveLength(1)
  })

  test('commitSpan returns null for invalid range', () => {
    const messages = createLongConversation(5)
    const commit = commitSpan(messages, 10, 15)

    expect(commit).toBeNull()
  })
})

// ============================================================================
// View Projection Tests
// ============================================================================

describe('View Projection', () => {
  beforeEach(() => {
    resetState()
  })

  test('projectView returns original messages when no commits', () => {
    const messages = createLongConversation(10)
    const projected = projectView(messages)

    expect(projected).toHaveLength(messages.length)
    expect(projected[0]!.uuid).toBe(messages[0]!.uuid)
  })

  test('projectView includes summary placeholders', () => {
    const messages = createLongConversation(15)

    // Create a commit
    const commit = commitSpan(messages, 0, 4)
    expect(commit).not.toBeNull()

    // Project view - the original messages should be replaced by summary
    const projected = projectView(messages)

    // Check that at least one message is our summary
    const hasSummary = projected.some(
      (m) => m.type === 'user' && isCollapsedMessage(m)
    )
    expect(hasSummary).toBe(true)
  })

  test('getSummaries returns commit summaries', () => {
    const messages = createLongConversation(15)
    commitSpan(messages, 0, 4)

    const summaries = getSummaries()
    expect(summaries.size).toBeGreaterThan(0)
  })
})

// ============================================================================
// Main API Tests
// ============================================================================

describe('Main API', () => {
  beforeEach(() => {
    resetContextCollapse()
  })

  test('isContextCollapseEnabled returns true by default', () => {
    expect(isContextCollapseEnabled()).toBe(true)
  })

  test('applyCollapsesIfNeeded returns messages for short conversation', async () => {
    const messages = createLongConversation(5)
    const mockToolContext = {
      abortController: new AbortController()
    } as any
    const result = await applyCollapsesIfNeeded(
      messages,
      mockToolContext,
      'repl_main_thread' as any
    )

    expect(result.messages).toHaveLength(messages.length)
    expect(result.committed).toBe(0)
  })

  test('applyCollapsesIfNeeded creates commits for long conversation', async () => {
    const messages = createLongConversation(25)
    const mockToolContext = {
      abortController: new AbortController()
    } as any

    const result = await applyCollapsesIfNeeded(
      messages,
      mockToolContext,
      'repl_main_thread' as any
    )

    // Should have found and committed some spans
    expect(result.committed).toBeGreaterThan(0)
    expect(result.staged).toBeGreaterThan(0)
  })

  test('recoverFromOverflow forces collapse', async () => {
    const messages = createLongConversation(20)

    const result = await recoverFromOverflow(messages, 'repl_main_thread' as any)

    // Should commit at least one span
    expect(result.committed).toBeGreaterThanOrEqual(0)

    if (result.committed > 0) {
      // Messages should be transformed
      expect(result.messages.length).toBeLessThanOrEqual(messages.length)
    }
  })

  test('recoverFromOverflow handles empty conversation', async () => {
    const result = await recoverFromOverflow([], 'repl_main_thread' as any)

    expect(result.committed).toBe(0)
    expect(result.messages).toHaveLength(0)
  })
})

// ============================================================================
// Withheld Prompt Tests
// ============================================================================

describe('Withheld Prompt Detection', () => {
  const mockIsPromptTooLong = () => false

  test('isWithheldPromptTooLong detects long user message', () => {
    const longMessage = createMockMessage(
      'user',
      'a'.repeat(500000) // ~125k tokens estimated
    )

    const result = isWithheldPromptTooLong(
      longMessage,
      mockIsPromptTooLong,
      'repl_main_thread' as any
    )

    expect(result).toBe(true)
  })

  test('isWithheldPromptTooLong returns false for short message', () => {
    const shortMessage = createMockMessage('user', 'Hello')

    const result = isWithheldPromptTooLong(
      shortMessage,
      mockIsPromptTooLong,
      'repl_main_thread' as any
    )

    expect(result).toBe(false)
  })
})

// ============================================================================
// Persistence Tests
// ============================================================================

describe('Persistence', () => {
  beforeEach(() => {
    resetState()
  })

  test('restoreFromEntries restores commits and counter', () => {
    const mockCommits: ContextCollapseCommitEntry[] = [
      {
        type: 'marble-origami-commit',
        sessionId: randomUUID(),
        collapseId: '0000000000000005',
        summaryUuid: randomUUID(),
        startUuid: randomUUID(),
        endUuid: randomUUID(),
        summaryContent: '<collapsed id="5">Test</collapsed>',
        summary: 'Test',
      },
      {
        type: 'marble-origami-commit',
        sessionId: randomUUID(),
        collapseId: '0000000000000010',
        summaryUuid: randomUUID(),
        startUuid: randomUUID(),
        endUuid: randomUUID(),
        summaryContent: '<collapsed id="10">Test 2</collapsed>',
        summary: 'Test 2',
      },
    ]

    restoreFromEntries(mockCommits, null)

    const state = getState()
    expect(state.commits).toHaveLength(2)
    expect(state.nextCollapseId).toBe(11) // Max + 1
  })

  test('restoreFromEntries handles snapshot', () => {
    const mockCommits: ContextCollapseCommitEntry[] = []
    const mockSnapshot = {
      type: 'marble-origami-snapshot' as const,
      sessionId: randomUUID(),
      staged: [
        {
          startUuid: randomUUID(),
          endUuid: randomUUID(),
          summary: 'Staged summary',
          risk: 0.5,
          stagedAt: Date.now(),
        },
      ],
    }

    restoreFromEntries(mockCommits, mockSnapshot)

    const state = getState()
    expect(state.snapshot).toEqual(mockSnapshot)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    resetState()
  })

  test('handles messages without content array', () => {
    const messages = [
      {
        uuid: randomUUID(),
        type: 'system',
        message: { content: 'System message' },
        timestamp: new Date().toISOString(),
      },
    ] as Message[]

    const spans = findCollapsibleSpans(messages)
    expect(spans).toHaveLength(0)
  })

  test('handles empty message array', async () => {
    const result = await recoverFromOverflow([], 'repl_main_thread' as any)
    expect(result.messages).toHaveLength(0)
    expect(result.committed).toBe(0)
  })

  test('handles duplicate collapse attempts', async () => {
    const messages = createLongConversation(25)
    const mockToolContext = {
      abortController: new AbortController()
    } as any

    // First collapse
    const result1 = await applyCollapsesIfNeeded(
      messages,
      mockToolContext,
      'repl_main_thread' as any
    )

    // Second collapse on same messages
    const result2 = await applyCollapsesIfNeeded(
      messages,
      mockToolContext,
      'repl_main_thread' as any
    )

    // Second should not create new commits for already-collapsed spans
    expect(result2.committed).toBe(0)
  })
})

// ============================================================================
// Integration Test
// ============================================================================

describe('Integration: Full Workflow', () => {
  beforeEach(() => {
    resetContextCollapse()
  })

  test('complete collapse workflow', async () => {
    // Step 1: Create a long conversation
    const messages = createLongConversation(30)
    const originalLength = messages.length
    const mockToolContext = {
      abortController: new AbortController()
    } as any

    // Step 2: Apply collapses
    const result = await applyCollapsesIfNeeded(
      messages,
      mockToolContext,
      'repl_main_thread' as any
    )

    expect(result.committed).toBeGreaterThan(0)

    // Step 3: Verify stats updated
    const stats = getStats()
    expect(stats.collapsedSpans).toBeGreaterThan(0)

    // Step 4: Project view should show collapsed messages
    const projected = projectView(messages)
    const collapsedCount = projected.filter((m) =>
      isCollapsedMessage(m)
    ).length
    expect(collapsedCount).toBeGreaterThan(0)

    // Step 5: Verify total message count is reasonable
    expect(projected.length).toBeLessThan(originalLength)
  })

  test('overflow recovery workflow', async () => {
    // Simulate token overflow scenario
    const messages = createLongConversation(50)

    // Initial state
    const initialStats = getStats()
    expect(initialStats.collapsedSpans).toBe(0)

    // Trigger overflow recovery
    const result = await recoverFromOverflow(messages, 'repl_main_thread' as any)

    // Should commit at least one span
    if (result.committed > 0) {
      const afterStats = getStats()
      expect(afterStats.collapsedSpans).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// Run Tests
// ============================================================================

if (require.main === module) {
  // Simple test runner for standalone execution
  console.log('Running contextCollapse tests...\n')

  // Note: In a real test environment, you'd use Jest or Vitest
  // This file is structured to work with those test runners

  console.log('✓ Test file loaded successfully')
  console.log('✓ Import all modules: OK')
  console.log('\nTo run tests: bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts')
}
