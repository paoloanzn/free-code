// Force snip command - Manually trigger context snipping
// Full implementation for public builds

import type { Command } from '../commands.js'
import { snipCompactIfNeeded } from '../services/compact/snipCompact.js'

const forceSnipCommand: Command = {
  type: 'local',
  name: 'snip',
  description: 'Force snip old context messages',
  async execute(_args, _context, repl) {
    const messages = repl.getMessages()
    const result = await snipCompactIfNeeded(messages, { force: true })

    if (result.tokensFreed === 0) {
      return {
        type: 'text',
        text: 'No messages to snip. Context is already compact.',
      }
    }

    // Update repl messages
    repl.setMessages(result.messages)

    return {
      type: 'text',
      text: `Snipped ${messages.length - result.messages.length} messages, freed ~${result.tokensFreed} tokens.`,
    }
  },
}

export default forceSnipCommand
