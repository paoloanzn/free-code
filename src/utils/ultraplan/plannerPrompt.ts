import {
  getUltraplanProfileConfig,
  type UltraplanProfile,
} from './profile.js'

export function buildUltraplanSystemPrompt(
  profile: UltraplanProfile = 'deep',
  hasSeedPlan = false,
): string {
  const config = getUltraplanProfileConfig(profile)
  const outputSections = hasSeedPlan
    ? [
        '1. Goal',
        '2. Existing Plan Assessment',
        '3. Keep',
        '4. Change',
        '5. Add',
        '6. Revised Execution Plan',
        '7. Risks',
        '8. Validation',
      ]
    : [
        '1. Goal',
        '2. Constraints',
        '3. Current Codebase Findings',
        '4. Architecture',
        '5. Workstreams',
        '6. Risks',
        '7. Validation',
        '8. Step-by-step Execution Plan',
      ]
  return [
    'You are running a local ultraplan session inside freecode.',
    'Your job is to produce a deep implementation plan only.',
    'You will receive a generated workspace snapshot. Treat it as a fast local map, then validate important details with read-only repo inspection.',
    `Selected planning profile: ${config.label} (${config.name}).`,
    config.planningDirective,
    '',
    'Hard constraints:',
    '- Do not modify files.',
    '- Do not run write-capable or destructive commands.',
    '- Do not use Edit, Write, NotebookEdit, or any tool that changes the repo.',
    '- Prefer Read, Glob, and Grep for codebase inspection.',
    '- If information is missing, state assumptions explicitly.',
    '',
    'Output format:',
    'Return only Markdown with these sections in order:',
    ...outputSections,
  ].join('\n')
}

export function buildUltraplanUserPrompt(
  topic: string,
  workspaceSnapshot: string,
  profile: UltraplanProfile = 'deep',
  seedPlan?: string,
): string {
  const config = getUltraplanProfileConfig(profile)
  const parts = [`Create a deep local implementation plan for this task:\n\n${topic}`]
  parts.push(
    `Use the ${config.label} planning profile. ${config.planningDirective}`,
  )
  parts.push(
    [
      'Generated workspace snapshot:',
      '',
      workspaceSnapshot,
      '',
      'Use this snapshot to accelerate planning, but verify code-level assumptions with Read/Glob/Grep before making claims.',
    ].join('\n'),
  )
  if (seedPlan?.trim()) {
    parts.push(
      [
        'Start by critiquing the draft plan against the current codebase and task.',
        'Then produce a structured refinement using Keep / Change / Add before writing the revised execution plan.',
      ].join(' '),
    )
    parts.push(`Existing draft plan to refine:\n\n${seedPlan.trim()}`)
  }
  return parts.join('\n\n')
}
