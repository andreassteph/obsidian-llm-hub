/**
 * OpenAI Native Provider
 * Uses the official OpenAI SDK for full feature support:
 * - Streaming chat completions with function calling
 * - Multimodal input (images, PDFs)
 * - DALL-E image generation
 *
 * Also used for OpenAI-compatible providers (OpenRouter, Grok, custom)
 * via baseURL override.
 */

import { requestUrl } from "obsidian";
import OpenAI from "openai";
import type { Message, StreamChunk, ToolDefinition, GeneratedImage } from "../types";
import { calculateCost } from "./modelPricing";

/** DALL-E model name patterns */
const DALLE_PATTERN = /^dall-e/i;

/** Check if a model name is a DALL-E image generation model */
export function isOpenAiImageModel(model: string): boolean {
  return DALLE_PATTERN.test(model);
}

function isReasoningParameterError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("reasoning_effort")
    || (lower.includes("reasoning") && lower.includes("unsupported"))
    || (lower.includes("reasoning") && lower.includes("unknown"))
    || (lower.includes("reasoning") && lower.includes("invalid"));
}

/**
 * Verify connection to an API provider by calling /v1/models
 */
export async function verifyApiProvider(
  baseUrl: string,
  apiKey: string
): Promise<{ success: boolean; error?: string; models?: string[] }> {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    const response = await requestUrl({ url, method: "GET", headers });
    const data = response.json as { data?: { id: string }[] };
    const models = (data.data || []).map(m => m.id);
    return { success: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

function createClient(baseUrl: string, apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: `${baseUrl.replace(/\/+$/, "")}/v1`,
    dangerouslyAllowBrowser: true,
  });
}

/**
 * Build OpenAI SDK messages from plugin Message array with multimodal support
 */
function buildMessages(
  messages: Message[],
  systemPrompt?: string,
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    const role = msg.role === "user" ? "user" as const : "assistant" as const;

    if (role === "user" && msg.attachments && msg.attachments.length > 0) {
      const multimodalAttachments = msg.attachments.filter(
        a => a.type === "image" || a.type === "pdf"
      );
      if (multimodalAttachments.length > 0) {
        const parts: OpenAI.ChatCompletionContentPart[] = [
          { type: "text", text: msg.content },
        ];
        for (const att of multimodalAttachments) {
          if (att.type === "image") {
            parts.push({
              type: "image_url",
              image_url: { url: `data:${att.mimeType};base64,${att.data}` },
            });
          } else if (att.type === "pdf") {
            // OpenAI supports file input for PDFs
            parts.push({
              type: "file",
              file: {
                filename: att.name,
                file_data: `data:${att.mimeType};base64,${att.data}`,
              },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          }
        }
        result.push({ role, content: parts });
        continue;
      }
    }

    result.push({ role, content: msg.content });
  }

  return result;
}

/**
 * Convert plugin ToolDefinition to OpenAI SDK tool format
 */
function toOpenAiTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  }));
}

/**
 * Generate image using DALL-E via OpenAI SDK
 */
export async function* openaiGenerateImageStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const client = createClient(baseUrl, apiKey);

  try {
    const response = await client.images.generate({
      model,
      prompt,
      n: 1,
      response_format: "b64_json",
      size: "1024x1024",
    }, { signal });

    for (const item of response.data ?? []) {
      if (item.b64_json) {
        const image: GeneratedImage = {
          mimeType: "image/png",
          data: item.b64_json,
        };
        yield { type: "image_generated", generatedImage: image };
      }
    }

    yield { type: "done" };
  } catch (error) {
    if (signal?.aborted) return;
    const msg = error instanceof Error ? error.message : String(error);
    yield { type: "error", error: msg };
  }
}

/**
 * Stream chat completion with function calling support via OpenAI SDK.
 */
export async function* openaiChatWithToolsStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  tools: ToolDefinition[],
  systemPrompt: string,
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  signal?: AbortSignal,
  enableThinking?: boolean,
): AsyncGenerator<StreamChunk> {
  const client = createClient(baseUrl, apiKey);
  const openaiTools = tools.length > 0 ? toOpenAiTools(tools) : undefined;
  const conversationMessages = buildMessages(messages, systemPrompt);
  const useReasoning = enableThinking === true;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const MAX_TOOL_ROUNDS = 20;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let textContent = "";
    let hasToolCalls = false;
    const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>();
    let reasoningEnabledForAttempt = useReasoning;

    for (;;) {
      try {
        const stream = await client.chat.completions.create({
          model,
          messages: conversationMessages,
          tools: openaiTools,
          stream: true,
          stream_options: { include_usage: true },
          ...(reasoningEnabledForAttempt ? { reasoning_effort: "high" as const } : {}),
        }, { signal });

        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          const delta = choice?.delta;

          if ((delta as Record<string, unknown>)?.reasoning_content) {
            yield { type: "thinking", content: (delta as Record<string, unknown>).reasoning_content as string };
          }

          if (delta?.content) {
            textContent += delta.content;
            yield { type: "text", content: delta.content };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              hasToolCalls = true;
              const existing = toolCallAccum.get(tc.index);
              if (existing) {
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                }
              } else {
                toolCallAccum.set(tc.index, {
                  id: tc.id || `call_${tc.index}`,
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                });
              }
            }
          }

          if (chunk.usage) {
            totalInputTokens += chunk.usage.prompt_tokens ?? 0;
            totalOutputTokens += chunk.usage.completion_tokens ?? 0;
          }
        }

        break;
      } catch (error) {
        if (signal?.aborted) return;
        const msg = error instanceof Error ? error.message : String(error);
        const canRetryWithoutReasoning = reasoningEnabledForAttempt
          && textContent.length === 0
          && toolCallAccum.size === 0
          && isReasoningParameterError(msg);
        if (canRetryWithoutReasoning) {
          reasoningEnabledForAttempt = false;
          continue;
        }
        yield { type: "error", error: msg };
        return;
      }
    }

    // Emit tool calls
    for (const [, tc] of toolCallAccum) {
      try {
        const args = JSON.parse(tc.arguments) as Record<string, unknown>;
        yield { type: "tool_call", toolCall: { id: tc.id, name: tc.name, args } };
      } catch {
        yield { type: "tool_call", toolCall: { id: tc.id, name: tc.name, args: {} } };
      }
    }

    if (!hasToolCalls) {
      const cost = calculateCost(model, totalInputTokens, totalOutputTokens);
      yield {
        type: "done",
        usage: {
          inputTokens: totalInputTokens || undefined,
          outputTokens: totalOutputTokens || undefined,
          totalTokens: (totalInputTokens + totalOutputTokens) || undefined,
          totalCost: cost,
        },
      };
      return;
    }

    // Execute tool calls
    const toolCallEntries = [...toolCallAccum.values()];

    conversationMessages.push({
      role: "assistant",
      content: textContent || null,
      tool_calls: toolCallEntries.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of toolCallEntries) {
      try {
        const args = JSON.parse(tc.arguments) as Record<string, unknown>;
        const result = await executeToolCall(tc.name, args);
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        yield { type: "tool_result", toolResult: { toolCallId: tc.id, result } };
        conversationMessages.push({ role: "tool", content: resultStr, tool_call_id: tc.id });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        conversationMessages.push({ role: "tool", content: JSON.stringify({ error: errMsg }), tool_call_id: tc.id });
      }
    }
  }

  yield { type: "error", error: "Maximum tool call rounds exceeded" };
}
