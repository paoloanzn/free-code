// SnipBoundaryMessage - Display snip boundary in message list
// Full implementation for public builds

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { Message } from '../../types/message.js'

interface SnipBoundaryMessageProps {
  message: Message
}

export const SnipBoundaryMessage: React.FC<SnipBoundaryMessageProps> = ({
  message,
}) => {
  const metadata = (message as any).compactMetadata
  const messagesSummarized = metadata?.messagesSummarized

  return (
    <Box paddingY={1}>
      <Text color="yellow" dimColor>
        {messagesSummarized
          ? `··· ${messagesSummarized} earlier messages summarized ···`
          : '··· Earlier messages summarized ···'}
      </Text>
    </Box>
  )
}

export default SnipBoundaryMessage
