/**
 * Codex Fetch Adapter
 *
 * Intercepts fetch calls from the Anthropic SDK and routes them to
 * ChatGPT's Codex backend API, translating between Anthropic Messages API
 * format and OpenAI Responses API format.
 *
 * Supports:
 * - Text messages (user/assistant)
 * - System prompts → instructions
 * - Tool definitions (Anthropic input_schema → OpenAI parameters)
 * - Tool use (tool_use → function_call, tool_result → function_call_output)
 * - Streaming events translation
 *
 * Endpoint: https://chatgpt.com/backend-api/codex/responses
 */

import { getCodexOAuthTokens } from '../../utils/auth.js'
import type { CodexResponsesBridgeConfig } from './codex-provider-bridge.js'

// ── Available Codex models ──────────────────────────────────────────
export const CODEX_MODELS = [
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', description: 'Frontier agentic coding model' },
  { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', description: 'Codex coding model' },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', description: 'Fast Codex model' },
  { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', description: 'Max Codex model' },
  { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Latest GPT' },
  { id: 'gpt-5.2', label: 'GPT-5.2', description: 'GPT-5.2' },
] as const

export const DEFAULT_CODEX_MODEL = 'gpt-5.2-codex'

/**
 * Maps Claude model names to corresponding Codex model names.
 * @param claudeModel - The Claude model name to map
 * @returns The corresponding Codex model ID
 */
export function mapClaudeModelToCodex(claudeModel: string | null): string {
  if (!claudeModel) return DEFAULT_CODEX_MODEL
  if (isCodexModel(claudeModel)) return claudeModel
  const lower = claudeModel.toLowerCase()
  if (lower.includes('opus')) return 'gpt-5.1-codex-max'
  if (lower.includes('haiku')) return 'gpt-5.1-codex-mini'
  if (lower.includes('sonnet')) return 'gpt-5.2-codex'
  return DEFAULT_CODEX_MODEL
}

/**
 * Checks if a given model string is a valid Codex model.
 * @param model - The model string to check
 * @returns True if the model is a Codex model, false otherwise
 */
export function isCodexModel(model: string): boolean {
  return CODEX_MODELS.some(m => m.id === model)
}

// ── JWT helpers ─────────────────────────────────────────────────────

const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

/**
 * Extracts the account ID from a Codex JWT token.
 * @param token - The JWT token to extract the account ID from
 * @returns The account ID
 * @throws Error if the token is invalid or account ID cannot be extracted
 */
function extractAccountId(token: string): string {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Invalid token')
    const payload = JSON.parse(atob(parts[1]))
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id
    if (!accountId) throw new Error('No account ID in token')
    return accountId
  } catch {
    throw new Error('Failed to extract account ID from Codex token')
  }
}

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

// ── Tool translation: Anthropic → Codex ─────────────────────────────

/**
 * Translates Anthropic tool definitions to Codex format.
 * @param anthropicTools - Array of Anthropic tool definitions
 * @returns Array of Codex-compatible tool objects
 */
function translateTools(anthropicTools: AnthropicTool[]): Array<Record<string, unknown>> {
  return anthropicTools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description || '',
    parameters: tool.input_schema || { type: 'object', properties: {} },
    strict: null,
  }))
}

// ── Message translation: Anthropic → Codex input ────────────────────

/**
 * Translates Anthropic message format to Codex input format.
 * Handles text content, tool results, and image attachments.
 * @param anthropicMessages - Array of messages in Anthropic format
 * @returns Array of Codex-compatible input objects
 */
function translateMessages(
  anthropicMessages: AnthropicMessage[],
): Array<Record<string, unknown>> {
  const codexInput: Array<Record<string, unknown>> = []
  // Track tool_use IDs to generate call_ids for function_call_output
  // Anthropic uses tool_use_id, Codex uses call_id
  let toolCallCounter = 0

  for (const msg of anthropicMessages) {
    if (typeof msg.content === 'string') {
      codexInput.push({ role: msg.role, content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) continue

    if (msg.role === 'user') {
      const contentArr: Array<Record<string, unknown>> = []
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
              .join('\n')
          }
          codexInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: outputText || '',
          })
        } else if (block.type === 'text' && typeof block.text === 'string') {
          contentArr.push({ type: 'input_text', text: block.text })
        } else if (
          block.type === 'image' &&
          typeof block.source === 'object' &&
          block.source !== null &&
          (block.source as any).type === 'base64'
        ) {
          contentArr.push({
            type: 'input_image',
            image_url: `data:${(block.source as any).media_type};base64,${(block.source as any).data}`,
          })
        }
      }
      if (contentArr.length > 0) {
        if (contentArr.length === 1 && contentArr[0].type === 'input_text') {
          codexInput.push({ role: 'user', content: contentArr[0].text })
        } else {
          codexInput.push({ role: 'user', content: contentArr })
        }
      }
    } else {
      // Process assistant or tool blocks
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          if (msg.role === 'assistant') {
            codexInput.push({
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: block.text, annotations: [] }],
              status: 'completed',
            })
          }
        } else if (block.type === 'tool_use') {
          const callId = block.id || `call_${toolCallCounter++}`
          codexInput.push({
            type: 'function_call',
            call_id: callId,
            name: block.name || '',
            arguments: JSON.stringify(block.input || {}),
          })
        }
      }
    }
  }

  return codexInput
}

// ── Full request translation ────────────────────────────────────────

/**
 * Translates a complete Anthropic API request body to Codex format.
 * @param anthropicBody - The Anthropic request body to translate
 * @returns Object containing the translated Codex body and model
 */
function translateToCodexBody(anthropicBody: Record<string, unknown>): {
  codexBody: Record<string, unknown>
  codexModel: string
} {
  const anthropicMessages = (anthropicBody.messages || []) as AnthropicMessage[]
  const systemPrompt = anthropicBody.system as
    | string
    | Array<{ type: string; text?: string; cache_control?: unknown }>
    | undefined
  const claudeModel = anthropicBody.model as string
  const anthropicTools = (anthropicBody.tools || []) as AnthropicTool[]

  const codexModel = mapClaudeModelToCodex(claudeModel)

  // Build system instructions
  let instructions = ''
  if (systemPrompt) {
    instructions =
      typeof systemPrompt === 'string'
        ? systemPrompt
        : Array.isArray(systemPrompt)
          ? systemPrompt
              .filter(b => b.type === 'text' && typeof b.text === 'string')
              .map(b => b.text!)
              .join('\n')
          : ''
  }

  // Convert messages
  const input = translateMessages(anthropicMessages)

  const codexBody: Record<string, unknown> = {
    model: codexModel,
    store: false,
    stream: true,
    instructions,
    input,
    tool_choice: 'auto',
    parallel_tool_calls: true,
  }

  // Add tools if present
  if (anthropicTools.length > 0) {
    codexBody.tools = translateTools(anthropicTools)
  }

  return { codexBody, codexModel }
}

// ── Response translation: Codex SSE → Anthropic SSE ─────────────────

/**
 * Formats data as Server-Sent Events (SSE) format.
 * @param event - The event type
 * @param data - The data payload
 * @returns Formatted SSE string
 */
function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

/**
 * Translates Codex streaming response to Anthropic format.
 * Converts Codex SSE events into Anthropic-compatible streaming events.
 * @param codexResponse - The streaming response from Codex API
 * @param codexModel - The Codex model used for the request
 * @returns Transformed Response object with Anthropic-format stream
 */
async function translateCodexStreamToAnthropic(
  codexResponse: Response,
  codexModel: string,
): Promise<Response> {
  const messageId = `msg_codex_${Date.now()}`

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
                model: codexModel,
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

      // Track state for tool calls
      let currentTextBlockStarted = false
      let currentToolCallId = ''
      let currentToolCallName = ''
      let currentToolCallArgs = ''
      let inToolCall = false
      let hadToolCalls = false
      let inReasoningBlock = false

      try {
        const reader = codexResponse.body?.getReader()
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

            // Parse "event: xxx" lines
            if (trimmed.startsWith('event: ')) continue

            if (!trimmed.startsWith('data: ')) continue
            const dataStr = trimmed.slice(6)
            if (dataStr === '[DONE]') continue

            let event: Record<string, unknown>
            try {
              event = JSON.parse(dataStr)
            } catch {
              continue
            }

            const eventType = event.type as string

            // ── Text output events ──────────────────────────────
            if (eventType === 'response.output_item.added') {
              const item = event.item as Record<string, unknown>
              if (item?.type === 'reasoning') {
                inReasoningBlock = true
                controller.enqueue(
                  encoder.encode(
                    formatSSE(
                      'content_block_start',
                      JSON.stringify({
                        type: 'content_block_start',
                        index: contentBlockIndex,
                        content_block: { type: 'thinking', thinking: '' },
                      }),
                    ),
                  ),
                )
              } else if (item?.type === 'message') {
                // New text message block starting
                if (inToolCall) {
                  // Close the previous tool call block
                  closeToolCallBlock(controller, encoder, contentBlockIndex, currentToolCallId, currentToolCallName, currentToolCallArgs)
                  contentBlockIndex++
                  inToolCall = false
                }
              } else if (item?.type === 'function_call') {
                // Close text block if open
                if (currentTextBlockStarted) {
                  controller.enqueue(
                    encoder.encode(
                      formatSSE('content_block_stop', JSON.stringify({
                        type: 'content_block_stop',
                        index: contentBlockIndex,
                      })),
                    ),
                  )
                  contentBlockIndex++
                  currentTextBlockStarted = false
                }

                // Start tool_use block (Anthropic format)
                currentToolCallId = (item.call_id as string) || `toolu_${Date.now()}`
                currentToolCallName = (item.name as string) || ''
                currentToolCallArgs = (item.arguments as string) || ''
                inToolCall = true
                hadToolCalls = true

                controller.enqueue(
                  encoder.encode(
                    formatSSE('content_block_start', JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: {
                        type: 'tool_use',
                        id: currentToolCallId,
                        name: currentToolCallName,
                        input: {},
                      },
                    })),
                  ),
                )
              }
            }

            // Text deltas
            else if (eventType === 'response.output_text.delta') {
              const text = event.delta as string
              if (typeof text === 'string' && text.length > 0) {
                if (!currentTextBlockStarted) {
                  // Start a new text content block
                  controller.enqueue(
                    encoder.encode(
                      formatSSE('content_block_start', JSON.stringify({
                        type: 'content_block_start',
                        index: contentBlockIndex,
                        content_block: { type: 'text', text: '' },
                      })),
                    ),
                  )
                  currentTextBlockStarted = true
                }
                controller.enqueue(
                  encoder.encode(
                    formatSSE('content_block_delta', JSON.stringify({
                      type: 'content_block_delta',
                      index: contentBlockIndex,
                      delta: { type: 'text_delta', text },
                    })),
                  ),
                )
                outputTokens += 1
              }
            }
            
            // Reasoning deltas
            else if (eventType === 'response.reasoning.delta') {
              const text = event.delta as string
              if (typeof text === 'string' && text.length > 0) {
                if (!inReasoningBlock) {
                  inReasoningBlock = true
                  controller.enqueue(
                    encoder.encode(
                      formatSSE('content_block_start', JSON.stringify({
                        type: 'content_block_start',
                        index: contentBlockIndex,
                        content_block: { type: 'thinking', thinking: '' },
                      })),
                    ),
                  )
                }
                controller.enqueue(
                  encoder.encode(
                    formatSSE('content_block_delta', JSON.stringify({
                      type: 'content_block_delta',
                      index: contentBlockIndex,
                      delta: { type: 'thinking_delta', thinking: text },
                    })),
                  ),
                )
                outputTokens += 1 // approximate token counts
              }
            }

            // ── Tool call argument deltas ───────────────────────
            else if (eventType === 'response.function_call_arguments.delta') {
              const argDelta = event.delta as string
              if (typeof argDelta === 'string' && inToolCall) {
                currentToolCallArgs += argDelta
                controller.enqueue(
                  encoder.encode(
                    formatSSE('content_block_delta', JSON.stringify({
                      type: 'content_block_delta',
                      index: contentBlockIndex,
                      delta: {
                        type: 'input_json_delta',
                        partial_json: argDelta,
                      },
                    })),
                  ),
                )
              }
            }

            // Tool call arguments complete
            else if (eventType === 'response.function_call_arguments.done') {
              if (inToolCall) {
                currentToolCallArgs = (event.arguments as string) || currentToolCallArgs
              }
            }

            // Output item done — close blocks
            else if (eventType === 'response.output_item.done') {
              const item = event.item as Record<string, unknown>
              if (item?.type === 'function_call') {
                closeToolCallBlock(controller, encoder, contentBlockIndex, currentToolCallId, currentToolCallName, currentToolCallArgs)
                contentBlockIndex++
                inToolCall = false
                currentToolCallArgs = ''
              } else if (item?.type === 'message') {
                if (currentTextBlockStarted) {
                  controller.enqueue(
                    encoder.encode(
                      formatSSE('content_block_stop', JSON.stringify({
                        type: 'content_block_stop',
                        index: contentBlockIndex,
                      })),
                    ),
                  )
                  contentBlockIndex++
                  currentTextBlockStarted = false
                }
              } else if (item?.type === 'reasoning') {
                if (inReasoningBlock) {
                  controller.enqueue(
                    encoder.encode(
                      formatSSE('content_block_stop', JSON.stringify({
                        type: 'content_block_stop',
                        index: contentBlockIndex,
                      })),
                    ),
                  )
                  contentBlockIndex++
                  inReasoningBlock = false
                }
              }
            }

            // Response completed — extract usage
            else if (eventType === 'response.completed') {
              const response = event.response as Record<string, unknown>
              const usage = response?.usage as Record<string, number> | undefined
              if (usage) {
                outputTokens = usage.output_tokens || outputTokens
                inputTokens = usage.input_tokens || inputTokens
              }
            }
          }
        }
      } catch (err) {
        // If we're in the middle of a text block, emit the error there
        if (!currentTextBlockStarted) {
          controller.enqueue(
            encoder.encode(
              formatSSE('content_block_start', JSON.stringify({
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              })),
            ),
          )
          currentTextBlockStarted = true
        }
        controller.enqueue(
          encoder.encode(
            formatSSE('content_block_delta', JSON.stringify({
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text: `\n\n[Error: ${String(err)}]` },
            })),
          ),
        )
      }

      // Close any remaining open blocks
      if (currentTextBlockStarted) {
        controller.enqueue(
          encoder.encode(
            formatSSE('content_block_stop', JSON.stringify({
              type: 'content_block_stop',
              index: contentBlockIndex,
            })),
          ),
        )
      }
      if (inReasoningBlock) {
        controller.enqueue(
          encoder.encode(
            formatSSE('content_block_stop', JSON.stringify({
              type: 'content_block_stop',
              index: contentBlockIndex,
            })),
          ),
        )
      }
      if (inToolCall) {
        closeToolCallBlock(controller, encoder, contentBlockIndex, currentToolCallId, currentToolCallName, currentToolCallArgs)
      }

      finishStream(controller, encoder, outputTokens, inputTokens, hadToolCalls)
    },
  })

  function closeToolCallBlock(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    index: number,
    _toolCallId: string,
    _toolCallName: string,
    _toolCallArgs: string,
  ) {
    controller.enqueue(
      encoder.encode(
        formatSSE('content_block_stop', JSON.stringify({
          type: 'content_block_stop',
          index,
        })),
      ),
    )
  }

  function emitTextBlock(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    index: number,
    text: string,
  ) {
    controller.enqueue(
      encoder.encode(
        formatSSE('content_block_start', JSON.stringify({
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        })),
      ),
    )
    controller.enqueue(
      encoder.encode(
        formatSSE('content_block_delta', JSON.stringify({
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text },
        })),
      ),
    )
    controller.enqueue(
      encoder.encode(
        formatSSE('content_block_stop', JSON.stringify({
          type: 'content_block_stop',
          index,
        })),
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
    // Use 'tool_use' stop reason when model made tool calls
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
            'amazon-bedrock-invocationMetrics': {
              inputTokenCount: inputTokens,
              outputTokenCount: outputTokens,
              invocationLatency: 0,
              firstByteLatency: 0,
            },
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

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex/responses'

type ResponsesBridgeFetchOptions = {
  accessToken: string
  endpoint: string
  extraHeaders?: Record<string, string>
  getAccessToken?: () => string
}

/**
 * Creates a fetch function that intercepts Anthropic API calls and routes them to Codex.
 * @param accessToken - The Codex access token for authentication
 * @returns A fetch function that translates Anthropic requests to Codex format
 */
function createResponsesBridgeFetch({
  accessToken,
  endpoint,
  extraHeaders,
  getAccessToken,
}: ResponsesBridgeFetchOptions): (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> {
  const resolveAccessToken = getAccessToken ?? (() => accessToken)

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

    // Translate to Codex format
    const { codexBody, codexModel } = translateToCodexBody(anthropicBody)

    // Call Codex API
    const codexResponse = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${resolveAccessToken()}`,
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify(codexBody),
    })

    if (!codexResponse.ok) {
      const errorText = await codexResponse.text()
      const errorBody = {
        type: 'error',
        error: {
          type: 'api_error',
          message: `Codex API error (${codexResponse.status}): ${errorText}`,
        },
      }
      return new Response(JSON.stringify(errorBody), {
        status: codexResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Translate streaming response
    return translateCodexStreamToAnthropic(codexResponse, codexModel)
  }
}

export function createCodexFetch(
  accessToken: string,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const accountId = extractAccountId(accessToken)

  return createResponsesBridgeFetch({
    accessToken,
    endpoint: CODEX_BASE_URL,
    getAccessToken: () => {
      const tokens = getCodexOAuthTokens()
      return tokens?.accessToken || accessToken
    },
    extraHeaders: {
      'chatgpt-account-id': accountId,
      originator: 'pi',
      'OpenAI-Beta': 'responses=experimental',
    },
  })
}

export function createResponsesFetch(
  config: CodexResponsesBridgeConfig,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return createResponsesBridgeFetch({
    accessToken: config.apiKey,
    endpoint: config.endpoint,
    extraHeaders: config.headers,
  })
}
