export type UltraplanProfile = 'fast' | 'deep' | 'max'

export type UltraplanProfileConfig = {
  name: UltraplanProfile
  label: string
  maxTurns: number
  planningDirective: string
}

const PROFILE_CONFIG: Record<UltraplanProfile, UltraplanProfileConfig> = {
  fast: {
    name: 'fast',
    label: 'Fast',
    maxTurns: 4,
    planningDirective:
      'Bias for speed. Collapse low-value branches, make explicit assumptions, and return the most actionable plan quickly.',
  },
  deep: {
    name: 'deep',
    label: 'Deep',
    maxTurns: 8,
    planningDirective:
      'Balance thoroughness and speed. Inspect enough code to ground architecture, then produce a detailed but practical execution plan.',
  },
  max: {
    name: 'max',
    label: 'Max',
    maxTurns: 14,
    planningDirective:
      'Go broad and deep. Surface architecture seams, migration concerns, validation matrix, rollback risk, and ordering dependencies before finalizing the plan.',
  },
}

export function getUltraplanProfileConfig(
  profile: UltraplanProfile,
): UltraplanProfileConfig {
  return PROFILE_CONFIG[profile]
}

export function parseUltraplanArgs(input: string): {
  blurb: string
  profile: UltraplanProfile
} {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) {
    return { blurb: '', profile: 'deep' }
  }

  let profile: UltraplanProfile = 'deep'
  const remaining: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const direct = parseProfileToken(token)
    if (direct) {
      profile = direct
      continue
    }
    if (token === '--profile' || token === '--depth') {
      const next = tokens[i + 1]
      const parsed = next ? parseProfileName(next) : undefined
      if (parsed) {
        profile = parsed
        i += 1
        continue
      }
    }
    remaining.push(token)
  }

  return {
    blurb: remaining.join(' ').trim(),
    profile,
  }
}

function parseProfileToken(token: string): UltraplanProfile | undefined {
  switch (token) {
    case '--fast':
      return 'fast'
    case '--deep':
      return 'deep'
    case '--max':
      return 'max'
    default:
      if (token.startsWith('--profile=')) {
        return parseProfileName(token.slice('--profile='.length))
      }
      if (token.startsWith('--depth=')) {
        return parseProfileName(token.slice('--depth='.length))
      }
      return undefined
  }
}

function parseProfileName(value: string): UltraplanProfile | undefined {
  switch (value.toLowerCase()) {
    case 'fast':
    case 'deep':
    case 'max':
      return value.toLowerCase() as UltraplanProfile
    default:
      return undefined
  }
}
