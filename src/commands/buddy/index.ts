import type { Command } from '../../commands.js'

const buddy = {
  type: 'local',
  name: 'buddy',
  description: 'Show your companion, pet it, or toggle reactions',
  argumentHint: '[show|pet|stats|mute|unmute]',
  supportsNonInteractive: true,
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy

