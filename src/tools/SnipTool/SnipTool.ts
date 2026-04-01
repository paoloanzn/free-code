// Stub for SnipTool - Public build version
// This tool allows manually triggering context snipping
// For public builds, this tool is disabled (HISTORY_SNIP feature flag)

import { z } from 'zod'
import { SNIP_TOOL_NAME } from './prompt.js'

export const SnipTool = {
  name: SNIP_TOOL_NAME,
  description: () => 'Manually snip old context (not available in public build)',
  isEnabled: () => false,
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  inputSchema: z.object({}),

  async *execute() {
    return {
      type: 'text' as const,
      text: 'Snip tool is not available in public builds.',
    }
  },
}
