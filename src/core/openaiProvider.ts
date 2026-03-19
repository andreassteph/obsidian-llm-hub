/**
 * OpenAI-Compatible API Provider
 * Supports OpenAI, OpenRouter, Grok, and other OpenAI-compatible APIs.
 * Includes function calling (tools) support and multimodal content.
 *
 * Uses Node.js http/https for streaming (bypasses CORS).
 */

import { requestUrl } from "obsidian";
import type { Message, StreamChunk, ToolDefinition } from "../types";

// OpenAI message content types
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Idle timeout for stream chunks (ms). */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

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

/**
 * Convert plugin ToolDefinition to OpenAI tools format
 */
function toOpenAiTools(tools: ToolDefinition[]): OpenAiTool[] {
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
 * Build OpenAI messages from plugin Message array, with multimodal support
 */
function buildMessages(
  messages: Message[],
  systemPrompt?: string,
): OpenAiMessage[] {
  const result: OpenAiMessage[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    const role = msg.role === "user" ? "user" : "assistant";

    // Check for image attachments on user messages
    if (role === "user" && msg.attachments && msg.attachments.length > 0) {
      const imageAttachments = msg.attachments.filter(a => a.type === "image");
      if (imageAttachments.length > 0) {
        const parts: ContentPart[] = [
          { type: "text", text: msg.content },
        ];
        for (const att of imageAttachments) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${att.mimeType};base64,${att.data}` },
          });
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
 * Stream chat completion with function calling support from an OpenAI-compatible API.
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
): AsyncGenerator<StreamChunk> {
  const openaiTools = tools.length > 0 ? toOpenAiTools(tools) : undefined;
  const conversationMessages = buildMessages(messages, systemPrompt);

  // Tool call loop: keep calling the API while it requests tool calls
  const MAX_TOOL_ROUNDS = 20;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const pendingToolCalls: OpenAiToolCall[] = [];
    let textContent = "";
    let hasToolCalls = false;

    // Stream a single API call
    for await (const chunk of streamSingleCall(
      baseUrl, apiKey, model, conversationMessages, openaiTools, signal
    )) {
      if (chunk.type === "text") {
        textContent += chunk.content || "";
        yield chunk;
      } else if (chunk.type === "thinking") {
        yield chunk;
      } else if (chunk.type === "tool_call" && chunk.toolCall) {
        hasToolCalls = true;
        pendingToolCalls.push({
          id: chunk.toolCall.id,
          type: "function",
          function: {
            name: chunk.toolCall.name,
            arguments: JSON.stringify(chunk.toolCall.args),
          },
        });
        yield chunk;
      } else if (chunk.type === "error") {
        yield chunk;
        return;
      } else if (chunk.type === "done") {
        // Don't yield done yet if we have tool calls to process
        if (!hasToolCalls) {
          yield chunk;
          return;
        }
      }
    }

    if (!hasToolCalls) {
      yield { type: "done" };
      return;
    }

    // Execute tool calls and build tool result messages
    conversationMessages.push({
      role: "assistant",
      content: textContent || null,
      tool_calls: pendingToolCalls,
    });

    for (const tc of pendingToolCalls) {
      try {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        const result = await executeToolCall(tc.function.name, args);
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);

        yield {
          type: "tool_result",
          toolResult: { toolCallId: tc.id, result },
        };

        conversationMessages.push({
          role: "tool",
          content: resultStr,
          tool_call_id: tc.id,
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        conversationMessages.push({
          role: "tool",
          content: JSON.stringify({ error: errMsg }),
          tool_call_id: tc.id,
        });
      }
    }
  }

  yield { type: "error", error: "Maximum tool call rounds exceeded" };
}

/**
 * Stream a single API call (no tool loop)
 */
async function* streamSingleCall(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: OpenAiMessage[],
  tools?: OpenAiTool[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  const body = JSON.stringify(requestBody);
  const parsedUrl = new URL(url);
  const httpModule = getHttpModule(parsedUrl.protocol);

  const chunks: StreamChunk[] = [];
  const signal$ = new StreamSignal();
  let streamDone = false;
  let streamError: Error | null = null;

  // Accumulate tool calls across SSE chunks
  const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>();

  const req = httpModule.request(
    {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers,
    },
    (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        let errorBody = "";
        res.on("data", (chunk: Buffer) => { errorBody += chunk.toString(); });
        res.on("end", () => {
          chunks.push({ type: "error", error: `HTTP ${res.statusCode}: ${errorBody.slice(0, 500) || res.statusMessage}` });
          streamDone = true;
          signal$.notify();
        });
        return;
      }

      let buffer = "";

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            // Emit accumulated tool calls
            for (const [, tc] of toolCallAccum) {
              try {
                const args = JSON.parse(tc.arguments) as Record<string, unknown>;
                chunks.push({
                  type: "tool_call",
                  toolCall: { id: tc.id, name: tc.name, args },
                });
              } catch {
                chunks.push({
                  type: "tool_call",
                  toolCall: { id: tc.id, name: tc.name, args: {} },
                });
              }
            }
            chunks.push({ type: "done" });
            streamDone = true;
            signal$.notify();
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: {
                delta?: {
                  content?: string;
                  reasoning_content?: string;
                  tool_calls?: {
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }[];
                };
                finish_reason?: string | null;
              }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };

            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            // Thinking / reasoning content
            if (delta?.reasoning_content) {
              chunks.push({ type: "thinking", content: delta.reasoning_content });
            }

            // Text content
            if (delta?.content) {
              chunks.push({ type: "text", content: delta.content });
            }

            // Tool calls (accumulated across chunks)
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
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

            // Usage in stream (some providers send this)
            if (parsed.usage && (parsed.usage.prompt_tokens || parsed.usage.completion_tokens)) {
              // Emit tool calls before done
              for (const [, tc] of toolCallAccum) {
                try {
                  const args = JSON.parse(tc.arguments) as Record<string, unknown>;
                  chunks.push({
                    type: "tool_call",
                    toolCall: { id: tc.id, name: tc.name, args },
                  });
                } catch {
                  chunks.push({
                    type: "tool_call",
                    toolCall: { id: tc.id, name: tc.name, args: {} },
                  });
                }
              }
              toolCallAccum.clear();

              chunks.push({
                type: "done",
                usage: {
                  inputTokens: parsed.usage.prompt_tokens,
                  outputTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                },
              });
              streamDone = true;
              signal$.notify();
              return;
            }

            // finish_reason without [DONE]
            if (choice?.finish_reason === "stop" || choice?.finish_reason === "tool_calls") {
              // Will be handled by [DONE] or usage
            }
          } catch (parseErr) {
            console.warn("[openai-provider] Failed to parse SSE data:", data.slice(0, 200), parseErr);
          }
        }
        signal$.notify();
      });

      res.on("end", () => {
        if (!streamDone) {
          // Emit any remaining tool calls
          for (const [, tc] of toolCallAccum) {
            try {
              const args = JSON.parse(tc.arguments) as Record<string, unknown>;
              chunks.push({
                type: "tool_call",
                toolCall: { id: tc.id, name: tc.name, args },
              });
            } catch {
              chunks.push({
                type: "tool_call",
                toolCall: { id: tc.id, name: tc.name, args: {} },
              });
            }
          }
          chunks.push({ type: "done" });
          streamDone = true;
        }
        signal$.notify();
      });

      res.on("error", (err: Error) => {
        streamError = err;
        signal$.notify();
      });
    },
  );

  req.on("error", (err: Error) => {
    streamError = err;
    streamDone = true;
    signal$.notify();
  });

  const onAbort = () => {
    req.destroy();
    streamDone = true;
    signal$.notify();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  req.write(body);
  req.end();

  try {
    while (!streamDone || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
        continue;
      }
      if (streamError !== null) {
        yield { type: "error", error: `Connection failed: ${(streamError as Error).message}` };
        return;
      }
      if (streamDone) break;
      if (signal?.aborted) return;
      const ok = await signal$.wait(STREAM_IDLE_TIMEOUT_MS);
      if (!ok) {
        yield { type: "error", error: "Stream timed out: no data received for 2 minutes" };
        req.destroy();
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Robust signaling queue for bridging Node.js event callbacks to an async generator.
 */
class StreamSignal {
  private version = 0;
  private resolve: (() => void) | null = null;

  notify(): void {
    this.version++;
    const fn = this.resolve;
    this.resolve = null;
    fn?.();
  }

  async wait(timeoutMs: number): Promise<boolean> {
    const vBefore = this.version;
    return new Promise<boolean>((res) => {
      const timer = setTimeout(() => { this.resolve = null; res(false); }, timeoutMs);
      this.resolve = () => { clearTimeout(timer); this.resolve = null; res(true); };
      if (this.version !== vBefore) { clearTimeout(timer); this.resolve = null; res(true); }
    });
  }
}

/** Load Node.js http or https module (desktop only, bypasses CORS). */
function getHttpModule(protocol: string): typeof import("http") {
  const loader =
    (globalThis as unknown as { require?: (id: string) => unknown }).require ||
    (globalThis as unknown as { module?: { require?: (id: string) => unknown } }).module?.require;
  if (!loader) {
    throw new Error("Node.js http module is not available in this environment");
  }
  const moduleName = protocol === "https:" ? "https" : "http";
  return loader(moduleName) as typeof import("http");
}
