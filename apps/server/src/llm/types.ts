import type { Locale, NewGameSeed, ProviderKind, TokenUsage, WorldState } from '@roleplay/shared';

/**
 * Provider-neutral model interface. A provider only translates to and from its
 * wire format; the turn loop and all game rules live in the engine.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the tool's input object. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Plain facts about the turn, for providers that do not read prompts (the mock). */
export interface TurnMeta {
  locale: Locale;
  /**
   * `start` and `action` are the game master's turns. `talk` is one character
   * answering the player for themselves. `referee` is the game master ruling
   * on what that character then does.
   */
  kind: 'start' | 'action' | 'talk' | 'referee' | 'summary' | 'architect';
  turn: number;
  playerText: string;
  seed: NewGameSeed;
  /** The world as the turn begins. Read-only. */
  world: WorldState;
  /** For `talk` and `referee`: the character concerned. */
  characterId?: string;
}

export interface ConversationInit {
  /** Stable across turns: the game master's instructions. */
  system: string;
  /** Earlier turns as plain text, oldest first. Only grows, so it caches well. */
  history: ChatTurn[];
  /** This turn's input: current world state and what the player did. */
  prompt: string;
  tools: ToolSpec[];
  meta: TurnMeta;
  /** Optional stable routing key to maximize provider-side prompt prefix cache hits. */
  cacheKey?: string;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';

export interface StepHandlers {
  onTextDelta(delta: string): void;
  /**
   * A tool call's input as it is being written: raw JSON fragments, in order.
   * Lets the engine show long inputs (the narration) before the call is complete.
   * Providers that only get whole inputs never call this.
   */
  onToolInput(call: { id: string; name: string }, fragment: string): void;
  /** Everything streamed so far in this step is void; the step is being re-run. */
  onStepReset(): void;
  signal: AbortSignal;
}

export interface StepResult {
  text: string;
  toolCalls: ToolCall[];
  stop: StopReason;
  usage: TokenUsage;
}

/** One turn's exchange with the model, kept in the provider's own message format. */
export interface Conversation {
  /** Runs the model once, streaming its text. */
  step(handlers: StepHandlers): Promise<StepResult>;
  /** Answers the tool calls of the last step; the next step continues from there. */
  submitToolResults(results: ToolResult[]): void;
  /** Adds a note from the engine after a step that ended without tool calls. */
  addUserMessage(text: string): void;
}

export interface LLMProvider {
  readonly kind: ProviderKind;
  startConversation(init: ConversationInit): Conversation;
}

export const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
