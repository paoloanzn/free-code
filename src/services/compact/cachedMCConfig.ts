export type CachedMCConfig = {
  enabled: boolean
  triggerThreshold: number
  keepRecent: number
  supportedModels: string[]
  systemPromptSuggestSummaries: boolean
}

const DEFAULT_CACHED_MC_CONFIG: CachedMCConfig = {
  enabled: true,
  triggerThreshold: 50,
  keepRecent: 10,
  // Empty array means all models are supported
  // Cache editing is a standard Anthropic API feature that third-party providers implement
  supportedModels: [],
  systemPromptSuggestSummaries: false,
}

export function getCachedMCConfig(): CachedMCConfig {
  return DEFAULT_CACHED_MC_CONFIG
}
