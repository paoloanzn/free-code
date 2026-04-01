import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_OPENAI_PROVIDER_ID = 'openai'

type CodexWireApi = 'responses'

type CodexProviderDefinition = {
  name?: string
  base_url?: string
  env_key?: string
  experimental_bearer_token?: string
  wire_api?: CodexWireApi | string
  query_params?: Record<string, string>
  http_headers?: Record<string, string>
  env_http_headers?: Record<string, string>
  requires_openai_auth?: boolean
}

type CodexConfigToml = {
  model_provider?: string
  openai_base_url?: string
  model_providers?: Record<string, CodexProviderDefinition>
}

type CodexAuthFile = {
  OPENAI_API_KEY?: string
  tokens?: {
    access_token?: string
  }
}

export type CodexResponsesBridgeConfig = {
  kind: 'responses'
  providerId: string
  providerName: string
  endpoint: string
  apiKey: string
  headers: Record<string, string>
}

export type CodexChatGptBridgeConfig = {
  kind: 'chatgpt'
  providerId: string
  accessToken: string
}

export type CodexProviderBridgeConfig =
  | CodexResponsesBridgeConfig
  | CodexChatGptBridgeConfig

type ResolveCodexProviderBridgeOptions = {
  codexHomeDir?: string
  codexOAuthAccessToken?: null | string
  env?: NodeJS.ProcessEnv
}

function getCodexHomeDir(env: NodeJS.ProcessEnv): string {
  return (env.CODEX_HOME ?? join(homedir(), '.codex')).normalize('NFC')
}

function getNonEmptyString(value: unknown): null | string {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readCodexConfig(codexHomeDir: string): CodexConfigToml {
  try {
    const raw = readFileSync(join(codexHomeDir, 'config.toml'), 'utf8')
    return (Bun.TOML.parse(raw) as CodexConfigToml) ?? {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

function readCodexAuthFile(codexHomeDir: string): CodexAuthFile {
  try {
    return JSON.parse(
      readFileSync(join(codexHomeDir, 'auth.json'), 'utf8'),
    ) as CodexAuthFile
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function buildResponsesEndpoint(
  baseUrl: string,
  queryParams?: Record<string, string>,
): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/responses`)
  for (const [key, value] of Object.entries(queryParams ?? {})) {
    if (value.trim()) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function resolveProviderHeaders(
  provider: CodexProviderDefinition,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(provider.http_headers ?? {}),
  }

  for (const [headerName, envKey] of Object.entries(provider.env_http_headers ?? {})) {
    const envValue = getNonEmptyString(env[envKey])
    if (envValue) {
      headers[headerName] = envValue
    }
  }

  return headers
}

function createBuiltInProviders(
  openaiBaseUrl: null | string,
): Record<string, CodexProviderDefinition> {
  return {
    [DEFAULT_OPENAI_PROVIDER_ID]: {
      name: 'OpenAI',
      ...(openaiBaseUrl ? { base_url: openaiBaseUrl } : {}),
      wire_api: 'responses',
      requires_openai_auth: true,
    },
  }
}

function resolveApiKey(
  providerId: string,
  provider: CodexProviderDefinition,
  env: NodeJS.ProcessEnv,
  authFile: CodexAuthFile,
): null | string {
  const explicitBearerToken = getNonEmptyString(provider.experimental_bearer_token)
  if (explicitBearerToken) {
    return explicitBearerToken
  }

  const providerEnvKey = getNonEmptyString(provider.env_key)
  if (providerEnvKey) {
    const envApiKey = getNonEmptyString(env[providerEnvKey])
    if (envApiKey) {
      return envApiKey
    }
    if (providerEnvKey === 'OPENAI_API_KEY') {
      return getNonEmptyString(authFile.OPENAI_API_KEY)
    }
    return null
  }

  if (providerId === DEFAULT_OPENAI_PROVIDER_ID || provider.requires_openai_auth) {
    return (
      getNonEmptyString(env.OPENAI_API_KEY) ??
      getNonEmptyString(env.CODEX_API_KEY) ??
      getNonEmptyString(authFile.OPENAI_API_KEY)
    )
  }

  return null
}

export function resolveCodexProviderBridge(
  options: ResolveCodexProviderBridgeOptions = {},
): CodexProviderBridgeConfig | null {
  const env = options.env ?? process.env
  const codexHomeDir = options.codexHomeDir ?? getCodexHomeDir(env)
  const config = readCodexConfig(codexHomeDir)
  const authFile = readCodexAuthFile(codexHomeDir)
  const openaiBaseUrl =
    getNonEmptyString(config.openai_base_url) ??
    getNonEmptyString(env.OPENAI_BASE_URL)
  const providerId =
    getNonEmptyString(env.CODEX_MODEL_PROVIDER) ??
    getNonEmptyString(config.model_provider) ??
    DEFAULT_OPENAI_PROVIDER_ID
  const providers = {
    ...createBuiltInProviders(openaiBaseUrl),
    ...(config.model_providers ?? {}),
  }
  const provider = providers[providerId]

  if (!provider) {
    throw new Error(`Codex model provider "${providerId}" was not found`)
  }

  const wireApi = provider.wire_api ?? 'responses'
  if (wireApi !== 'responses') {
    throw new Error(
      `Codex model provider "${providerId}" must use wire_api = "responses"`,
    )
  }

  const apiKey = resolveApiKey(providerId, provider, env, authFile)
  if (apiKey) {
    const baseUrl = normalizeBaseUrl(
      provider.base_url ?? openaiBaseUrl ?? DEFAULT_OPENAI_BASE_URL,
    )
    return {
      kind: 'responses',
      providerId,
      providerName: provider.name ?? providerId,
      endpoint: buildResponsesEndpoint(baseUrl, provider.query_params),
      apiKey,
      headers: resolveProviderHeaders(provider, env),
    }
  }

  const canUseChatGptBackend =
    providerId === DEFAULT_OPENAI_PROVIDER_ID && !openaiBaseUrl && !provider.base_url
  if (canUseChatGptBackend) {
    const accessToken =
      getNonEmptyString(options.codexOAuthAccessToken) ??
      getNonEmptyString(authFile.tokens?.access_token)
    if (accessToken) {
      return {
        kind: 'chatgpt',
        providerId,
        accessToken,
      }
    }
  }

  return null
}

export function tryResolveCodexProviderBridge(
  options: ResolveCodexProviderBridgeOptions = {},
): CodexProviderBridgeConfig | null {
  try {
    return resolveCodexProviderBridge(options)
  } catch {
    return null
  }
}
