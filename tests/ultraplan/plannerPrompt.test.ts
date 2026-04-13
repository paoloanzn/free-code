import { describe, expect, test } from 'bun:test'

import {
  buildUltraplanSystemPrompt,
  buildUltraplanUserPrompt,
} from '../../src/utils/ultraplan/plannerPrompt.js'

describe('buildUltraplanSystemPrompt', () => {
  test('uses draft output contract when no seed plan is present', () => {
    const prompt = buildUltraplanSystemPrompt('deep', false)
    expect(prompt).toContain('1. Goal')
    expect(prompt).toContain('3. Current Codebase Findings')
    expect(prompt).toContain('8. Step-by-step Execution Plan')
    expect(prompt).not.toContain('Keep')
    expect(prompt).not.toContain('Revised Execution Plan')
  })

  test('uses refine output contract when a seed plan is present', () => {
    const prompt = buildUltraplanSystemPrompt('max', true)
    expect(prompt).toContain('2. Existing Plan Assessment')
    expect(prompt).toContain('3. Keep')
    expect(prompt).toContain('4. Change')
    expect(prompt).toContain('5. Add')
    expect(prompt).toContain('6. Revised Execution Plan')
  })
})

describe('buildUltraplanUserPrompt', () => {
  test('asks for structured refinement when a seed plan exists', () => {
    const prompt = buildUltraplanUserPrompt(
      'Refine the release plan',
      '# Local Workspace Snapshot\n',
      'deep',
      '1. Ship it',
    )

    expect(prompt).toContain('Existing draft plan to refine:')
    expect(prompt).toContain('Start by critiquing the draft plan')
    expect(prompt).toContain('Keep / Change / Add')
    expect(prompt).toContain('1. Ship it')
  })
})
