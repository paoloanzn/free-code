import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import { openPath } from '../utils/browser.js'
import {
  buildUltraplanArtifactMessage,
  formatUltraplanArtifactPreview,
  listUltraplanArtifacts,
  readUltraplanArtifact,
  type UltraplanArtifactKey,
} from '../utils/ultraplan/artifactPreview.js'

type UltraplanChoice =
  | 'preview-plan'
  | 'preview-workspace'
  | 'preview-stdout'
  | 'preview-stderr'
  | 'insert-current'
  | 'open-run-dir'
  | 'insert'
  | 'save'
  | 'dismiss'

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
  const artifactDescriptors = useMemo(
    () => listUltraplanArtifacts(sessionId),
    [sessionId],
  )
  const [selectedArtifact, setSelectedArtifact] =
    useState<UltraplanArtifactKey>('plan')
  const [artifactContents, setArtifactContents] = useState<
    Partial<Record<UltraplanArtifactKey, string | null>>
  >({
    plan,
  })

  useEffect(() => {
    let disposed = false
    if (selectedArtifact === 'plan') {
      setArtifactContents(prev =>
        prev.plan === plan
          ? prev
          : {
              ...prev,
              plan,
            },
      )
      return
    }

    void readUltraplanArtifact(sessionId, selectedArtifact).then(content => {
      if (disposed) return
      setArtifactContents(prev => ({
        ...prev,
        [selectedArtifact]: content,
      }))
    })

    return () => {
      disposed = true
    }
  }, [plan, selectedArtifact, sessionId])

  const handleChoice = useCallback(
    async (choice: UltraplanChoice) => {
      if (choice === 'preview-plan') {
        setSelectedArtifact('plan')
        return
      }
      if (choice === 'preview-workspace') {
        setSelectedArtifact('workspaceSnapshot')
        return
      }
      if (choice === 'preview-stdout') {
        setSelectedArtifact('stdout')
        return
      }
      if (choice === 'preview-stderr') {
        setSelectedArtifact('stderr')
        return
      }
      if (choice === 'open-run-dir') {
        const ok = await openPath(sessionId)
        setMessages(prev => [
          ...prev,
          createSystemMessage(
            ok
              ? `Opened Ultraplan run directory: ${sessionId}`
              : `Failed to open Ultraplan run directory: ${sessionId}`,
            ok ? 'info' : 'warning',
          ),
        ])
        return
      }
      if (choice === 'insert-current') {
        const injected =
          selectedArtifact === 'plan'
            ? plan
            : buildUltraplanArtifactMessage(
                selectedArtifact,
                sessionId,
                artifactContents[selectedArtifact] ?? currentContent,
              )
        setMessages(prev => [
          ...prev,
          createSystemMessage(
            `Ultraplan finished. Inserting ${currentArtifact?.label ?? 'artifact'} into this session.`,
            'info',
          ),
          createUserMessage({
            content: prepareUserContent({ inputString: injected }),
          }),
        ])
      }

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
                  : choice === 'insert-current'
                    ? `${currentArtifact?.label ?? 'Artifact'} inserted into the session`
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
    [
      artifactContents,
      currentArtifact?.label,
      currentContent,
      plan,
      selectedArtifact,
      sessionId,
      taskId,
      setMessages,
      setAppState,
    ],
  )

  const currentArtifact =
    artifactDescriptors.find(item => item.key === selectedArtifact) ??
    artifactDescriptors[0]
  const currentContent =
    selectedArtifact === 'plan'
      ? artifactContents.plan ?? plan
      : artifactContents[selectedArtifact] ?? null
  const displayPreview = formatUltraplanArtifactPreview(
    selectedArtifact,
    currentContent,
    2400,
  )

  return (
    <Dialog
      title="Ultraplan ready"
      onCancel={() => handleChoice('dismiss')}
    >
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Local artifact: {sessionId}</Text>
        <Text dimColor>
          Viewing: {currentArtifact?.label ?? 'Artifact'}{' '}
          {currentArtifact ? `(${currentArtifact.filename})` : ''}
        </Text>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          height={Math.min(displayPreview.split('\n').length + 2, 20)}
          overflow="hidden"
        >
          <Text>{displayPreview}</Text>
        </Box>
      </Box>
      <Select
        options={[
          {
            value: 'preview-plan' as const,
            label: 'Preview plan',
            description: 'View the generated plan.md artifact',
          },
          {
            value: 'preview-workspace' as const,
            label: 'Preview snapshot',
            description: 'View the workspace-snapshot.md artifact',
          },
          {
            value: 'preview-stdout' as const,
            label: 'Preview stdout',
            description: 'View the planner stdout.log artifact',
          },
          {
            value: 'preview-stderr' as const,
            label: 'Preview stderr',
            description: 'View the planner stderr.log artifact',
          },
          {
            value: 'insert' as const,
            label: 'Insert plan here',
            description: 'Send the local plan back into this session',
          },
          {
            value: 'insert-current' as const,
            label: 'Insert current artifact',
            description: 'Send the currently previewed artifact into this session',
          },
          {
            value: 'open-run-dir' as const,
            label: 'Open run dir',
            description: 'Open the local Ultraplan artifact folder in your OS',
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
