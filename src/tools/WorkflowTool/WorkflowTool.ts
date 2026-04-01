import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { z } from 'zod/v4'
import { WORKFLOW_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    workflow: z.string().describe('Name of the workflow to execute'),
    args: z
      .record(z.string())
      .optional()
      .describe('Arguments for the workflow'),
  }),
)

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: 'execute workflow scripts',
  maxResultSizeChars: 100_000,
  get inputSchema() {
    return inputSchema()
  },
  async description() {
    return 'Execute a workflow script'
  },
  async prompt() {
    return 'Execute named workflow scripts with arguments.'
  },
  userFacingName() {
    return WORKFLOW_TOOL_NAME
  },
  isReadOnly() {
    return false
  },
  async checkPermissions(input: any) {
    return { behavior: 'allow' as const, updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(output: any, id: string) {
    return {
      type: 'tool_result' as const,
      tool_use_id: id,
      content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    }
  },
  async call(_input: any) {
    return { data: { message: 'Workflows not available in this build' } }
  },
})
