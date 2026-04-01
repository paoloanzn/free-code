import type { Task, TaskStateBase, SetAppState } from '../../Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
}

export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',
  async kill(_taskId: string, _setAppState: SetAppState) {
    // Stub: no-op
  },
}

export function killWorkflowTask(
  _taskId: string,
  _setAppState: SetAppState,
): void {
  // Stub: no-op
}

export function skipWorkflowAgent(
  _taskId: string,
  _agentId: string,
  _setAppState: SetAppState,
): void {
  // Stub: no-op
}

export function retryWorkflowAgent(
  _taskId: string,
  _agentId: string,
  _setAppState: SetAppState,
): void {
  // Stub: no-op
}
