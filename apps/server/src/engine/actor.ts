import type { Character, Message, ModuleId, Session, TokenUsage, WorldState } from '@roleplay/shared';
import { z } from 'zod';
import { AppError } from '../errors';
import type { ChatTurn, ConversationInit, LLMProvider, ToolSpec } from '../llm/types';
import { DEFAULT_TUNING } from './context';
import { mentionedIds, recall, type RecallFocus } from './memory';
import { getModules, modulesKey } from './modules';
import { getPrompts } from './prompts';
import { StreamingStringField } from './streamingField';
import { toJsonSchema } from './tools';

/**
 * A character speaking for themselves.
 *
 * The game master knows everything, which is exactly what makes it a poor
 * actor: a character played from an all-seeing context leaks what they could
 * not know. Here one model call plays one character and is shown only what
 * that character has: who they are, what they remember, and what they can
 * perceive right now. The game master's notes, other people's secrets and
 * events they were not present for are simply not in the prompt.
 *
 * The actor only speaks. It never changes the world: when the exchange changes
 * something (the character acts, promises, or reveals something that matters),
 * it says so, and the game master rules on it and records it.
 */

export const RESPOND = 'respond';

const respondSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .describe('What you say, with anything you visibly do in *asterisks*. Only what the other person could see and hear.'),
  memory: z.string().optional().describe('What you will remember of this exchange, in your own words.'),
  importance: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('How much this exchange matters to you: 1 in passing, 3 worth retelling, 5 never forgotten.'),
  attitude: z.string().optional().describe('How you feel about them now, in a few words, if this exchange changed it.'),
  changes: z
    .string()
    .optional()
    .describe('Leave out for plain talk. Fill in when this exchange changes more than how the two of you feel: you do something (hand something over, leave, call for help, strike), you agree to or promise something, or you tell them something that matters to what they are after. Say what, in a sentence; the game master records it.'),
});

/** What every character says back, plus whatever the story's modules asked them for (see `GameModule.actor`). */
export type ActorReply = z.infer<typeof respondSchema> & Record<string, unknown>;

interface RespondTool {
  schema: z.ZodType<ActorReply>;
  spec: ToolSpec;
}

const respondTools = new Map<string, RespondTool>();

/**
 * `respond` for a story with these modules: the same call for every
 * character, with the fields modules add to it. Built once per set of
 * modules, so the tool a model is sent is byte-identical from turn to turn.
 */
function respondTool(modules: readonly ModuleId[]): RespondTool {
  const key = modulesKey(modules);
  let tool = respondTools.get(key);
  if (!tool) {
    const extra = Object.assign({}, ...getModules(modules).map((module) => module.actor?.fields ?? {})) as z.ZodRawShape;
    // The model is shown each module's field in full. The reply is checked
    // against the character's own fields only: a module reads its field for
    // itself, so that a slip there cannot cost the character their line.
    const anything = Object.fromEntries(Object.keys(extra).map((name) => [name, z.unknown().optional()]));
    tool = {
      schema: respondSchema.extend(anything) as unknown as z.ZodType<ActorReply>,
      spec: {
        name: RESPOND,
        description: 'Answer as your character. Call it exactly once.',
        inputSchema: toJsonSchema(respondSchema.extend(extra)),
      },
    };
    respondTools.set(key, tool);
  }
  return tool;
}

// How much the character is given to work with, besides the memories they recall.
const EXCHANGES_REPLAYED = 8;
const COMMON_KNOWLEDGE_ENTRIES = 20;
const PUBLIC_EVENTS_SHOWN = 12;

/** The last few things the player and this character said to each other, word for word. */
function conversationSoFar(messages: Message[], characterId: string): ChatTurn[] {
  const exchanges = new Map<number, { said?: string; reply?: string }>();
  for (const message of messages) {
    if (message.kind === 'player' && message.to === characterId) {
      exchanges.set(message.turn, { ...exchanges.get(message.turn), said: message.text });
    } else if (message.kind === 'dialogue' && message.characterId === characterId) {
      exchanges.set(message.turn, { ...exchanges.get(message.turn), reply: message.text });
    }
  }
  return [...exchanges.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, exchange]) => exchange.said && exchange.reply)
    .slice(-EXCHANGES_REPLAYED)
    .flatMap(([, exchange]): ChatTurn[] => [
      { role: 'user', text: exchange.said ?? '' },
      { role: 'assistant', text: exchange.reply ?? '' },
    ]);
}

/**
 * The world as this one character has it. Everything here is something they
 * would know or could perceive; anything else is left out rather than marked
 * secret, because a model cannot leak what it was never shown.
 */
export function characterView(
  world: WorldState,
  character: Character,
  said: string,
  memoriesRecalled: number = DEFAULT_TUNING.memoriesRecalled,
) {
  const player = world.playerId ? world.characters[world.playerId] : undefined;
  const place = character.locationId ? world.locations[character.locationId] : undefined;
  const alsoHere = Object.values(world.characters).filter(
    (other) => other.id !== character.id && !other.isPlayer && other.locationId === character.locationId,
  );

  const around = [player?.id, place?.id, ...alsoHere.map((other) => other.id)];
  const focus: RecallFocus = {
    cues: new Set(mentionedIds(world, said)),
    around: new Set(around.filter((id): id is string => Boolean(id))),
    turn: world.turn,
    query: said,
  };
  const nameOf = (id: string) => world.characters[id]?.name ?? id;

  // They know the speaker's name only if they have some memory of them.
  const met = player !== undefined && character.memories.some((memory) => memory.about.includes(player.id));

  const carrying = Object.values(world.items)
    .filter((item) => item.ownerId === character.id)
    .map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name));

  return {
    you: {
      name: character.name,
      ...(character.role ? { role: character.role } : {}),
      ...(character.description ? { description: character.description } : {}),
      ...(character.appearance ? { appearance: character.appearance } : {}),
      ...(character.personality ? { personality: character.personality } : {}),
      ...(character.voice ? { voice: character.voice } : {}),
      ...(character.goals ? { goals: character.goals } : {}),
      ...(character.secrets ? { secrets: character.secrets } : {}),
      ...(character.status ? { condition: character.status } : {}),
      ...(character.stats.length > 0 ? { stats: character.stats } : {}),
      ...(carrying.length > 0 ? { carrying } : {}),
    },
    your_memories: recall(character.memories, focus, memoriesRecalled).map((memory) => {
      const where = memory.locationId ? (world.locations[memory.locationId]?.name ?? '') : '';
      return {
        ...(memory.time ? { when: memory.time } : {}),
        ...(where ? { where } : {}),
        memory: memory.text,
        ...(memory.toldBy ? { told_to_you_by: nameOf(memory.toldBy) } : {}),
      };
    }),
    here_and_now: {
      place: place ? { name: place.name, ...(place.description ? { description: place.description } : {}) } : null,
      ...(world.scene.time ? { time: world.scene.time } : {}),
      ...(world.scene.weather ? { weather: world.scene.weather } : {}),
      // Of the others present: what shows, not what they are thinking.
      ...(alsoHere.length > 0
        ? {
            also_here: alsoHere.map((other) => ({
              name: other.name,
              ...(other.role ? { role: other.role } : {}),
              ...(other.status ? { doing: other.status } : {}),
            })),
          }
        : {}),
    },
    common_knowledge: Object.values(world.lore)
      .filter((entry) => !entry.hidden)
      .slice(-COMMON_KNOWLEDGE_ENTRIES)
      .map((entry) => ({ title: entry.title, content: entry.content })),
    public_events: (world.chronicle ?? [])
      .filter((entry) => !entry.secret && entry.public)
      .slice(-PUBLIC_EVENTS_SHOWN)
      .map((entry) => ({
        ...(entry.time ? { when: entry.time } : {}),
        title: entry.title,
        ...(entry.summary ? { summary: entry.summary } : {}),
        ...(entry.impact ? { impact: entry.impact } : {}),
      })),
    speaking_to_you: {
      name: met ? (player?.name ?? null) : null,
      met_before: met,
      ...(player?.status ? { condition: player.status } : {}),
      ...(character.attitude ? { how_you_feel_about_them: character.attitude } : {}),
    },
  };
}

export function buildActorInit(
  session: Session,
  character: Character,
  said: string,
  turn: number,
  memoriesRecalled: number = DEFAULT_TUNING.memoriesRecalled,
  /** The modules the story is being played with. None unless named: what a story lists is not what it is played with. */
  modules: readonly ModuleId[] = [],
): ConversationInit {
  const view = characterView(session.world, character, said, memoriesRecalled);
  const section = (tag: string, value: unknown) => `<${tag}>\n${JSON.stringify(value)}\n</${tag}>`;
  // What the story's modules show this character: the balance of power on a
  // sandbox board, how close they have grown to the player.
  const fromModules = getModules(modules).flatMap((module) => {
    const shown = module.shownToCharacter?.of(session.world, character.id);
    return module.shownToCharacter && shown !== undefined ? [section(module.shownToCharacter.tag, shown)] : [];
  });

  return {
    system: getPrompts(session.language).actorSystemFor(modules),
    history: conversationSoFar(session.messages, character.id),
    prompt: [
      section('you', view.you),
      section('your_memories', view.your_memories),
      section('here_and_now', view.here_and_now),
      ...(view.common_knowledge.length > 0 ? [section('common_knowledge', view.common_knowledge)] : []),
      ...(view.public_events.length > 0 ? [section('public_events', view.public_events)] : []),
      ...fromModules,
      section('speaking_to_you', view.speaking_to_you),
      `<they_say>\n${said}\n</they_say>`,
    ].join('\n\n'),
    tools: [respondTool(modules).spec],
    cacheKey: `rp:${session.id}:actor:${character.id}`,
    meta: {
      locale: session.language,
      kind: 'talk',
      turn,
      playerText: said,
      seed: session.seed,
      world: structuredClone(session.world),
      characterId: character.id,
    },
  };
}

export interface ActorHandlers {
  /** More of the reply, as it is written. */
  onDelta(text: string): void;
  /** What was streamed so far is void; the reply starts over. */
  onReset(): void;
  signal: AbortSignal;
}

// One attempt, one correction, one last try.
const MAX_ATTEMPTS = 3;

/** Has the character answer. Streams the reply and returns it with what they made of the exchange. */
export async function playCharacter(
  provider: LLMProvider,
  init: ConversationInit,
  handlers: ActorHandlers,
  usage: TokenUsage,
  /** The modules the story is being played with, which decide what the reply may carry. */
  modules: readonly ModuleId[] = [],
): Promise<ActorReply> {
  const { schema } = respondTool(modules);
  const conversation = provider.startConversation(init);
  const reminder = getPrompts(init.meta.locale).actorReminder;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let field = new StreamingStringField('text');
    let streamed = false;
    const reset = () => {
      if (streamed) handlers.onReset();
      streamed = false;
      field = new StreamingStringField('text');
    };

    const result = await conversation.step({
      signal: handlers.signal,
      // Plain text is not the reply unless it turns out to be all there is.
      onTextDelta: () => {},
      onToolInput: (call, fragment) => {
        if (call.name !== RESPOND) return;
        const text = field.push(fragment);
        if (!text) return;
        streamed = true;
        handlers.onDelta(text);
      },
      onStepReset: reset,
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.cachedInputTokens += result.usage.cachedInputTokens;

    if (result.stop === 'refusal') throw new AppError('refused', 'The model declined to speak for this character.');

    const call = result.toolCalls.find((candidate) => candidate.name === RESPOND);
    if (call && result.stop !== 'max_tokens') {
      const parsed = schema.safeParse(call.input);
      if (parsed.success) {
        // Whatever part did not stream (a provider that sends inputs whole) goes out now.
        if (!streamed) handlers.onDelta(parsed.data.text);
        return parsed.data;
      }
      reset();
      conversation.submitToolResults(
        result.toolCalls.map((other) => ({
          id: other.id,
          isError: true,
          content:
            other.id === call.id
              ? JSON.stringify({ error: 'invalid_input', issues: z.prettifyError(parsed.error), received: call.input })
              : `Unknown tool "${other.name}".`,
        })),
      );
      continue;
    }
    reset();

    // A model that just talks has still answered: take its words as the line.
    const spoken = result.text.trim();
    if (spoken && result.toolCalls.length === 0) {
      handlers.onDelta(spoken);
      return { text: spoken };
    }

    if (result.toolCalls.length > 0) {
      conversation.submitToolResults(
        result.toolCalls.map((other) => ({ id: other.id, isError: true, content: reminder })),
      );
    } else {
      conversation.addUserMessage(reminder);
    }
  }
  throw new AppError('empty_response', 'The character gave no answer.');
}
