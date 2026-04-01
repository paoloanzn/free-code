import React from 'react'
import { Text } from '../../ink.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

type Props = {
  workflow: LocalWorkflowTaskState
  onDone: (message: string, options?: { display?: string }) => void
  onKill?: () => void
  onSkipAgent?: (agentId: string) => void
  onRetryAgent?: (agentId: string) => void
  onBack: () => void
}

export function WorkflowDetailDialog({ workflow, onBack }: Props): React.ReactNode {
  return <Text>Workflow {workflow.id} detail view is not yet available in this build.</Text>
}
