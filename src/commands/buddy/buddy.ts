import type { LocalCommandCall } from '../../types/command.js'
import { renderCompanionCard } from '../../buddy/card.js'
import {
  ensureCompanion,
  getCompanion,
  getPetReaction,
} from '../../buddy/companion.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

function formatStatsJson(): string {
  const companion = getCompanion()
  if (!companion) return '{}'
  return JSON.stringify(
    {
      name: companion.name,
      personality: companion.personality,
      rarity: companion.rarity,
      species: companion.species,
      eye: companion.eye,
      hat: companion.hat,
      shiny: companion.shiny,
      stats: companion.stats,
    },
    null,
    2,
  )
}

export const call: LocalCommandCall = async (args, context) => {
  const subcommand = (args || '').trim().toLowerCase()

  if (subcommand === 'mute' || subcommand === 'off') {
    saveGlobalConfig(current =>
      current.companionMuted
        ? current
        : { ...current, companionMuted: true },
    )
    context.setAppState(prev =>
      prev.companionReaction === undefined
        ? prev
        : { ...prev, companionReaction: undefined },
    )
    return {
      type: 'text',
      value: 'Buddy muted. The companion stays hatched but stops reacting.',
    }
  }

  if (subcommand === 'unmute' || subcommand === 'on') {
    saveGlobalConfig(current =>
      current.companionMuted === false
        ? current
        : { ...current, companionMuted: false },
    )
    return {
      type: 'text',
      value: 'Buddy unmuted. The companion can react again.',
    }
  }

  const companion = ensureCompanion()

  if (subcommand === 'pet') {
    const reaction = getPetReaction(companion)
    context.setAppState(prev => ({
      ...prev,
      companionPetAt: Date.now(),
      companionReaction: reaction,
    }))
    return {
      type: 'text',
      value: `${companion.name} leans in. "${reaction}"`,
    }
  }

  if (subcommand === 'stats') {
    return { type: 'text', value: formatStatsJson() }
  }

  if (subcommand === 'hide' || subcommand === 'dismiss') {
    context.setAppState(prev => ({
      ...prev,
      companionReaction: undefined,
    }))
    return {
      type: 'text',
      value: `${companion.name} settles down quietly.`,
    }
  }

  const lastReaction = context.getAppState().companionReaction
  const muted = !!getGlobalConfig().companionMuted
  const card = renderCompanionCard(companion, lastReaction)
  const suffix = muted
    ? '\n\nStatus: muted'
    : '\n\nStatus: active'

  return {
    type: 'text',
    value: `${card}${suffix}`,
  }
}

