import { chmodSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json() as {
  name: string
  version: string
}

const args = process.argv.slice(2)
const compile = args.includes('--compile')
const dev = args.includes('--dev')

const fullExperimentalFeatures = [
  'AGENT_MEMORY_SNAPSHOT',
  'AGENT_TRIGGERS',
  'AGENT_TRIGGERS_REMOTE',
  'AWAY_SUMMARY',
  'BASH_CLASSIFIER',
  'BRIDGE_MODE',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'CACHED_MICROCOMPACT',
  'CCR_AUTO_CONNECT',
  'CCR_MIRROR',
  'CCR_REMOTE_SETUP',
  'COMPACTION_REMINDERS',
  'CONNECTOR_TEXT',
  'EXTRACT_MEMORIES',
  'HISTORY_PICKER',
  'HOOK_PROMPTS',
  'KAIROS_BRIEF',
  'KAIROS_CHANNELS',
  'LODESTONE',
  'MCP_RICH_OUTPUT',
  'MESSAGE_ACTIONS',
  'NATIVE_CLIPBOARD_IMAGE',
  'NEW_INIT',
  'POWERSHELL_AUTO_MODE',
  'PROMPT_CACHE_BREAK_DETECTION',
  'QUICK_SEARCH',
  'SHOT_STATS',
  'TEAMMEM',
  'TOKEN_BUDGET',
  'TREE_SITTER_BASH',
  'TREE_SITTER_BASH_SHADOW',
  'ULTRAPLAN',
  'ULTRATHINK',
  'UNATTENDED_RETRY',
  'VERIFICATION_AGENT',
  'VOICE_MODE',
] as const

function runCommand(cmd: string[]): string | null {
  const proc = Bun.spawnSync({
    cmd,
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (proc.exitCode !== 0) {
    return null
  }

  return new TextDecoder().decode(proc.stdout).trim() || null
}

function getDevVersion(baseVersion: string): string {
  const timestamp = new Date().toISOString()
  const date = timestamp.slice(0, 10).replaceAll('-', '')
  const time = timestamp.slice(11, 19).replaceAll(':', '')
  const sha = runCommand(['git', 'rev-parse', '--short=8', 'HEAD']) ?? 'unknown'
  return `${baseVersion}-dev.${date}.t${time}.sha${sha}`
}

function getVersionChangelog(): string {
  return (
    runCommand(['git', 'log', '--format=%h %s', '-20']) ??
    'Local development build'
  )
}

const defaultFeatures = ['VOICE_MODE']
const featureSet = new Set(defaultFeatures)
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--feature-set' && args[i + 1]) {
    if (args[i + 1] === 'dev-full') {
      for (const feature of fullExperimentalFeatures) {
        featureSet.add(feature)
      }
    }
    i += 1
    continue
  }
  if (arg === '--feature-set=dev-full') {
    for (const feature of fullExperimentalFeatures) {
      featureSet.add(feature)
    }
    continue
  }
  if (arg === '--feature' && args[i + 1]) {
    featureSet.add(args[i + 1]!)
    i += 1
    continue
  }
  if (arg.startsWith('--feature=')) {
    featureSet.add(arg.slice('--feature='.length))
  }
}
const features = [...featureSet]

const outfile = compile
  ? dev
    ? './dist/cli-dev'
    : './dist/cli'
  : dev
    ? './cli-dev'
    : './cli'
const buildTime = new Date().toISOString()
const version = dev ? getDevVersion(pkg.version) : pkg.version

try {
  mkdirSync(dirname(outfile), { recursive: true })
} catch (e: unknown) {
  if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
    throw e
  }
}

const externals = [
  '@ant/*',
  'audio-capture-napi',
  'image-processor-napi',
  'modifiers-napi',
  'url-handler-napi',
]

const defines = {
  'process.env.USER_TYPE': JSON.stringify('external'),
  'process.env.CLAUDE_CODE_FORCE_FULL_LOGO': JSON.stringify('true'),
  ...(dev
    ? { 'process.env.NODE_ENV': JSON.stringify('development') }
    : {}),
  ...(dev
    ? {
        'process.env.CLAUDE_CODE_EXPERIMENTAL_BUILD': JSON.stringify('true'),
      }
    : {}),
  'process.env.CLAUDE_CODE_VERIFY_PLAN': JSON.stringify('false'),
  'process.env.CCR_FORCE_BUNDLE': JSON.stringify('true'),
  'MACRO.VERSION': JSON.stringify(version),
  'MACRO.BUILD_TIME': JSON.stringify(buildTime),
  'MACRO.PACKAGE_URL': JSON.stringify(pkg.name),
  'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  'MACRO.FEEDBACK_CHANNEL': JSON.stringify('github'),
  'MACRO.ISSUES_EXPLAINER': JSON.stringify(
    'This reconstructed source snapshot does not include Anthropic internal issue routing.',
  ),
  'MACRO.VERSION_CHANGELOG': JSON.stringify(
    dev ? getVersionChangelog() : 'https://github.com/paoloanzn/claude-code',
  ),
} as const

const cmd = [
  'bun',
  'build',
  './src/entrypoints/cli.tsx',
  '--compile',
  '--target',
  'bun',
  '--format',
  'esm',
  '--outfile',
  outfile,
  '--minify',
  '--bytecode',
  '--packages',
  'bundle',
  '--conditions',
  'bun',
]

for (const external of externals) {
  cmd.push('--external', external)
}

for (const feature of features) {
  cmd.push(`--feature=${feature}`)
}

for (const [key, value] of Object.entries(defines)) {
  cmd.push('--define', `${key}=${value}`)
}

const proc = Bun.spawnSync({
  cmd,
  cwd: process.cwd(),
  stdout: 'inherit',
  stderr: 'inherit',
})

if (proc.exitCode !== 0) {
  process.exit(proc.exitCode ?? 1)
}

if (existsSync(outfile)) {
  chmodSync(outfile, 0o755)
}

console.log(`Built ${outfile}`)
