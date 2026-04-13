import React from 'react'
import { Box, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'

type UltraplanLaunchChoice = 'launch' | 'cancel'

type Props = {
  onChoice: (
    choice: UltraplanLaunchChoice,
    opts?: { disconnectedBridge?: boolean },
  ) => void
}

export function UltraplanLaunchDialog({ onChoice }: Props): React.ReactNode {
  return (
    <Dialog
      title="Launch ultraplan?"
      onCancel={() => onChoice('cancel')}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          This will open a new local terminal and start a planning-only
          freecode session for deep repo analysis.
        </Text>
        <Text dimColor>
          It will write a local plan artifact first. You can then insert that
          plan back into this conversation.
        </Text>
      </Box>
      <Select
        options={[
          {
            value: 'launch' as const,
            label: 'Launch local ultraplan',
          },
          {
            value: 'cancel' as const,
            label: 'Cancel',
          },
        ]}
        onChange={(value: UltraplanLaunchChoice) => onChoice(value)}
      />
    </Dialog>
  )
}
