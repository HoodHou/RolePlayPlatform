import type { TokenUsage } from '@roleplay/shared';
import { AppError } from '../errors';
import { endpointUrl, failFromResponse, requestHeaders, send } from './openaiHttp';
import { readSseData } from './sse';
import {
  NO_USAGE,
  type Conversation,
  type ConversationInit,
  type LLMProvider,
  type StepHandlers,
  type StepResult,
  type StopReason,
  type ToolCall,
  type ToolResult,
} from './types';

/**
 * Chat Completions over plain HTTP, for any endpoint that speaks the OpenAI
 * wire format: a company gateway, DeepSeek, OpenRouter, Ollama, vLLM, and
 * Google's Gemini through its OpenAI-compatible endpoint. Plain fetch keeps it
 * independent of any one vendor's SDK.
 */

export interface OpenAICompatOptions {
  /** Which connection this is, for error messages and the provider badge. */
  kind: 'gemini' | 'custom';
  apiKey: string | null;
  baseUrl: string;
  model: string;
  /** Sent as `reasoning_effort` when set. null sends nothing: many servers do not know the field. */
  effort: string | null;
  /** null leaves sampling to the server. */
  temperature: number | null;
  /** null leaves the length to the server. */
  maxOutputTokens: number | null;
}

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  /**
   * Whatever else the server attached to the call. Gemini puts a thought
   * signature here and rejects the next request unless it is sent back.
   */
  extra_content?: unknown;
}

type WireMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: WireToolCall[];
      reasoning_content?: string;
      extra_content?: unknown;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

interface WireChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      extra_content?: unknown;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
        extra_content?: unknown;
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  } | null;
  error?: { message?: string };
}

function mapStop(finishReason: string | null, hasToolCalls: boolean): StopReason {
  if (finishReason === 'length') return 'max_tokens';
  if (finishReason === 'content_filter') return 'refusal';
  // Some servers report "stop" even when the message carries tool calls.
  return hasToolCalls ? 'tool_use' : 'end';
}

function parseArguments(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // Not valid JSON: hand the raw text to tool validation, which rejects it
    // and tells the model what it sent.
    return { INVALID_JSON: raw };
  }
}

class OpenAICompatConversation implements Conversation {
  private readonly options: OpenAICompatOptions;
  private readonly messages: WireMessage[];
  private readonly tools: unknown[];

  constructor(options: OpenAICompatOptions, init: ConversationInit) {
    this.options = options;
    this.messages = [
      { role: 'system', content: init.system },
      ...init.history.map((turn): WireMessage => ({ role: turn.role, content: turn.text })),
      { role: 'user', content: init.prompt },
    ];
    this.tools = init.tools.map((spec) => ({
      type: 'function',
      function: { name: spec.name, description: spec.description, parameters: spec.inputSchema },
    }));
  }

  private async request(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const { apiKey, baseUrl, model, effort, temperature, maxOutputTokens } = this.options;
    const url = endpointUrl(baseUrl, '/chat/completions');

    const response = await send(url, {
      method: 'POST',
      headers: { ...requestHeaders(apiKey), Accept: 'text/event-stream' },
      body: JSON.stringify({
        model,
        messages: this.messages,
        tools: this.tools,
        stream: true,
        stream_options: { include_usage: true },
        // Optional knobs go out only when chosen, so a server that does not
        // know one of them is never sent it by default.
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(temperature !== null ? { temperature } : {}),
        ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
      }),
      signal,
    });
    if (!response.ok || !response.body) return failFromResponse(response, url, apiKey !== null);
    return response.body;
  }

  async step(handlers: StepHandlers): Promise<StepResult> {
    const body = await this.request(handlers.signal);

    let text = '';
    let reasoning = '';
    let extra: unknown;
    let finishReason: string | null = null;
    const usage: TokenUsage = { ...NO_USAGE };
    const calls: WireToolCall[] = [];

    try {
      for await (const data of readSseData(body)) {
        if (data === '[DONE]') break;
        const chunk = JSON.parse(data) as WireChunk;
        if (chunk.error) throw new AppError('provider_error', chunk.error.message ?? 'Provider error');

        if (chunk.usage) {
          const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
          usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
          usage.outputTokens = chunk.usage.completion_tokens ?? 0;
          usage.cachedInputTokens = cached;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (!delta) continue;
        if (delta.reasoning_content) reasoning += delta.reasoning_content;
        if (delta.extra_content !== undefined) extra = delta.extra_content;
        if (delta.content) {
          text += delta.content;
          handlers.onTextDelta(delta.content);
        }
        // A tool call arrives in pieces: id and name first, then argument fragments.
        for (const piece of delta.tool_calls ?? []) {
          // Servers that omit the index start a new call whenever an id shows up.
          const index = piece.index ?? (piece.id ? calls.length : Math.max(calls.length - 1, 0));
          const call = (calls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
          // Servers that send no ids still need each call told apart within the turn.
          call.id ||= piece.id || `call_${this.messages.length}_${index}`;
          if (piece.extra_content !== undefined) call.extra_content = piece.extra_content;
          if (piece.function?.name) call.function.name += piece.function.name;
          if (piece.function?.arguments) {
            call.function.arguments += piece.function.arguments;
            handlers.onToolInput({ id: call.id, name: call.function.name }, piece.function.arguments);
          }
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (handlers.signal.aborted) throw new AppError('aborted', 'The request was cancelled.', { cause: err });
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError('provider_error', `The response stream broke: ${message}`, { cause: err });
    }

    const wireCalls = calls.filter(Boolean);
    // The assistant turn goes back exactly as it came, extras included: some
    // models check their own reasoning or signatures on the next request.
    this.messages.push({
      role: 'assistant',
      content: text || null,
      ...(wireCalls.length > 0 ? { tool_calls: wireCalls } : {}),
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(extra !== undefined ? { extra_content: extra } : {}),
    });

    const toolCalls: ToolCall[] = wireCalls.map((call) => ({
      id: call.id,
      name: call.function.name,
      input: parseArguments(call.function.arguments),
    }));
    return { text, toolCalls, stop: mapStop(finishReason, toolCalls.length > 0), usage };
  }

  submitToolResults(results: ToolResult[]): void {
    for (const result of results) {
      this.messages.push({ role: 'tool', tool_call_id: result.id, content: result.content });
    }
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: 'user', content: text });
  }
}

export class OpenAICompatProvider implements LLMProvider {
  readonly kind: 'gemini' | 'custom';
  private readonly options: OpenAICompatOptions;

  constructor(options: OpenAICompatOptions) {
    if (!options.baseUrl) throw new AppError('not_configured', 'The custom API has no base URL yet.');
    if (!options.model) throw new AppError('not_configured', `No model is set for the ${options.kind} connection.`);
    this.kind = options.kind;
    this.options = options;
  }

  startConversation(init: ConversationInit): Conversation {
    return new OpenAICompatConversation(this.options, init);
  }
}
