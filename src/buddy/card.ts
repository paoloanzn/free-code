import { renderSprite } from './sprites.js'
import { RARITY_STARS, STAT_NAMES, type Companion } from './types.js'

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > width && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }

  if (current) lines.push(current)
  return lines
}

// Inspired by the MIT-licensed save-buddy card layout, adapted to freecode's
// built-in companion model and local-only state.
export function renderCompanionCard(
  companion: Companion,
  lastReaction?: string,
): string {
  const width = 38
  const lines: string[] = []
  const stars = RARITY_STARS[companion.rarity] ?? ''
  const rarity = companion.rarity.toUpperCase()
  const species = companion.species.toUpperCase()
  const sprite = renderSprite(companion, 0)

  lines.push(`╭${'─'.repeat(width)}╮`)
  lines.push(`│${' '.repeat(width)}│`)

  const left = `  ${stars} ${rarity}`.trimEnd()
  const right = `${species}  `
  lines.push(
    `│${left}${' '.repeat(Math.max(0, width - left.length - right.length))}${right}│`,
  )
  lines.push(`│${' '.repeat(width)}│`)

  for (const spriteLine of sprite) {
    const padded = `    ${spriteLine.trimEnd()}`
    lines.push(`│${padded.padEnd(width)}│`)
  }

  lines.push(`│${' '.repeat(width)}│`)
  lines.push(`│${`  ${companion.name}`.padEnd(width)}│`)
  lines.push(`│${' '.repeat(width)}│`)

  for (const line of wrap(`"${companion.personality}"`, width - 4)) {
    lines.push(`│${`  ${line}`.padEnd(width)}│`)
  }

  lines.push(`│${' '.repeat(width)}│`)

  for (const statName of STAT_NAMES) {
    const value = Number(companion.stats[statName] || 0)
    const filled = Math.round(value / 10)
    const bar = `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, 10 - filled))}`
    const content = `  ${statName.padEnd(10)} ${bar}${String(value).padStart(3)}`
    lines.push(`│${content.padEnd(width)}│`)
  }

  if (lastReaction) {
    lines.push(`│${' '.repeat(width)}│`)
    lines.push(`│${'  last said'.padEnd(width)}│`)
    for (const line of wrap(`"${lastReaction}"`, width - 6)) {
      lines.push(`│${`  ${line}`.padEnd(width)}│`)
    }
  }

  lines.push(`│${' '.repeat(width)}│`)
  lines.push(`╰${'─'.repeat(width)}╯`)
  return lines.join('\n')
}

