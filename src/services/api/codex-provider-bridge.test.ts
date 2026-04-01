import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveCodexProviderBridge } from './codex-provider-bridge.js'

const tempDirs: string[] = []

function createCodexHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'free-code-codex-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true })
  }
})

describe('resolveCodexProviderBridge', () => {
  it('resolves a custom Responses provider from config.toml', () => {
    const codexHomeDir = createCodexHome()
    writeFileSync(
      join(codexHomeDir, 'config.toml'),
      `
model_provider = "openai-custom"

[model_providers.openai-custom]
name = "OpenAI Custom"
base_url = "https://example.com/v1"
env_key = "OPENAI_CUSTOM_API_KEY"
wire_api = "responses"

[model_providers.openai-custom.http_headers]
x-static = "static-value"

[model_providers.openai-custom.env_http_headers]
x-workspace = "OPENAI_WORKSPACE_ID"

[model_providers.openai-custom.query_params]
api-version = "2025-04-01"
`,
    )

    const bridge = resolveCodexProviderBridge({
      codexHomeDir,
      env: {
        OPENAI_CUSTOM_API_KEY: 'sk-custom',
        OPENAI_WORKSPACE_ID: 'ws_123',
      },
    })

    expect(bridge).toEqual({
      kind: 'responses',
      providerId: 'openai-custom',
      providerName: 'OpenAI Custom',
      endpoint: 'https://example.com/v1/responses?api-version=2025-04-01',
      apiKey: 'sk-custom',
      headers: {
        'x-static': 'static-value',
        'x-workspace': 'ws_123',
      },
    })
  })

  it('uses auth.json OPENAI_API_KEY for the default openai provider', () => {
    const codexHomeDir = createCodexHome()
    writeFileSync(
      join(codexHomeDir, 'auth.json'),
      JSON.stringify({
        OPENAI_API_KEY: 'sk-from-auth-file',
      }),
    )

    const bridge = resolveCodexProviderBridge({
      codexHomeDir,
      env: {},
    })

    expect(bridge).toEqual({
      kind: 'responses',
      providerId: 'openai',
      providerName: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/responses',
      apiKey: 'sk-from-auth-file',
      headers: {},
    })
  })

  it('falls back to ChatGPT auth.json tokens when no API key is available', () => {
    const codexHomeDir = createCodexHome()
    writeFileSync(
      join(codexHomeDir, 'auth.json'),
      JSON.stringify({
        tokens: {
          access_token: 'chatgpt-token',
        },
      }),
    )

    const bridge = resolveCodexProviderBridge({
      codexHomeDir,
      env: {},
    })

    expect(bridge).toEqual({
      kind: 'chatgpt',
      providerId: 'openai',
      accessToken: 'chatgpt-token',
    })
  })

  it('rejects providers that do not speak the Responses API', () => {
    const codexHomeDir = createCodexHome()
    writeFileSync(
      join(codexHomeDir, 'config.toml'),
      `
model_provider = "legacy"

[model_providers.legacy]
name = "Legacy"
base_url = "https://example.com/v1"
env_key = "OPENAI_API_KEY"
wire_api = "chat"
`,
    )

    expect(() =>
      resolveCodexProviderBridge({
        codexHomeDir,
        env: {
          OPENAI_API_KEY: 'sk-test',
        },
      }),
    ).toThrow('wire_api = "responses"')
  })
})
