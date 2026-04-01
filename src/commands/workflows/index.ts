import type { Command } from '../../commands.js'

const command = {
  type: 'local-jsx' as const,
  name: 'workflows',
  description: 'Manage workflow scripts',
  isEnabled: () => true,
  immediate: true,
  load: () =>
    Promise.resolve({
      async call(onDone: any, _context: any, _args: string) {
        onDone('Workflow management is not yet available in this build.')
        return null
      },
    }),
} satisfies Command

export default command
