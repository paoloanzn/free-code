import { afterEach, describe, expect, test } from 'bun:test'
import { createOpenAICompatibleFetch } from './openaiCompatible.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('openaiCompatible fetch adapter', () => {
  test('strips Claude-specific attributes before provider request', async () => {
    let capturedBody: Record<string, unknown> | null = null

    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body || '{}')) as Record<
        string,
        unknown
      >
      return new Response(
        JSON.stringify({
          id: 'resp_1',
          model: 'deepseek-chat',
          choices: [
            {
              finish_reason: 'stop',
              message: { content: 'ok' },
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof globalThis.fetch

    const fetchAdapter = createOpenAICompatibleFetch({
      apiKey: 'test-key',
      baseUrl: 'https://provider.example/v1',
    })

    await fetchAdapter('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: false,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        system: [{ type: 'text', text: 'sys' }],
        metadata: { user_id: 'u1' },
        betas: ['x-beta'],
        output_config: { format: { type: 'json_schema', name: 'foo' } },
        thinking: { type: 'enabled', budget_tokens: 32 },
      }),
    })

    expect(capturedBody).not.toBeNull()
    expect(capturedBody?.model).toBe('deepseek-chat')
    expect(capturedBody?.messages).toBeDefined()
    expect(capturedBody?.max_tokens).toBe(64)
    expect(capturedBody?.metadata).toBeUndefined()
    expect(capturedBody?.betas).toBeUndefined()
    expect(capturedBody?.output_config).toBeUndefined()
    expect(capturedBody?.thinking).toBeUndefined()
  })

  test('returns Anthropic-style JSON message payload for non-stream requests', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          id: 'resp_2',
          model: 'deepseek-reasoner',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: 'thinking',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'bash', arguments: '{"cmd":"pwd"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof globalThis.fetch

    const fetchAdapter = createOpenAICompatibleFetch({
      apiKey: 'test-key',
      baseUrl: 'https://provider.example/v1',
    })

    const response = await fetchAdapter('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        stream: false,
        messages: [{ role: 'user', content: 'run pwd' }],
      }),
    })

    const parsed = (await response.json()) as {
      type: string
      role: string
      content: Array<{ type: string; text?: string; name?: string }>
      usage: { input_tokens: number; output_tokens: number }
    }

    expect(parsed.type).toBe('message')
    expect(parsed.role).toBe('assistant')
    expect(parsed.content[0]?.type).toBe('text')
    expect(parsed.content[1]?.type).toBe('tool_use')
    expect(parsed.content[1]?.name).toBe('bash')
    expect(parsed.usage.input_tokens).toBe(20)
    expect(parsed.usage.output_tokens).toBe(10)
  })

  test('clamps max_tokens for providers with smaller limits', async () => {
    let capturedBody: Record<string, unknown> | null = null
    process.env.CLAUDE_CODE_OPENAI_MAX_TOKENS = '8192'

    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body || '{}')) as Record<
        string,
        unknown
      >
      return new Response(
        JSON.stringify({
          id: 'resp_3',
          model: 'deepseek-chat',
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof globalThis.fetch

    const fetchAdapter = createOpenAICompatibleFetch({
      apiKey: 'test-key',
      baseUrl: 'https://provider.example/v1',
    })

    await fetchAdapter('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: false,
        max_tokens: 64000,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    expect(capturedBody?.max_tokens).toBe(8192)

    delete process.env.CLAUDE_CODE_OPENAI_MAX_TOKENS
  })
})
