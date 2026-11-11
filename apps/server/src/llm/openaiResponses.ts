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
 * OpenAI's Responses API (`POST /responses`), used for OpenAI's own endpoint.
 * Current OpenAI models only combine reasoning with function tools here, not
 * on Chat Completions, so this is the official path; Chat Completions
 * (openaiCompat.ts) stays for the many other servers that speak that format.
 */

export interface OpenAIResponsesOptions {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  /** Reasoning effort, in OpenAI's own names. null leaves it to the model. */
  effort: string | null;
  /** null leaves the length to the API. */
  maxOutputTokens: number | null;
}

/** An entry of the `input` array: a message, a function call, its output, or a reasoning item. */
type InputItem = Record<string, unknown>;

interface OutputItem extends InputItem {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type: string }[];
}

interface ResponseObject {
  status?: string;
  output?: OutputItem[];
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
  } | null;
}

interface StreamEvent {
  type: string;
  delta?: string;
  item_id?: string;
  item?: OutputItem;
  response?: ResponseObject;
  message?: string;
}

function parseArguments(raw: string | undefined): unknown {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // Not valid JSON: hand the raw text to tool validation, which rejects it
    // and tells the model what it sent.
    return { INVALID_JSON: raw };
  }
}

function stopReason(response: ResponseObject, hasToolCalls: boolean): StopReason {
  const reason = response.incomplete_details?.reason;
  if (reason === 'max_output_tokens') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  const refused = response.output?.some(
    (item) => item.type === 'message' && item.content?.some((part) => part.type === 'refusal'),
  );
  if (refused) return 'refusal';
  return hasToolCalls ? 'tool_use' : 'end';
}

class ResponsesConversation implements Conversation {
  private readonly options: OpenAIResponsesOptions;
  private readonly instructions: string;
  private readonly tools: unknown[];
  private readonly input: InputItem[];
  private readonly cacheKey: string | undefined;

  constructor(options: OpenAIResponsesOptions, init: ConversationInit) {
    this.options = options;
    this.instructions = init.system;
    this.cacheKey = init.cacheKey;
    this.input = [
      ...init.history.map((turn): InputItem => ({ role: turn.role, content: turn.text })),
      { role: 'user', content: init.prompt },
    ];
    this.tools = init.tools.map((spec) => ({
      type: 'function',
      name: spec.name,
      description: spec.description,
      parameters: spec.inputSchema,
      // Our schemas have optional fields, which strict mode does not allow;
      // inputs are validated by the engine instead.
      strict: false,
    }));
  }

  async step(handlers: StepHandlers): Promise<StepResult> {
    const { apiKey, baseUrl, model, effort, maxOutputTokens } = this.options;
    const url = endpointUrl(baseUrl, '/responses');
    const response = await send(url, {
      method: 'POST',
      headers: { ...requestHeaders(apiKey), Accept: 'text/event-stream' },
      body: JSON.stringify({
        model,
        instructions: this.instructions,
        input: this.input,
        tools: this.tools,
        stream: true,
        // Only sent when chosen: a model without reasoning rejects the setting.
        ...(effort ? { reasoning: { effort } } : {}),
        ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
        ...(this.cacheKey ? { prompt_cache_key: this.cacheKey } : {}),
        // Nothing is kept on OpenAI's side: the turn carries its own history,
        // including the model's reasoning, which comes back encrypted for that.
        store: false,
        include: ['reasoning.encrypted_content'],
      }),
      signal: handlers.signal,
    });
    if (!response.ok || !response.body) return failFromResponse(response, url, apiKey !== null);

    let text = '';
    let final: ResponseObject | undefined;
    // Argument fragments name their output item; the engine wants the call id.
    const calls = new Map<string, { id: string; name: string }>();

    try {
      for await (const data of readSseData(response.body)) {
        if (data === '[DONE]') break;
        const event = JSON.parse(data) as StreamEvent;
        switch (event.type) {
          case 'response.output_text.delta':
            if (event.delta) {
              text += event.delta;
              handlers.onTextDelta(event.delta);
            }
            break;
          case 'response.output_item.added':
            if (event.item?.type === 'function_call' && event.item.id) {
              calls.set(event.item.id, { id: event.item.call_id ?? event.item.id, name: event.item.name ?? '' });
            }
            break;
          case 'response.function_call_arguments.delta': {
            const call = event.item_id ? calls.get(event.item_id) : undefined;
            if (call && event.delta) handlers.onToolInput(call, event.delta);
            break;
          }
          case 'response.completed':
          case 'response.incomplete':
            final = event.response;
            break;
          case 'response.failed':
            throw new AppError('provider_error', event.response?.error?.message ?? 'The response failed.');
          case 'error':
            throw new AppError('provider_error', event.message ?? 'The provider reported an error.');
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (handlers.signal.aborted) throw new AppError('aborted', 'The request was cancelled.', { cause: err });
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError('provider_error', `The response stream broke: ${message}`, { cause: err });
    }
    if (!final) throw new AppError('provider_error', 'The response stream ended without a result.');

    // Everything the model produced goes back with the next request: its
    // function calls must be there to be answered, and its reasoning with them.
    const output = final.output ?? [];
    this.input.push(...output);

    const toolCalls: ToolCall[] = output
      .filter((item) => item.type === 'function_call')
      .map((item) => ({
        id: item.call_id ?? item.id ?? '',
        name: item.name ?? '',
        input: parseArguments(item.arguments),
      }));

    const cached = final.usage?.input_tokens_details?.cached_tokens ?? 0;
    const usage: TokenUsage = {
      ...NO_USAGE,
      inputTokens: final.usage?.input_tokens ?? 0,
      outputTokens: final.usage?.output_tokens ?? 0,
      cachedInputTokens: cached,
    };
    return { text, toolCalls, stop: stopReason(final, toolCalls.length > 0), usage };
  }

  submitToolResults(results: ToolResult[]): void {
    for (const result of results) {
      this.input.push({ type: 'function_call_output', call_id: result.id, output: result.content });
    }
  }

  addUserMessage(text: string): void {
    this.input.push({ role: 'user', content: text });
  }
}

export class OpenAIResponsesProvider implements LLMProvider {
  readonly kind = 'openai';
  private readonly options: OpenAIResponsesOptions;

  constructor(options: OpenAIResponsesOptions) {
    if (!options.model) throw new AppError('not_configured', 'No model is set for OpenAI.');
    this.options = options;
  }

  startConversation(init: ConversationInit): Conversation {
    return new ResponsesConversation(this.options, init);
  }
}
