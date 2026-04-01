import { registerBundledSkill } from '../bundledSkills.js'

/**
 * Hunter / review-artifact skill.
 *
 * When the REVIEW_ARTIFACT feature flag is enabled, this skill is
 * registered and available as `/hunter`.
 */
export function registerHunterSkill(): void {
  registerBundledSkill({
    name: 'hunter',
    description: 'Review and analyze build or CI artifacts for issues',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = `# /hunter — Artifact Review

Analyze build artifacts, CI outputs, or other generated files to identify issues, failures, and areas for improvement.

## Steps

1. Identify the artifact(s) the user wants reviewed (build logs, test results, CI output, etc.).
2. Read and analyze the artifact contents.
3. Summarize findings: errors, warnings, flaky tests, performance regressions.
4. Propose actionable fixes or next steps.
`
      if (args) {
        prompt += `\n## User-provided context\n\n${args}\n`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
