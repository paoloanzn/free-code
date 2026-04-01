import { registerBundledSkill } from '../bundledSkills.js'

/**
 * Dream / memory-consolidation skill for Kairos.
 *
 * When the KAIROS or KAIROS_DREAM feature flag is enabled, this skill is
 * registered and available as `/dream`.
 */
export function registerDreamSkill(): void {
  registerBundledSkill({
    name: 'dream',
    description:
      'Consolidate and reorganize session memories into long-term knowledge',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = `# /dream — Memory Consolidation

Review the current session context and consolidate observations, patterns, and learnings into organized long-term memory entries.

## Steps

1. Review the conversation so far and identify key learnings, patterns, and observations worth preserving.
2. Categorize each item (project convention, user preference, codebase pattern, workflow insight, etc.).
3. Propose memory entries for the user to review.
4. On approval, write the consolidated memories.
`
      if (args) {
        prompt += `\n## Additional context from user\n\n${args}\n`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
