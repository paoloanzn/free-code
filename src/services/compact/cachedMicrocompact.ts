import {
  getCachedMCConfig,
  type CachedMCConfig,
} from './cachedMCConfig.js'

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  pinnedEdits: PinnedCacheEdits[]
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
}

export function createCachedMCState(): CachedMCState {
  return {
    pinnedEdits: [],
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
  }
}

export function isCachedMicrocompactEnabled(): boolean {
  return getCachedMCConfig().enabled
}

export function isModelSupportedForCacheEditing(model: string): boolean {
  const patterns = getCachedMCConfig().supportedModels
  // Empty array means all models are supported
  return patterns.length === 0 || patterns.some(pattern =>
    model.includes(pattern),
  )
}

export { getCachedMCConfig }
export type { CachedMCConfig }

export function registerToolResult(
  state: CachedMCState,
  toolUseId: string,
): void {
  if (state.registeredTools.has(toolUseId)) {
    return
  }

  state.registeredTools.add(toolUseId)
  state.toolOrder.push(toolUseId)
}

export function registerToolMessage(
  _state: CachedMCState,
  _toolUseIds: string[],
): void {}

export function getToolResultsToDelete(state: CachedMCState): string[] {
  const config = getCachedMCConfig()
  const activeRefs = state.toolOrder.filter(id => !state.deletedRefs.has(id))

  if (!config.enabled || activeRefs.length < config.triggerThreshold) {
    return []
  }

  return activeRefs.slice(0, Math.max(0, activeRefs.length - config.keepRecent))
}

export function createCacheEditsBlock(
  state: CachedMCState,
  toolUseIds: string[],
): CacheEditsBlock | null {
  const edits = toolUseIds
    .filter(id => !state.deletedRefs.has(id))
    .map(id => {
      state.deletedRefs.add(id)
      return {
        type: 'delete' as const,
        cache_reference: id,
      }
    })

  if (edits.length === 0) {
    return null
  }

  return {
    type: 'cache_edits',
    edits,
  }
}

export function markToolsSentToAPI(_state: CachedMCState): void {}

export function resetCachedMCState(state: CachedMCState): void {
  state.pinnedEdits.length = 0
  state.registeredTools.clear()
  state.toolOrder.length = 0
  state.deletedRefs.clear()
}
