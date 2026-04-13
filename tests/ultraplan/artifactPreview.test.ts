import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  formatUltraplanArtifactPreview,
  listUltraplanArtifacts,
  readUltraplanArtifact,
} from '../../src/utils/ultraplan/artifactPreview.js'

const tempRoots: string[] = []

afterAll(async () => {
  await Promise.all(
    tempRoots.map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeRunDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'freecode-ultraplan-artifacts-'))
  tempRoots.push(dir)
  return dir
}

describe('listUltraplanArtifacts', () => {
  test('returns the expected ordered artifact descriptors', () => {
    const artifacts = listUltraplanArtifacts('C:/runs/demo')
    expect(artifacts.map(item => item.key)).toEqual([
      'plan',
      'workspaceSnapshot',
      'stdout',
      'stderr',
    ])
    expect(artifacts[0]?.path).toContain('plan.md')
    expect(artifacts[1]?.label).toContain('Workspace snapshot')
  })
})

describe('readUltraplanArtifact', () => {
  test('reads artifact content and falls back cleanly when missing', async () => {
    const runDir = await makeRunDir()
    await writeFile(join(runDir, 'plan.md'), '# Plan\n', 'utf8')

    expect(await readUltraplanArtifact(runDir, 'plan')).toBe('# Plan\n')
    expect(await readUltraplanArtifact(runDir, 'stderr')).toBeNull()
  })
})

describe('formatUltraplanArtifactPreview', () => {
  test('returns readable empty-state text and truncates long artifacts', () => {
    expect(formatUltraplanArtifactPreview('stderr', null)).toContain('No stderr')
    const long = 'a'.repeat(4100)
    const preview = formatUltraplanArtifactPreview('plan', long, 120)
    expect(preview.length).toBeLessThanOrEqual(150)
    expect(preview).toContain('(truncated)')
  })
})
