import { registerBundledSkill } from '../bundledSkills.js'

/**
 * Skill generator skill.
 *
 * When the RUN_SKILL_GENERATOR feature flag is enabled, this skill is
 * registered and available as `/run-skill-generator`.
 */
export function registerRunSkillGeneratorSkill(): void {
  registerBundledSkill({
    name: 'run-skill-generator',
    description:
      'Generate a new skill definition from a description or template',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = `# /run-skill-generator — Skill Generator

Create a new skill definition file based on the user's description.

## Steps

1. Gather the skill requirements from the user (name, description, what it should do).
2. Generate a well-structured skill markdown file with proper frontmatter.
3. Write the file to the appropriate skills directory.
4. Verify the skill is loadable by checking its frontmatter and prompt structure.
`
      if (args) {
        prompt += `\n## User-provided context\n\n${args}\n`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
