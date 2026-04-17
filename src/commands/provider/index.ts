import type { Command } from '../../commands.js'
import { getAPIProvider } from '../../utils/model/providers.js'

const providerCommand = {
  type: 'local',
  name: 'provider',
  description: `Switch API provider (currently ${getAPIProvider()})`,
  argumentHint: '[first-party|bedrock|vertex|foundry|openai] | show',
  supportsNonInteractive: true,
  load: () => import('./provider.js'),
} satisfies Command

export default providerCommand
