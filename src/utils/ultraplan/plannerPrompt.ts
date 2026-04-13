export function buildUltraplanSystemPrompt(): string {
  return [
    'You are running a local ultraplan session inside freecode.',
    'Your job is to produce a deep implementation plan only.',
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
    '1. Goal',
    '2. Constraints',
    '3. Current Codebase Findings',
    '4. Architecture',
    '5. Workstreams',
    '6. Risks',
    '7. Validation',
    '8. Step-by-step Execution Plan',
  ].join('\n')
}

export function buildUltraplanUserPrompt(topic: string, seedPlan?: string): string {
  const parts = [
    `Create a deep local implementation plan for this task:\n\n${topic}`,
  ]
  if (seedPlan?.trim()) {
    parts.push(`Existing draft plan to refine:\n\n${seedPlan.trim()}`)
  }
  return parts.join('\n\n')
}
