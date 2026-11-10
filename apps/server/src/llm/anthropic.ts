import Anthropic from '@anthropic-ai/sdk';
import type { Effort, TokenUsage } from '@roleplay/shared';
import { AppError } from '../errors';
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

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Message = Anthropic.Beta.BetaMessage;
type Tool = Anthropic.Beta.BetaTool;

export interface AnthropicOptions {
  /** A key saved in the app. When null the SDK resolves credentials from the environment. */
  apiKey: string | null;
  /** Whether any key is known at all; decides how an auth failure is reported. */
  hasKey: boolean;
  baseUrl: string;
  model: string;
  effort: Effort | null;
}

// Streaming keeps long generations clear of HTTP timeouts, so the cap can be generous.
const MAX_OUTPUT_TOKENS = 64_000;

// Models that can hand a declined request to a fallback model server-side.
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const MAX_BAD_JSON_RETRIES = 2;

/** Proxies and gateways may not know newer request fields, so those go to Anthropic's own API only. */
function isOfficialEndpoint(baseUrl: string): boolean {
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === 'api.anthropic.com';
  } catch {
    return false;
  }
}

function translateError(err: unknown, hasKey: boolean): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Anthropic.APIUserAbortError) {
    return new AppError('aborted', 'The request was cancelled.', { cause: err });
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AppError(hasKey ? 'auth_failed' : 'not_configured', err.message, { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError('rate_limited', err.message, { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return new AppError('provider_error', err.message, { cause: err });
  }
  // Not an API response: the request never left, which without a key means no credentials.
  const message = err instanceof Error ? err.message : String(err);
  return new AppError(hasKey ? 'provider_error' : 'not_configured', message, { cause: err });
}

function mapStop(reason: Message['stop_reason']): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'end';
  }
}

function addUsage(total: TokenUsage, usage: Message['usage']): void {
  const cached = usage.cache_read_input_tokens ?? 0;
  total.inputTokens += usage.input_tokens + cached + (usage.cache_creation_input_tokens ?? 0);
  total.outputTokens += usage.output_tokens;
  total.cachedInputTokens += cached;
}

class AnthropicConversation implements Conversation {
  private readonly client: Anthropic;
  private readonly options: AnthropicOptions;
  private readonly system: string;
  private readonly tools: Tool[];
  private readonly messages: MessageParam[];
  private readonly officialEndpoint: boolean;
  private readonly effort: Effort | null;

  constructor(client: Anthropic, options: AnthropicOptions, init: ConversationInit) {
    this.client = client;
    this.options = options;
    this.system = init.system;
    // A quick answer thinks less. Only where effort is in use at all: a null
    // setting means the model does not take the parameter.
    this.effort = init.pace === 'quick' && options.effort ? 'low' : options.effort;
    this.officialEndpoint = isOfficialEndpoint(options.baseUrl);

    this.tools = init.tools.map((spec) => ({
      name: spec.name,
      description: spec.description,
      input_schema: spec.inputSchema as Tool['input_schema'],
      // Stream tool input as it is written. The engine validates inputs either way.
      ...(this.officialEndpoint ? { eager_input_streaming: true } : {}),
    }));

    // The history only grows from turn to turn, so a cache breakpoint on its last
    // entry lets the next turn reuse everything before this turn's prompt.
    const lastHistory = init.history.length - 1;
    this.messages = init.history.map((turn, index): MessageParam =>
      index === lastHistory
        ? {
            role: turn.role,
            content: [{ type: 'text', text: turn.text, cache_control: { type: 'ephemeral' } }],
          }
        : { role: turn.role, content: turn.text },
    );
    this.messages.push({ role: 'user', content: init.prompt });
  }

  private createStream(signal: AbortSignal) {
    const { model } = this.options;
    const effort = this.effort;
    // Role-play wanders into dark material now and then; where the model supports
    // it, let the API retry a declined request on its default fallback model.
    const useFallbacks = this.officialEndpoint && FALLBACK_MODELS.has(model);

    return this.client.beta.messages.stream(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: [{ type: 'text', text: this.system, cache_control: { type: 'ephemeral' } }],
        messages: this.messages,
        tools: this.tools,
        // Caches up to the newest block, which covers the tool loop within a turn.
        cache_control: { type: 'ephemeral' },
        ...(effort ? { output_config: { effort } } : {}),
        ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
  }

  async step(handlers: StepHandlers): Promise<StepResult> {
    const usage: TokenUsage = { ...NO_USAGE };
    let text = '';
    let badJson = 0;

    for (;;) {
      const stream = this.createStream(handlers.signal);
      stream.on('text', (delta) => {
        text += delta;
        handlers.onTextDelta(delta);
      });
      // Tool inputs stream as JSON fragments per content block; pass them on with the call they belong to.
      const open = new Map<number, { id: string; name: string }>();
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          open.set(event.index, { id: event.content_block.id, name: event.content_block.name });
        } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
          const call = open.get(event.index);
          if (call) handlers.onToolInput(call, event.delta.partial_json);
        }
      });

      let message: Message;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        // A tool input that is not JSON at all rejects here rather than as an API
        // error. Re-run the step a couple of times; everything else is fatal.
        if (err instanceof Anthropic.APIError || ++badJson > MAX_BAD_JSON_RETRIES) {
          throw translateError(err, this.options.hasKey);
        }
        text = '';
        handlers.onStepReset();
        continue;
      }

      addUsage(usage, message.usage);
      // Keep the whole content, thinking blocks included: the API expects them back unchanged.
      this.messages.push({ role: 'assistant', content: message.content });
      if (message.stop_reason === 'pause_turn') continue;

      const toolCalls: ToolCall[] = [];
      for (const block of message.content) {
        if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
      return { text, toolCalls, stop: mapStop(message.stop_reason), usage };
    }
  }

  submitToolResults(results: ToolResult[]): void {
    // All results of one step go back in a single user message.
    this.messages.push({
      role: 'user',
      content: results.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.id,
        content: result.content,
        is_error: result.isError,
      })),
    });
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: 'user', content: text });
  }
}

export class AnthropicProvider implements LLMProvider {
  readonly kind = 'anthropic';
  private readonly client: Anthropic;
  private readonly options: AnthropicOptions;

  constructor(options: AnthropicOptions) {
    this.options = options;
    this.client = new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
  }

  startConversation(init: ConversationInit): Conversation {
    return new AnthropicConversation(this.client, this.options, init);
  }
}
