import type { Message, Session, TurnRequest } from '@roleplay/shared';
import type { ChatTurn, ConversationInit } from '../llm/types';
import { gameMasterView } from './memory';
import { getPrompts, type Exchange, type PromptOptions } from './prompts';
import { getToolSpecs } from './tools';

/**
 * Builds what the game master sees for one turn.
 *
 * The model is not handed last turn's raw API exchange. Each turn starts fresh
 * from three things: fixed instructions, the story so far as plain text, and
 * the current world state. The world state is the source of truth, which is
 * why a turn can end the moment its tool calls are applied, and why old turns
 * can be dropped without the model losing track of the world.
 */

// How much story to replay. The window moves in whole chunks rather than one
// turn at a time, so the transcript prefix stays identical (and cached) for
// several turns in a row.
const HISTORY_TURNS = 30;
const HISTORY_CHUNK = 10;

/**
 * Past turns as user/assistant pairs: what the player did or said, then what
 * was told in reply. A line the player said to one character is marked with
 * who it was for, and a character's own answer with who gave it.
 */
export function buildHistory(
  messages: Message[],
  openingMarker: string,
  nameOf: (characterId: string) => string = (id) => id,
): ChatTurn[] {
  const turns = new Map<number, { player: string; told: string[] }>();
  const at = (turn: number) => {
    let entry = turns.get(turn);
    if (!entry) turns.set(turn, (entry = { player: '', told: [] }));
    return entry;
  };

  for (const message of messages) {
    // Events and pictures are left out on purpose: their effects are already in the world state.
    if (message.kind === 'player') {
      at(message.turn).player = message.to ? `→ ${nameOf(message.to)}: ${message.text}` : message.text;
    } else if (message.kind === 'narration') {
      at(message.turn).told.push(message.text);
    } else if (message.kind === 'dialogue') {
      at(message.turn).told.push(`${message.characterName}: ${message.text}`);
    }
  }

  const pairs = [...turns.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, turn]) => turn.told.length > 0)
    .map(([, turn]) => turn);

  const excess = pairs.length - HISTORY_TURNS;
  const start = excess > 0 ? Math.floor(excess / HISTORY_CHUNK) * HISTORY_CHUNK : 0;

  return pairs.slice(start).flatMap((turn): ChatTurn[] => [
    { role: 'user', text: turn.player || openingMarker },
    { role: 'assistant', text: turn.told.join('\n\n') },
  ]);
}

function gameMasterInit(
  session: Session,
  kind: 'start' | 'action' | 'referee',
  ask: string,
  playerText: string,
  turn: number,
  options: PromptOptions,
  characterId?: string,
): ConversationInit {
  const prompts = getPrompts(session.language);
  const { world } = session;
  const state = `<world_state>\n${JSON.stringify(gameMasterView(world, playerText))}\n</world_state>`;

  return {
    system: prompts.system(options),
    history: buildHistory(session.messages, prompts.openingMarker, (id) => world.characters[id]?.name ?? id),
    prompt: `${state}\n\n${ask}`,
    tools: getToolSpecs(options),
    meta: {
      locale: session.language,
      kind,
      turn,
      playerText,
      seed: session.seed,
      world: structuredClone(world),
      ...(characterId ? { characterId } : {}),
    },
  };
}

/** The game master's turn: the opening of a story, or its answer to something the player does. */
export function buildTurnInit(
  session: Session,
  request: Extract<TurnRequest, { kind: 'start' | 'action' }>,
  turn: number,
  options: PromptOptions,
): ConversationInit {
  if (request.kind === 'start') {
    return gameMasterInit(session, 'start', getPrompts(session.language).opening(session.seed), '', turn, options);
  }
  const ask = `<player_action>\n${request.text}\n</player_action>`;
  return gameMasterInit(session, 'action', ask, request.text, turn, options);
}

/**
 * The game master ruling on what a character does after answering the player.
 * The exchange is already the last entry of the transcript; the ask restates
 * it together with the one thing the transcript lacks, what the character
 * means to do.
 */
export function buildRefereeInit(
  session: Session,
  characterId: string,
  exchange: Exchange,
  turn: number,
  options: PromptOptions,
): ConversationInit {
  const ask = getPrompts(session.language).referee(exchange);
  return gameMasterInit(session, 'referee', ask, exchange.said, turn, options, characterId);
}
