// snipProjection - Snip boundary message detection and projection
// Full implementation for public builds

import type { Message } from '../../types/message.js'

/**
 * Check if a message is a snip boundary marker
 * Detects system messages with compact_boundary subtype
 */
export function isSnipBoundaryMessage(message: Message): boolean {
  return (
    message.type === 'system' &&
    (message as any).subtype === 'compact_boundary'
  )
}

/**
 * Project snipped view of messages
 * Returns the input messages as-is (snip boundaries are preserved)
 * This function is called by getMessagesForDisplay in messages.ts
 */
export function projectSnippedView(messages: Message[]): Message[] {
  // In public builds, we return messages as-is
  // The internal implementation may do additional filtering
  return messages
}

/**
 * No-op projection for public builds
 * @deprecated Use isSnipBoundaryMessage directly
 */
export function createSnipProjection(): null {
  return null
}
