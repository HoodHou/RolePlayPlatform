import type { Message, Session, TurnRequest } from '@roleplay/shared';
import type { ChatTurn, ConversationInit } from '../llm/types';
import { getPrompts, type PromptOptions } from './prompts';
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

/** Past turns as user/assistant pairs: what the player did, then what was narrated. */
export function buildHistory(messages: Message[], openingMarker: string): ChatTurn[] {
  const turns = new Map<number, { player: string; narration: string[] }>();
  for (const message of messages) {
    // Events and pictures are left out on purpose: their effects are already in the world state.
    if (message.kind !== 'player' && message.kind !== 'narration') continue;
    let turn = turns.get(message.turn);
    if (!turn) turns.set(message.turn, (turn = { player: '', narration: [] }));
    if (message.kind === 'player') turn.player = message.text;
    else turn.narration.push(message.text);
  }

  const pairs = [...turns.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, turn]) => turn.narration.length > 0)
    .map(([, turn]) => turn);

  const excess = pairs.length - HISTORY_TURNS;
  const start = excess > 0 ? Math.floor(excess / HISTORY_CHUNK) * HISTORY_CHUNK : 0;

  return pairs.slice(start).flatMap((turn): ChatTurn[] => [
    { role: 'user', text: turn.player || openingMarker },
    { role: 'assistant', text: turn.narration.join('\n\n') },
  ]);
}

export function buildTurnInit(
  session: Session,
  request: TurnRequest,
  turn: number,
  options: PromptOptions,
): ConversationInit {
  const prompts = getPrompts(session.language);
  const playerText = request.kind === 'action' ? request.text : '';

  const state = `<world_state>\n${JSON.stringify(session.world)}\n</world_state>`;
  const ask =
    request.kind === 'start'
      ? prompts.opening(session.seed)
      : `<player_action>\n${playerText}\n</player_action>`;

  return {
    system: prompts.system(options),
    history: buildHistory(session.messages, prompts.openingMarker),
    prompt: `${state}\n\n${ask}`,
    tools: getToolSpecs(options),
    meta: {
      locale: session.language,
      kind: request.kind,
      turn,
      playerText,
      seed: session.seed,
      world: structuredClone(session.world),
    },
  };
}
