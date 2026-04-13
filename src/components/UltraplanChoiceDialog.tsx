import React, { useCallback } from 'react'
import { Box, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import type { AppState } from '../state/AppStateStore.js'
import { useSetAppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'
import type { LocalWorkflowTaskState } from '../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { FileStateCache } from '../utils/fileStateCache.js'
import {
  createUserMessage,
  createSystemMessage,
  prepareUserContent,
} from '../utils/messages.js'
import { updateTaskState } from '../utils/task/framework.js'

type UltraplanChoice = 'insert' | 'save' | 'dismiss'

type Props = {
  plan: string
  sessionId: string
  taskId: string
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  readFileState: FileStateCache
  getAppState: () => AppState
  setConversationId: (id: string) => void
}

export function UltraplanChoiceDialog({
  plan,
  sessionId,
  taskId,
  setMessages,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()

  const handleChoice = useCallback(
    (choice: UltraplanChoice) => {
      if (choice === 'insert') {
        setMessages(prev => [
          ...prev,
          createSystemMessage(
            'Ultraplan finished. Inserting the local plan into this session.',
            'info',
          ),
          createUserMessage({
            content: prepareUserContent({ inputString: plan }),
          }),
        ])
      }

      updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t =>
        t.status === 'completed'
          ? t
          : {
              ...t,
              status: 'completed',
              summary:
                choice === 'insert'
                  ? 'Plan inserted into the session'
                  : choice === 'save'
                    ? `Plan kept on disk: ${sessionId}`
                    : 'Plan dismissed',
              endTime: Date.now(),
            },
      )

      setAppState(prev => ({
        ...prev,
        ultraplanPendingChoice: undefined,
        ultraplanSessionUrl: undefined,
      }))
    },
    [plan, sessionId, taskId, setMessages, setAppState],
  )

  const displayPlan =
    plan.length > 2000 ? plan.slice(0, 2000) + '\n\n... (truncated)' : plan

  return (
    <Dialog
      title="Ultraplan ready"
      onCancel={() => handleChoice('dismiss')}
    >
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Local artifact: {sessionId}</Text>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          height={Math.min(displayPlan.split('\n').length + 2, 20)}
          overflow="hidden"
        >
          <Text>{displayPlan}</Text>
        </Box>
      </Box>
      <Select
        options={[
          {
            value: 'insert' as const,
            label: 'Insert plan here',
            description: 'Send the local plan back into this session',
          },
          {
            value: 'save' as const,
            label: 'Save only',
            description: 'Keep the artifact on disk without injecting it',
          },
          {
            value: 'dismiss' as const,
            label: 'Dismiss',
            description: 'Close this dialog and discard the result here',
          },
        ]}
        onChange={(value: UltraplanChoice) => handleChoice(value)}
      />
    </Dialog>
  )
}
