import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  buildWorkspaceSnapshotMarkdown,
  collectWorkspaceSnapshot,
} from '../../src/utils/ultraplan/workspaceSnapshot.js'

const tempRoots: string[] = []

afterAll(async () => {
  await Promise.all(
    tempRoots.map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'freecode-ultraplan-'))
  tempRoots.push(dir)
  return dir
}

async function run(
  cwd: string,
  ...cmd: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

describe('collectWorkspaceSnapshot', () => {
  test('captures git, manifests, top-level entries, and planning clues', async () => {
    const cwd = await makeTempWorkspace()
    await mkdir(join(cwd, 'src'))
    await mkdir(join(cwd, 'docs'))
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify(
        {
          name: 'snapshot-fixture',
          packageManager: 'bun@1.3.11',
          scripts: { build: 'bun run build.ts', test: 'bun test' },
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeFile(join(cwd, 'bunfig.toml'), '[install]\ncache = true\n', 'utf8')
    await writeFile(join(cwd, 'README.md'), '# Fixture\n', 'utf8')
    await writeFile(
      join(cwd, 'docs', 'IMPLEMENTATION_PLAN.md'),
      '# Plan\n',
      'utf8',
    )
    await writeFile(join(cwd, 'src', 'index.ts'), 'export const value = 1\n', 'utf8')

    expect((await run(cwd, 'git', 'init')).exitCode).toBe(0)
    expect(
      (await run(cwd, 'git', 'config', 'user.email', 'fixture@example.com'))
        .exitCode,
    ).toBe(0)
    expect(
      (await run(cwd, 'git', 'config', 'user.name', 'Fixture User')).exitCode,
    ).toBe(0)
    expect((await run(cwd, 'git', 'add', '.')).exitCode).toBe(0)
    expect((await run(cwd, 'git', 'commit', '-m', 'initial snapshot')).exitCode).toBe(
      0,
    )

    await writeFile(join(cwd, 'README.md'), '# Fixture\n\nchanged\n', 'utf8')

    const snapshot = await collectWorkspaceSnapshot(cwd)
    const markdown = buildWorkspaceSnapshotMarkdown(snapshot)

    expect(snapshot.cwd).toBe(cwd)
    expect(snapshot.topLevel.directories).toContain('docs')
    expect(snapshot.topLevel.directories).toContain('src')
    expect(snapshot.topLevel.files).toContain('package.json')
    expect(snapshot.manifests.some(item => item.path === 'package.json')).toBeTrue()
    expect(snapshot.planningArtifacts).toContain('docs/IMPLEMENTATION_PLAN.md')
    expect(snapshot.git?.isRepo).toBeTrue()
    expect(snapshot.git?.changedFiles.join('\n')).toContain('README.md')
    expect(snapshot.git?.recentCommits[0]).toContain('initial snapshot')
    expect(markdown).toContain('snapshot-fixture')
    expect(markdown).toContain('docs/IMPLEMENTATION_PLAN.md')
    expect(markdown).toContain('README.md')
  })
})
