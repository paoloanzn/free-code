/**
 * vLLM Fetch Adapter
 *
 * Intercepts fetch calls from the Anthropic SDK and routes them to
 * a local vLLM (or any OpenAI-compatible) backend, translating between
 * Anthropic Messages API format and OpenAI Chat Completions API format.
 *
 * Supports:
 * - Text messages (user/assistant)
 * - System prompts → system message
 * - Tool definitions (Anthropic input_schema → OpenAI parameters)
 * - Tool use (tool_use → tool_calls, tool_result → tool message)
 * - Streaming events translation (OpenAI SSE → Anthropic SSE)
 *
 * Environment variables:
 *   CLAUDE_CODE_USE_VLLM=1       Enable this provider
 *   VLLM_API_KEY                 API key (or OPENAI_API_KEY)
 *   VLLM_BASE_URL                Base URL (default http://localhost:8000)
 *   ANTHROPIC_MODEL              Model name (passed through directly)
 */

// ── Types ───────────────────────────────────────────────────────────

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  [key: string]: unknown
}

interface AnthropicMessage {
  role: string
  content: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

// ── Tool translation: Anthropic → OpenAI ─────────────────────────────

function translateTools(anthropicTools: AnthropicTool[]): Array<Record<string, unknown>> {
  return anthropicTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }))
}

// ── Message translation: Anthropic → OpenAI ──────────────────────────

/**
 * Translates Anthropic messages to OpenAI Chat Completions format.
 *
 * Key differences from Codex adapter:
 * - Codex uses OpenAI Responses API (tool_result → function_call_output, etc.)
 * - vLLM uses standard Chat Completions API (tool_result → role:"tool" message)
 */
function translateMessages(
  anthropicMessages: AnthropicMessage[],
): Array<Record<string, unknown>> {
  const openaiMessages: Array<Record<string, unknown>> = []
  // Counter for generating fallback tool call IDs
  let toolCallCounter = 0

  for (const msg of anthropicMessages) {
    if (typeof msg.content === 'string') {
      openaiMessages.push({ role: msg.role, content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) continue

    if (msg.role === 'user') {
      const userContent: Array<Record<string, unknown>> = []
      const toolResults: Array<Record<string, unknown>> = []

      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const callId = block.tool_use_id || `call_${toolCallCounter++}`
          let outputText = ''
          if (typeof block.content === 'string') {
            outputText = block.content
          } else if (Array.isArray(block.content)) {
            outputText = block.content
              .map(c => {
                if (c.type === 'text') return c.text
                if (c.type === 'image') return '[Image data attached]'
                return ''
              })
              .filter(Boolean)
              .join('\n')
          }
          toolResults.push({
            role: 'tool',
            tool_call_id: callId,
            content: outputText || '',
          })
        } else if (block.type === 'text' && typeof block.text === 'string') {
          userContent.push({ type: 'text', text: block.text })
        } else if (
          block.type === 'image' &&
          typeof block.source === 'object' &&
          block.source !== null &&
          (block.source as any).type === 'base64'
        ) {
          userContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${(block.source as any).media_type};base64,${(block.source as any).data}`,
            },
          })
        }
      }

      // Tool results are separate messages with role:"tool"
      // They must appear before any regular user text content
      for (const tr of toolResults) {
        openaiMessages.push(tr)
      }

      if (userContent.length > 0) {
        // Simplify to string if only one text block
        if (userContent.length === 1 && userContent[0].type === 'text') {
          openaiMessages.push({ role: 'user', content: userContent[0].text })
        } else {
          openaiMessages.push({ role: 'user', content: userContent })
        }
      }
    } else if (msg.role === 'assistant') {
      const textBlocks: string[] = []
      const toolCalls: Array<{
        id: string
        type: string
        function: { name: string; arguments: string }
      }> = []

      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textBlocks.push(block.text)
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id || `call_${toolCallCounter++}`,
            type: 'function',
            function: {
              name: block.name || '',
              arguments: JSON.stringify(block.input || {}),
            },
          })
        }
      }

      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: textBlocks.length > 0 ? textBlocks.join('\n') : null,
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls
      }
      openaiMessages.push(assistantMsg)
    }
  }

  return openaiMessages
}

// ── Full request translation ────────────────────────────────────────

function translateToVLLMBody(anthropicBody: Record<string, unknown>): {
  vllmBody: Record<string, unknown>
  vllmModel: string
} {
  const anthropicMessages = (anthropicBody.messages || []) as AnthropicMessage[]
  const systemPrompt = anthropicBody.system as
    | string
    | Array<{ type: string; text?: string; cache_control?: unknown }>
    | undefined
  const claudeModel = (anthropicBody.model as string) || 'default'
  const anthropicTools = (anthropicBody.tools || []) as AnthropicTool[]

  // Build messages array, prepending system prompt as first message
  const messages: Array<Record<string, unknown>> = []

  if (systemPrompt) {
    let systemText = ''
    if (typeof systemPrompt === 'string') {
      systemText = systemPrompt
    } else if (Array.isArray(systemPrompt)) {
      systemText = systemPrompt
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text!)
        .join('\n')
    }
    if (systemText) {
      messages.push({ role: 'system', content: systemText })
    }
  }

  messages.push(...translateMessages(anthropicMessages))

  const vllmBody: Record<string, unknown> = {
    model: claudeModel,
    messages,
    stream: true,
  }

  if (anthropicTools.length > 0) {
    vllmBody.tools = translateTools(anthropicTools)
  }

  return { vllmBody, vllmModel: claudeModel }
}

// ── Response translation: OpenAI SSE → Anthropic SSE ─────────────────

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

/**
 * Translates OpenAI Chat Completions streaming response to Anthropic SSE format.
 *
 * OpenAI SSE events use:  data: {"choices":[{"delta":{"content":"..."}}]}
 * Anthropic SSE events use:  event: content_block_start\ndata: {"type":"content_block_start",...}
 *
 * Key OpenAI SSE events to handle:
 * - data: {"choices":[{"delta":{"content":"..."}}]}                    → text delta
 * - data: {"choices":[{"delta":{"tool_calls":[...]}}]}                → tool call delta
 * - data: {"choices":[{"finish_reason":"tool_calls"}]}                → stop reason
 * - data: {"usage":{"prompt_tokens":...,"completion_tokens":...}}     → usage
 * - data: [DONE]                                                      → stop
 */
async function translateVLLMStreamToAnthropic(
  vllmResponse: Response,
  vllmModel: string,
): Promise<Response> {
  const messageId = `msg_vllm_${Date.now()}`

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let contentBlockIndex = 0
      let outputTokens = 0
      let inputTokens = 0

      // Emit Anthropic message_start
      controller.enqueue(
        encoder.encode(
          formatSSE(
            'message_start',
            JSON.stringify({
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model: vllmModel,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }),
          ),
        ),
      )

      // Emit ping
      controller.enqueue(
        encoder.encode(
          formatSSE('ping', JSON.stringify({ type: 'ping' })),
        ),
      )

      // State tracking
      let currentTextBlockStarted = false
      let currentToolCallIndex = -1 // Index in the OpenAI tool_calls array
      let currentToolCallId = ''
      let currentToolCallName = ''
      let currentToolCallArgs = ''
      let hadToolCalls = false
      let stopReason: string | null = null

      try {
        const reader = vllmResponse.body?.getReader()
        if (!reader) {
          emitTextBlock(controller, encoder, contentBlockIndex, 'Error: No response body')
          finishStream(controller, encoder, outputTokens, inputTokens, false)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            // Skip non-data lines (comments, empty, event: lines)
            if (!trimmed.startsWith('data: ')) continue

            const dataStr = trimmed.slice(6) // Remove "data: " prefix

            if (dataStr === '[DONE]') break

            let chunk: Record<string, unknown>
            try {
              chunk = JSON.parse(dataStr)
            } catch {
              continue
            }

            const choices = chunk.choices as Array<Record<string, unknown>> | undefined
            if (!choices || choices.length === 0) {
              // Check for usage-only chunks
              if (chunk.usage) {
                const usage = chunk.usage as Record<string, number>
                inputTokens = usage.prompt_tokens || inputTokens
                outputTokens = usage.completion_tokens || outputTokens
              }
              continue
            }

            const delta = choices[0].delta as Record<string, unknown> | undefined
            if (!delta) continue

            // ── Text content delta ──────────────────────────────
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              if (!currentTextBlockStarted) {
                controller.enqueue(
                  encoder.encode(
                    formatSSE(
                      'content_block_start',
                      JSON.stringify({
                        type: 'content_block_start',
                        index: contentBlockIndex,
                        content_block: { type: 'text', text: '' },
                      }),
                    ),
                  ),
                )
                currentTextBlockStarted = true
              }
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_delta',
                    JSON.stringify({
                      type: 'content_block_delta',
                      index: contentBlockIndex,
                      delta: { type: 'text_delta', text: delta.content },
                    }),
                  ),
                ),
              )
              outputTokens++
            }

            // ── Tool calls delta ────────────────────────────────
            const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
            if (toolCalls && toolCalls.length > 0) {
              for (const tc of toolCalls) {
                const tcIndex = tc.index as number
                const tcId = tc.id as string | undefined

                // If this is a new tool call (has an id), start a new block
                if (tcId && tcIndex !== currentToolCallIndex) {
                  // Close current text block if open
                  if (currentTextBlockStarted) {
                    controller.enqueue(
                      encoder.encode(
                        formatSSE(
                          'content_block_stop',
                          JSON.stringify({
                            type: 'content_block_stop',
                            index: contentBlockIndex,
                          }),
                        ),
                      ),
                    )
                    contentBlockIndex++
                    currentTextBlockStarted = false
                  }

                  // Close previous tool call block if open
                  if (currentToolCallIndex >= 0) {
                    controller.enqueue(
                      encoder.encode(
                        formatSSE(
                          'content_block_stop',
                          JSON.stringify({
                            type: 'content_block_stop',
                            index: contentBlockIndex,
                          }),
                        ),
                      ),
                    )
                    contentBlockIndex++
                  }

                  currentToolCallIndex = tcIndex
                  currentToolCallId = tcId || `toolu_${Date.now()}`
                  currentToolCallName = ''
                  currentToolCallArgs = ''
                  hadToolCalls = true

                  // Extract function name if present
                  const func = tc.function as Record<string, unknown> | undefined
                  if (func?.name) currentToolCallName = func.name as string

                  controller.enqueue(
                    encoder.encode(
                      formatSSE(
                        'content_block_start',
                        JSON.stringify({
                          type: 'content_block_start',
                          index: contentBlockIndex,
                          content_block: {
                            type: 'tool_use',
                            id: currentToolCallId,
                            name: currentToolCallName,
                            input: {},
                          },
                        }),
                      ),
                    ),
                  )
                }

                // Append function name if available on this delta
                const func = tc.function as Record<string, unknown> | undefined
                if (func?.name) {
                  currentToolCallName = func.name as string
                }

                // Append arguments delta
                if (func?.arguments && typeof func.arguments === 'string') {
                  currentToolCallArgs += func.arguments
                  controller.enqueue(
                    encoder.encode(
                      formatSSE(
                        'content_block_delta',
                        JSON.stringify({
                          type: 'content_block_delta',
                          index: contentBlockIndex,
                          delta: {
                            type: 'input_json_delta',
                            partial_json: func.arguments,
                          },
                        }),
                      ),
                    ),
                  )
                }
              }
            }

            // ── Finish reason ───────────────────────────────────
            if (choices[0].finish_reason) {
              stopReason = choices[0].finish_reason as string
            }
          }
        }
      } catch (err) {
        // Emit error as text content
        if (!currentTextBlockStarted) {
          controller.enqueue(
            encoder.encode(
              formatSSE(
                'content_block_start',
                JSON.stringify({
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'text', text: '' },
                }),
              ),
            ),
          )
          currentTextBlockStarted = true
        }
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_delta',
              JSON.stringify({
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: { type: 'text_delta', text: `\n\n[Error: ${String(err)}]` },
              }),
            ),
          ),
        )
      }

      // Close any remaining open blocks
      if (currentTextBlockStarted) {
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_stop',
              JSON.stringify({
                type: 'content_block_stop',
                index: contentBlockIndex,
              }),
            ),
          ),
        )
      }
      if (currentToolCallIndex >= 0) {
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_stop',
              JSON.stringify({
                type: 'content_block_stop',
                index: contentBlockIndex,
              }),
            ),
          ),
        )
      }

      finishStream(controller, encoder, outputTokens, inputTokens, hadToolCalls)
    },
  })

  function emitTextBlock(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    index: number,
    text: string,
  ) {
    controller.enqueue(
      encoder.encode(
        formatSSE(
          'content_block_start',
          JSON.stringify({
            type: 'content_block_start',
            index,
            content_block: { type: 'text', text: '' },
          }),
        ),
      ),
    )
    controller.enqueue(
      encoder.encode(
        formatSSE(
          'content_block_delta',
          JSON.stringify({
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text },
          }),
        ),
      ),
    )
    controller.enqueue(
      encoder.encode(
        formatSSE(
          'content_block_stop',
          JSON.stringify({
            type: 'content_block_stop',
            index,
          }),
        ),
      ),
    )
  }

  function finishStream(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    outputTokens: number,
    inputTokens: number,
    hadToolCalls: boolean,
  ) {
    const stopReason = hadToolCalls ? 'tool_use' : 'end_turn'

    controller.enqueue(
      encoder.encode(
        formatSSE(
          'message_delta',
          JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: outputTokens },
          }),
        ),
      ),
    )
    controller.enqueue(
      encoder.encode(
        formatSSE(
          'message_stop',
          JSON.stringify({
            type: 'message_stop',
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          }),
        ),
      ),
    )
    controller.close()
  }

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-request-id': messageId,
    },
  })
}

// ── Main fetch interceptor ──────────────────────────────────────────

/**
 * Creates a fetch function that intercepts Anthropic API calls and routes them to vLLM.
 *
 * @param apiKey - The API key for authentication
 * @param baseUrl - The vLLM base URL (e.g., http://localhost:8000)
 * @returns A fetch function that translates Anthropic requests to OpenAI format
 */
export function createVLLMFetch(
  apiKey: string,
  baseUrl: string,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const chatCompletionsUrl = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)

    // Only intercept Anthropic API message calls
    if (!url.includes('/v1/messages')) {
      return globalThis.fetch(input, init)
    }

    // Parse the Anthropic request body
    let anthropicBody: Record<string, unknown>
    try {
      const bodyText =
        init?.body instanceof ReadableStream
          ? await new Response(init.body).text()
          : typeof init?.body === 'string'
            ? init.body
            : '{}'
      anthropicBody = JSON.parse(bodyText)
    } catch {
      anthropicBody = {}
    }

    // Translate to OpenAI format
    const { vllmBody, vllmModel } = translateToVLLMBody(anthropicBody)

    // Call vLLM API
    const vllmResponse = await globalThis.fetch(chatCompletionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey || 'sk-placeholder'}`,
      },
      body: JSON.stringify(vllmBody),
    })

    if (!vllmResponse.ok) {
      const errorText = await vllmResponse.text()
      const errorBody = {
        type: 'error',
        error: {
          type: 'api_error',
          message: `vLLM API error (${vllmResponse.status}): ${errorText}`,
        },
      }
      return new Response(JSON.stringify(errorBody), {
        status: vllmResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Translate streaming response
    return translateVLLMStreamToAnthropic(vllmResponse, vllmModel)
  }
}
