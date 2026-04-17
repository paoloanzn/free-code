import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { getGlobalConfig, saveGlobalConfig } from "src/utils/config.js";
import { logForDebugging } from "src/utils/debug.js";
import { logError } from "src/utils/log.js";

type OpenAICompatibleModelOption = {
  value: string;
  label: string;
  description: string;
};

type OpenAICompatibleFetchOptions = {
  apiKey: string;
  baseUrl: string;
};

type OpenAICompatibleChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type OpenAICompatibleChatCompletion = {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getOpenAICompatibleBaseUrl(): string {
  const fromClaudeCode = process.env.CLAUDE_CODE_OPENAI_BASE_URL?.trim();
  const fromOpenAI = process.env.OPENAI_BASE_URL?.trim();
  const base = fromClaudeCode || fromOpenAI || "https://api.openai.com/v1";
  return trimTrailingSlash(base);
}

export function getOpenAICompatibleApiKey(): string | null {
  return (
    process.env.CLAUDE_CODE_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    null
  );
}

export function getOpenAICompatibleDefaultModel(): string | null {
  const fromEnv =
    process.env.CLAUDE_CODE_OPENAI_DEFAULT_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim();
  if (fromEnv) return fromEnv;

  const fromCache = getGlobalConfig().additionalModelOptionsCache?.[0]?.value;
  return typeof fromCache === "string" && fromCache ? fromCache : null;
}

function parseSystemPrompt(
  rawSystem:
    | string
    | Array<{ type?: string; text?: string; cache_control?: unknown }>
    | undefined,
): string {
  if (!rawSystem) return "";
  if (typeof rawSystem === "string") return rawSystem;
  return rawSystem
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function toOpenAICompatibleMessages(
  anthropicMessages: Array<{
    role?: string;
    content?:
      | string
      | Array<{
          type?: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
        }>;
  }>,
): OpenAICompatibleChatMessage[] {
  const out: OpenAICompatibleChatMessage[] = [];

  for (const message of anthropicMessages) {
    const role = message.role;
    const content = message.content;

    if (typeof content === "string") {
      if (role === "user" || role === "assistant") {
        out.push({ role, content });
      }
      continue;
    }

    if (!Array.isArray(content)) continue;

    if (role === "user") {
      let textContent = "";
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          textContent += (textContent ? "\n" : "") + block.text;
        }
        if (block.type === "tool_result") {
          const toolResultText =
            typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .map((c) => {
                      if (
                        typeof c === "object" &&
                        c !== null &&
                        "type" in c &&
                        (c as { type?: string }).type === "text" &&
                        "text" in c &&
                        typeof (c as { text?: string }).text === "string"
                      ) {
                        return (c as { text: string }).text;
                      }
                      return "";
                    })
                    .filter(Boolean)
                    .join("\n")
                : "";
          if (block.tool_use_id) {
            out.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: toolResultText,
            });
          }
        }
      }
      if (textContent) {
        out.push({ role: "user", content: textContent });
      }
      continue;
    }

    if (role === "assistant") {
      let textContent = "";
      const toolCalls: NonNullable<OpenAICompatibleChatMessage["tool_calls"]> =
        [];
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          textContent += (textContent ? "\n" : "") + block.text;
          continue;
        }
        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id || `call_${randomUUID()}`,
            type: "function",
            function: {
              name: block.name || "tool",
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        }
      }
      if (textContent || toolCalls.length > 0) {
        out.push({
          role: "assistant",
          ...(textContent ? { content: textContent } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      }
    }
  }

  return out;
}

function toAnthropicMessagePayload(
  completion: OpenAICompatibleChatCompletion,
  requestedModel: string,
) {
  const choice = completion.choices?.[0];
  const text = choice?.message?.content ?? "";
  const toolCalls = choice?.message?.tool_calls ?? [];
  const content: Array<Record<string, unknown>> = [];

  if (text) {
    content.push({ type: "text", text });
  }
  for (const call of toolCalls) {
    const rawArgs = call.function?.arguments || "{}";
    let parsedArgs: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedArgs = parsed as Record<string, unknown>;
      }
    } catch {
      parsedArgs = {};
    }
    content.push({
      type: "tool_use",
      id: call.id || `toolu_${randomUUID()}`,
      name: call.function?.name || "tool",
      input: parsedArgs,
    });
  }

  return {
    id: completion.id || `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    content,
    model: completion.model || requestedModel,
    stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}

function asSSE(events: Array<{ event: string; data: unknown }>): string {
  return events
    .map(
      ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

function toAnthropicStreamingResponse(
  completion: OpenAICompatibleChatCompletion,
  requestedModel: string,
): Response {
  const payload = toAnthropicMessagePayload(completion, requestedModel);
  const usage = payload.usage as {
    input_tokens: number;
    output_tokens: number;
  };
  const events: Array<{ event: string; data: unknown }> = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          ...payload,
          content: [],
          stop_reason: null,
        },
      },
    },
  ];

  let contentIndex = 0;
  for (const block of payload.content as Array<Record<string, unknown>>) {
    if (block.type === "text") {
      events.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: contentIndex,
          content_block: { type: "text", text: "" },
        },
      });
      events.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: contentIndex,
          delta: { type: "text_delta", text: String(block.text || "") },
        },
      });
      events.push({
        event: "content_block_stop",
        data: { type: "content_block_stop", index: contentIndex },
      });
      contentIndex++;
      continue;
    }

    if (block.type === "tool_use") {
      events.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: contentIndex,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: {},
          },
        },
      });
      events.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: contentIndex,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(block.input ?? {}),
          },
        },
      });
      events.push({
        event: "content_block_stop",
        data: { type: "content_block_stop", index: contentIndex },
      });
      contentIndex++;
    }
  }

  events.push({
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: payload.stop_reason, stop_sequence: null },
      usage: { output_tokens: usage.output_tokens },
    },
  });
  events.push({ event: "message_stop", data: { type: "message_stop" } });

  return new Response(asSSE(events), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-request-id": payload.id,
    },
  });
}

function translateToolChoice(
  rawToolChoice: unknown,
): "auto" | "none" | { type: "function"; function: { name: string } } {
  if (!rawToolChoice || typeof rawToolChoice !== "object") return "auto";
  const type = (rawToolChoice as { type?: string }).type;
  if (type === "none") return "none";
  if (type === "tool") {
    const name = (rawToolChoice as { name?: string }).name;
    if (name) {
      return {
        type: "function",
        function: { name },
      };
    }
  }
  return "auto";
}

function normalizeMaxTokens(rawMaxTokens: unknown): number | undefined {
  if (typeof rawMaxTokens !== "number" || !Number.isFinite(rawMaxTokens)) {
    return undefined;
  }

  const floored = Math.floor(rawMaxTokens);
  if (floored < 1) return 1;

  const providerCap = Number.parseInt(
    process.env.CLAUDE_CODE_OPENAI_MAX_TOKENS?.trim() || "8192",
    10,
  );
  const maxAllowed =
    Number.isFinite(providerCap) && providerCap > 0 ? providerCap : 8192;

  return Math.min(floored, maxAllowed);
}

function buildOpenAICompatibleBody(
  anthropicBody: Record<string, unknown>,
): Record<string, unknown> {
  const system = parseSystemPrompt(
    anthropicBody.system as
      | string
      | Array<{ type?: string; text?: string; cache_control?: unknown }>
      | undefined,
  );
  const messages = toOpenAICompatibleMessages(
    (anthropicBody.messages as Array<{
      role?: string;
      content?: unknown;
    }>) || [],
  );
  const tools = Array.isArray(anthropicBody.tools)
    ? (
        anthropicBody.tools as Array<{
          name?: string;
          description?: string;
          input_schema?: Record<string, unknown>;
        }>
      ).map((tool) => ({
        type: "function",
        function: {
          name: tool.name || "tool",
          description: tool.description || "",
          parameters: tool.input_schema || {
            type: "object",
            properties: {},
          },
        },
      }))
    : [];

  const openAIMessages: OpenAICompatibleChatMessage[] = [
    ...(system ? [{ role: "system", content: system } as const] : []),
    ...messages,
  ];

  const maxTokens = normalizeMaxTokens(anthropicBody.max_tokens);

  return {
    model: anthropicBody.model,
    messages: openAIMessages,
    stream: false,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(typeof anthropicBody.temperature === "number"
      ? { temperature: anthropicBody.temperature }
      : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(anthropicBody.tool_choice
      ? { tool_choice: translateToolChoice(anthropicBody.tool_choice) }
      : {}),
  };
}

export function createOpenAICompatibleFetch(
  options: OpenAICompatibleFetchOptions,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const baseUrl = trimTrailingSlash(options.baseUrl);

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    if (!requestUrl.includes("/v1/messages")) {
      return globalThis.fetch(input, init);
    }

    let body: Record<string, unknown> = {};
    try {
      const rawBody =
        init?.body instanceof ReadableStream
          ? await new Response(init.body).text()
          : typeof init?.body === "string"
            ? init.body
            : "{}";
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }

    const openAIBody = buildOpenAICompatibleBody(body);
    const providerResponse = await globalThis.fetch(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(openAIBody),
      },
    );

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "api_error",
            message: `OpenAI-compatible provider error (${providerResponse.status}): ${errorText}`,
          },
        }),
        {
          status: providerResponse.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const completion =
      (await providerResponse.json()) as OpenAICompatibleChatCompletion;
    const requestedModel = String(body.model || openAIBody.model || "");
    const streamRequested = Boolean(body.stream);

    if (streamRequested) {
      return toAnthropicStreamingResponse(completion, requestedModel);
    }

    const anthropicPayload = toAnthropicMessagePayload(
      completion,
      requestedModel,
    );
    return new Response(JSON.stringify(anthropicPayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": anthropicPayload.id,
      },
    });
  };
}

export async function refreshOpenAICompatibleModelOptions(): Promise<void> {
  const apiKey = getOpenAICompatibleApiKey();
  if (!apiKey) {
    logForDebugging("[OpenAI provider] Skipping model fetch: no API key");
    return;
  }

  const baseUrl = getOpenAICompatibleBaseUrl();
  try {
    const response = await globalThis.fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      logForDebugging(
        `[OpenAI provider] Model fetch failed (${response.status})`,
      );
      return;
    }

    const parsed = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };

    const options: OpenAICompatibleModelOption[] = (parsed.data || [])
      .map((model) => model.id?.trim())
      .filter((id): id is string => Boolean(id))
      .map((id) => ({
        value: id,
        label: id,
        description: `Model served by ${baseUrl}`,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));

    if (options.length === 0) {
      logForDebugging("[OpenAI provider] No models returned from /models");
      return;
    }

    saveGlobalConfig((current) => ({
      ...current,
      additionalModelOptionsCache: options,
    }));
    logForDebugging(`[OpenAI provider] Cached ${options.length} model options`);
  } catch (error) {
    logError(error as Error);
  }
}

export async function refreshCopilotModelOptions(): Promise<void> {
  const apiKey = process.env.COPILOT_TOKEN?.trim();
  if (!apiKey) {
    logForDebugging(
      "[Copilot provider] Skipping model fetch: no COPILOT_TOKEN",
    );
    return;
  }

  const baseUrl = (
    process.env.COPILOT_BASE_URL?.trim() || "https://api.githubcopilot.com"
  ).replace(/\/+$/, "");
  try {
    const response = await globalThis.fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "free-code/1.0",
        "Openai-Intent": "conversation-edits",
      },
    });

    if (!response.ok) {
      logForDebugging(
        `[Copilot provider] Model fetch failed (${response.status})`,
      );
      return;
    }

    const parsed = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };

    const options: OpenAICompatibleModelOption[] = (parsed.data || [])
      .map((model) => model.id?.trim())
      .filter((id): id is string => Boolean(id))
      .map((id) => ({
        value: id,
        label: id,
        description: `Model served by GitHub Copilot`,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));

    if (options.length === 0) {
      logForDebugging("[Copilot provider] No models returned from /models");
      return;
    }

    saveGlobalConfig((current) => ({
      ...current,
      additionalModelOptionsCache: options,
    }));
    logForDebugging(
      `[Copilot provider] Cached ${options.length} model options`,
    );
  } catch (error) {
    logError(error as Error);
  }
}

export function isOpenAICompatibleModel(model: string): boolean {
  return model.includes("gpt-") || model.includes("o1") || model.includes("o3");
}

export function toAnthropicClientForOpenAICompatible(fetchImpl: {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  maxRetries: number;
  timeout: number;
  defaultHeaders: Record<string, string>;
}): Anthropic {
  return new Anthropic({
    apiKey: "openai-compatible-placeholder",
    maxRetries: fetchImpl.maxRetries,
    timeout: fetchImpl.timeout,
    defaultHeaders: fetchImpl.defaultHeaders,
    fetch: fetchImpl.fetch as unknown as typeof globalThis.fetch,
    dangerouslyAllowBrowser: true,
  });
}
