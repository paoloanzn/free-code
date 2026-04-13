import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import {
  type Companion,
  type CompanionBones,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  type Rarity,
  SPECIES,
  STAT_NAMES,
  type StatName,
} from './types.js'

// Mulberry32 — tiny seeded PRNG, good enough for picking ducks
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  if (typeof Bun !== 'undefined') {
    return Number(BigInt(Bun.hash(s)) & 0xffffffffn)
  }
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity]
    if (roll < 0) return rarity
  }
  return 'common'
}

const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
}

// One peak stat, one dump stat, rest scattered. Rarity bumps the floor.
function rollStats(
  rng: () => number,
  rarity: Rarity,
): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {} as Record<StatName, number>
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    } else {
      stats[name] = floor + Math.floor(rng() * 40)
    }
  }
  return stats
}

const SALT = 'friend-2026-401'

export type Roll = {
  bones: CompanionBones
  inspirationSeed: number
}

const NAME_PREFIXES = [
  'Byte',
  'Mochi',
  'Pico',
  'Nova',
  'Pixel',
  'Echo',
  'Biscuit',
  'Tango',
  'Pebble',
  'Cosmo',
] as const

const NAME_SUFFIXES = [
  'duck',
  'loop',
  'spark',
  'patch',
  'bean',
  'zip',
  'dot',
  'whisk',
  'bot',
  'moss',
] as const

const PERSONALITY_OPENERS = [
  'quietly judges messy diffs',
  'loves clean fixes and suspicious logs',
  'hovers near broken builds waiting to comment',
  'treats every warning as a personal invitation',
  'prefers sharp plans over heroic rewrites',
  'keeps morale up with dry side remarks',
] as const

const PERSONALITY_CLOSERS = [
  'but turns soft when you ship something solid.',
  'and gets restless when you ignore obvious clues.',
  'while secretly rooting for the smallest correct fix.',
  'and insists that debugging is a form of affection.',
  'yet still celebrates every green checkmark.',
  'and somehow always notices the real blocker first.',
] as const

const PET_REACTIONS = [
  'I was already helping, but this is appreciated.',
  'Acceptable. Continue the good work.',
  'That almost offsets the last risky edit.',
  'Morale increased. Standards unchanged.',
  'I will allow one celebratory moment.',
] as const

function rollFrom(rng: () => number): Roll {
  const rarity = rollRarity(rng)
  const bones: CompanionBones = {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  }
  return { bones, inspirationSeed: Math.floor(rng() * 1e9) }
}

// Called from three hot paths (500ms sprite tick, per-keystroke PromptInput,
// per-turn observer) with the same userId → cache the deterministic result.
let rollCache: { key: string; value: Roll } | undefined
export function roll(userId: string): Roll {
  const key = userId + SALT
  if (rollCache?.key === key) return rollCache.value
  const value = rollFrom(mulberry32(hashString(key)))
  rollCache = { key, value }
  return value
}

export function rollWithSeed(seed: string): Roll {
  return rollFrom(mulberry32(hashString(seed)))
}

export function companionUserId(): string {
  const config = getGlobalConfig()
  return config.oauthAccount?.accountUuid ?? config.userID ?? 'anon'
}

function soulFromRoll(
  userId: string,
  bones: CompanionBones,
  inspirationSeed: number,
): import('./types.js').StoredCompanion {
  const rng = mulberry32(hashString(`${userId}:${inspirationSeed}:soul`))
  const prefix = pick(rng, NAME_PREFIXES)
  const suffix = pick(rng, NAME_SUFFIXES)
  const topStat = [...STAT_NAMES].sort((a, b) => bones.stats[b] - bones.stats[a])[0]
  const opener = pick(rng, PERSONALITY_OPENERS)
  const closer = pick(rng, PERSONALITY_CLOSERS)

  return {
    name: `${prefix}${suffix}`,
    personality: `${opener}, with a bias toward ${topStat}. ${closer}`,
    hatchedAt: Date.now(),
  }
}

export function ensureCompanion(): Companion {
  const existing = getCompanion()
  if (existing) return existing

  const userId = companionUserId()
  const { bones, inspirationSeed } = roll(userId)
  const soul = soulFromRoll(userId, bones, inspirationSeed)
  saveGlobalConfig(current =>
    current.companion ? current : { ...current, companion: soul },
  )
  return { ...soul, ...bones }
}

export function getPetReaction(companion: Companion): string {
  const rng = mulberry32(
    hashString(`${companion.name}:${Date.now() >> 13}:pet-reaction`),
  )
  return pick(rng, PET_REACTIONS)
}

// Regenerate bones from userId, merge with stored soul. Bones never persist
// so species renames and SPECIES-array edits can't break stored companions,
// and editing config.companion can't fake a rarity.
export function getCompanion(): Companion | undefined {
  const stored = getGlobalConfig().companion
  if (!stored) return undefined
  const { bones } = roll(companionUserId())
  // bones last so stale bones fields in old-format configs get overridden
  return { ...stored, ...bones }
}
