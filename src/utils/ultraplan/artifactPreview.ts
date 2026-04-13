import { readFile } from 'fs/promises'
import { join } from 'path'

export type UltraplanArtifactKey =
  | 'plan'
  | 'workspaceSnapshot'
  | 'stdout'
  | 'stderr'

export type UltraplanArtifactDescriptor = {
  key: UltraplanArtifactKey
  label: string
  filename: string
  path: string
}

const ARTIFACTS: Array<{
  key: UltraplanArtifactKey
  label: string
  filename: string
}> = [
  {
    key: 'plan',
    label: 'Plan',
    filename: 'plan.md',
  },
  {
    key: 'workspaceSnapshot',
    label: 'Workspace snapshot',
    filename: 'workspace-snapshot.md',
  },
  {
    key: 'stdout',
    label: 'Planner stdout',
    filename: 'stdout.log',
  },
  {
    key: 'stderr',
    label: 'Planner stderr',
    filename: 'stderr.log',
  },
]

export function listUltraplanArtifacts(
  runDir: string,
): UltraplanArtifactDescriptor[] {
  return ARTIFACTS.map(item => ({
    ...item,
    path: join(runDir, item.filename),
  }))
}

export async function readUltraplanArtifact(
  runDir: string,
  key: UltraplanArtifactKey,
): Promise<string | null> {
  const artifact = listUltraplanArtifacts(runDir).find(item => item.key === key)
  if (!artifact) return null
  try {
    return await readFile(artifact.path, 'utf8')
  } catch {
    return null
  }
}

export function formatUltraplanArtifactPreview(
  key: UltraplanArtifactKey,
  content: string | null,
  maxChars = 3200,
): string {
  if (!content || !content.trim()) {
    switch (key) {
      case 'stderr':
        return 'No stderr output captured.'
      case 'stdout':
        return 'No stdout output captured.'
      case 'workspaceSnapshot':
        return 'No workspace snapshot artifact found.'
      case 'plan':
      default:
        return 'No plan artifact found.'
    }
  }

  const normalized = content.trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}\n\n... (truncated)`
}
