import { readdir, readFile } from 'fs/promises'
import { basename, join, relative } from 'path'

import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'

const TOP_LEVEL_LIMIT = 24
const GIT_STATUS_LIMIT = 20
const GIT_COMMITS_LIMIT = 5
const PLANNING_ARTIFACT_LIMIT = 12
const MAX_ARTIFACT_DEPTH = 3

const MANIFEST_FILES = [
  'package.json',
  'bunfig.toml',
  'tsconfig.json',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'FEATURES.md',
] as const

const PLANNING_FILE_NAMES = new Set([
  'IMPLEMENTATION_PLAN.md',
  'PLAN.md',
  'TODO.md',
  'TASKS.md',
  'SPEC.md',
  'PRD.md',
  'FEATURES.md',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
])

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.bun-build',
  '.tmp-anima',
  '.tmp-save-buddy',
])

export type WorkspaceSnapshotManifest = {
  path: string
  summary: string
}

export type WorkspaceSnapshotGit = {
  isRepo: boolean
  branch?: string
  head?: string
  changedFiles: string[]
  recentCommits: string[]
}

export type WorkspaceSnapshot = {
  cwd: string
  generatedAt: number
  topLevel: {
    directories: string[]
    files: string[]
  }
  manifests: WorkspaceSnapshotManifest[]
  planningArtifacts: string[]
  git?: WorkspaceSnapshotGit
}

export async function collectWorkspaceSnapshot(
  cwd: string,
): Promise<WorkspaceSnapshot> {
  const topLevel = await collectTopLevelEntries(cwd)
  const manifests = await collectManifestSummaries(cwd)
  const planningArtifacts = await collectPlanningArtifacts(cwd)
  const git = await collectGitSnapshot(cwd)

  return {
    cwd,
    generatedAt: Date.now(),
    topLevel,
    manifests,
    planningArtifacts,
    ...(git ? { git } : {}),
  }
}

export function buildWorkspaceSnapshotMarkdown(
  snapshot: WorkspaceSnapshot,
): string {
  const lines = [
    '# Local Workspace Snapshot',
    '',
    `- cwd: ${snapshot.cwd}`,
    `- generated_at: ${new Date(snapshot.generatedAt).toISOString()}`,
  ]

  if (snapshot.git?.isRepo) {
    lines.push(
      `- git_branch: ${snapshot.git.branch || '(detached or unknown)'}`,
      `- git_head: ${snapshot.git.head || '(unknown)'}`,
      `- git_changed_files: ${snapshot.git.changedFiles.length}`,
    )
  } else {
    lines.push('- git: not a repository (or git unavailable)')
  }

  lines.push(
    '',
    '## Top-level directories',
    ...formatBulletList(snapshot.topLevel.directories),
    '',
    '## Top-level files',
    ...formatBulletList(snapshot.topLevel.files),
    '',
    '## Key manifests',
    ...formatBulletList(
      snapshot.manifests.map(item => `${item.path} — ${item.summary}`),
    ),
    '',
    '## Planning artifacts',
    ...formatBulletList(snapshot.planningArtifacts),
  )

  if (snapshot.git?.isRepo) {
    lines.push(
      '',
      '## Git status',
      ...formatBulletList(snapshot.git.changedFiles),
      '',
      '## Recent commits',
      ...formatBulletList(snapshot.git.recentCommits),
    )
  }

  return lines.join('\n')
}

async function collectTopLevelEntries(cwd: string): Promise<{
  directories: string[]
  files: string[]
}> {
  try {
    const entries = await readdir(cwd, { withFileTypes: true })
    const directories = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, TOP_LEVEL_LIMIT)
    const files = entries
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, TOP_LEVEL_LIMIT)
    return { directories, files }
  } catch {
    return { directories: [], files: [] }
  }
}

async function collectManifestSummaries(
  cwd: string,
): Promise<WorkspaceSnapshotManifest[]> {
  const results: WorkspaceSnapshotManifest[] = []
  for (const file of MANIFEST_FILES) {
    const fullPath = join(cwd, file)
    const summary = await summarizeManifest(fullPath)
    if (!summary) continue
    results.push({ path: file, summary })
  }
  return results
}

async function summarizeManifest(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const name = basename(path)
    if (name === 'package.json') {
      const parsed = JSON.parse(raw) as {
        name?: string
        packageManager?: string
        scripts?: Record<string, string>
      }
      const scripts = Object.keys(parsed.scripts ?? {}).slice(0, 6)
      return [
        parsed.name ?? 'unnamed package',
        parsed.packageManager ? `packageManager=${parsed.packageManager}` : null,
        scripts.length ? `scripts=${scripts.join(', ')}` : 'scripts=none',
      ]
        .filter(Boolean)
        .join(' · ')
    }
    if (name === 'tsconfig.json') {
      const parsed = JSON.parse(raw) as {
        compilerOptions?: Record<string, unknown>
      }
      const compilerOptions = parsed.compilerOptions ?? {}
      return [
        compilerOptions.target ? `target=${compilerOptions.target}` : null,
        compilerOptions.module ? `module=${compilerOptions.module}` : null,
        compilerOptions.jsx ? `jsx=${compilerOptions.jsx}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    if (name.endsWith('.md')) {
      const heading = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line.startsWith('#'))
      return heading ? heading.replace(/^#+\s*/, '') : 'Markdown guide present'
    }
    if (name === 'bunfig.toml') {
      return 'Bun workspace config present'
    }
    return `${name} present`
  } catch {
    return null
  }
}

async function collectPlanningArtifacts(cwd: string): Promise<string[]> {
  const found = new Set<string>()
  await walkForPlanningArtifacts(cwd, cwd, 0, found)
  return Array.from(found).sort((a, b) => a.localeCompare(b))
}

async function walkForPlanningArtifacts(
  root: string,
  currentDir: string,
  depth: number,
  found: Set<string>,
): Promise<void> {
  if (depth > MAX_ARTIFACT_DEPTH || found.size >= PLANNING_ARTIFACT_LIMIT) return

  let entries
  try {
    entries = await readdir(currentDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (found.size >= PLANNING_ARTIFACT_LIMIT) return
    const fullPath = join(currentDir, entry.name)
    const relPath = relative(root, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walkForPlanningArtifacts(root, fullPath, depth + 1, found)
      continue
    }

    if (!entry.isFile()) continue
    if (!PLANNING_FILE_NAMES.has(entry.name)) continue
    found.add(relPath)
  }
}

async function collectGitSnapshot(
  cwd: string,
): Promise<WorkspaceSnapshotGit | undefined> {
  const isRepoResult = await execFileNoThrowWithCwd(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    { cwd, timeout: 5000 },
  )
  if (isRepoResult.code !== 0 || isRepoResult.stdout.trim() !== 'true') {
    return undefined
  }

  const [branchResult, headResult, statusResult, commitsResult] =
    await Promise.all([
      execFileNoThrowWithCwd('git', ['branch', '--show-current'], {
        cwd,
        timeout: 5000,
      }),
      execFileNoThrowWithCwd('git', ['rev-parse', '--short', 'HEAD'], {
        cwd,
        timeout: 5000,
      }),
      execFileNoThrowWithCwd(
        'git',
        ['status', '--short', '--untracked-files=normal'],
        {
          cwd,
          timeout: 5000,
        },
      ),
      execFileNoThrowWithCwd('git', ['log', '--oneline', '-n', `${GIT_COMMITS_LIMIT}`], {
        cwd,
        timeout: 5000,
      }),
    ])

  return {
    isRepo: true,
    branch: branchResult.stdout.trim() || undefined,
    head: headResult.stdout.trim() || undefined,
    changedFiles: statusResult.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, GIT_STATUS_LIMIT),
    recentCommits: commitsResult.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, GIT_COMMITS_LIMIT),
  }
}

function formatBulletList(items: string[]): string[] {
  if (!items.length) return ['- (none)']
  return items.map(item => `- ${item}`)
}
