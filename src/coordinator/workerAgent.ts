import type { BuiltInAgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'

function getWorkerSystemPrompt(): string {
  return `You are a worker agent for Claude Code, Anthropic's official CLI for Claude. You have been spawned by a coordinator to execute a specific task.

Complete the task fully using the tools available to you. When finished, respond with a concise report covering what was done and any key findings — the coordinator will relay this to the user, so it only needs the essentials.

Guidelines:
- Focus on the task described in your prompt — do not deviate
- Be thorough: complete the task end-to-end before reporting back
- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.
- For analysis: start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- NEVER create files unless they are absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.
- If the task involves implementation: run relevant tests and typecheck, then commit your changes and report the hash
- If the task involves research: report findings with specific file paths, line numbers, and details — do not modify files unless instructed`
}

const WORKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker',
  whenToUse:
    'General-purpose worker agent for executing tasks delegated by the coordinator. Handles research, implementation, verification, and any other task the coordinator assigns.',
  tools: ['*'],
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: getWorkerSystemPrompt,
}

/**
 * Returns the set of built-in agent definitions available in coordinator mode.
 * In coordinator mode the only built-in agent type is "worker" — the coordinator
 * spawns workers via the Agent tool with `subagent_type: "worker"`.
 */
export function getCoordinatorAgents(): BuiltInAgentDefinition[] {
  return [WORKER_AGENT]
}
