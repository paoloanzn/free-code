export type CachedMCConfig = {
  enabled: boolean
  triggerThreshold: number
  keepRecent: number
  supportedModels: string[]
  systemPromptSuggestSummaries: boolean
}

const DEFAULT_CACHED_MC_CONFIG: CachedMCConfig = {
  enabled: true,
  triggerThreshold: 12,
  keepRecent: 3,
  supportedModels: [], // Empty array means all models are supported
  systemPromptSuggestSummaries: true,
}

export function getCachedMCConfig(): CachedMCConfig {
  return DEFAULT_CACHED_MC_CONFIG
}
