import { describe, expect, test } from 'bun:test'

import {
  getUltraplanProfileConfig,
  parseUltraplanArgs,
} from '../../src/utils/ultraplan/profile.js'

describe('parseUltraplanArgs', () => {
  test('defaults to deep when no profile flag is present', () => {
    expect(parseUltraplanArgs('ship the feature')).toEqual({
      blurb: 'ship the feature',
      profile: 'deep',
    })
  })

  test('supports short profile flags', () => {
    expect(parseUltraplanArgs('--max fix auth flow')).toEqual({
      blurb: 'fix auth flow',
      profile: 'max',
    })
    expect(parseUltraplanArgs('--fast trim scope')).toEqual({
      blurb: 'trim scope',
      profile: 'fast',
    })
  })

  test('supports explicit profile assignment forms', () => {
    expect(parseUltraplanArgs('--profile=max polish release')).toEqual({
      blurb: 'polish release',
      profile: 'max',
    })
    expect(parseUltraplanArgs('--depth fast plan CI')).toEqual({
      blurb: 'plan CI',
      profile: 'fast',
    })
  })
})

describe('getUltraplanProfileConfig', () => {
  test('returns distinct turn budgets by profile', () => {
    expect(getUltraplanProfileConfig('fast').maxTurns).toBe(4)
    expect(getUltraplanProfileConfig('deep').maxTurns).toBe(8)
    expect(getUltraplanProfileConfig('max').maxTurns).toBe(14)
  })
})
