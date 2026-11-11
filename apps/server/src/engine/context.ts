import { GENERATION_DEFAULTS, type Message, type Session, type TurnRequest } from '@roleplay/shared';
import type { ChatTurn, ConversationInit } from '../llm/types';
import { gameMasterView } from './memory';
import { getPrompts, type Exchange, type PromptOptions } from './prompts';
import { getToolbox } from './tools';

/**
 * Builds what the game master sees for one turn.
 *
 * The model is not handed last turn's raw API exchange. Each turn starts fresh
 * from three things: fixed instructions, the story so far as plain text, and
 * the current world state. The world state is the source of truth, which is
 * why a turn can end the moment its tool calls are applied, and why old turns
 * can be dropped without the model losing track of the world.
 */

/** How much the models are given to work with. Set by the player in the AI settings. */
export interface Tuning {
  /** Past turns of story replayed to the game master. */
  historyTurns: number;
  /** Memories a character has in mind when they speak. */
  memoriesRecalled: number;
}

export const DEFAULT_TUNING: Tuning = {
  historyTurns: GENERATION_DEFAULTS.historyTurns,
  memoriesRecalled: GENERATION_DEFAULTS.memoriesRecalled,
};

export type ContextOptions = PromptOptions & Tuning;

interface TurnPair {
  turn: number;
  player: string;
  told: string[];
}

function collectTurnPairs(messages: Message[], nameOf: (characterId: string) => string): TurnPair[] {
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

  return [...turns.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, turn]) => turn.told.length > 0)
    .map(([turnNum, turn]) => ({ turn: turnNum, player: turn.player, told: turn.told }));
}

function historyWindowStart(pairCount: number, historyTurns: number): number {
  const chunk = Math.max(1, Math.floor(historyTurns / 3));
  const excess = pairCount - historyTurns;
  return excess > 0 ? Math.floor(excess / chunk) * chunk : 0;
}

/**
 * Past turns as user/assistant pairs: what the player did or said, then what
 * was told in reply. A line the player said to one character is marked with
 * who it was for, and a character's own answer with who gave it.
 *
 * At least `historyTurns` turns are replayed once there are that many. The
 * window moves in whole chunks rather than one turn at a time, so the
 * transcript prefix stays identical (and cached) for several turns in a row.
 */
export function buildHistory(
  messages: Message[],
  openingMarker: string,
  nameOf: (characterId: string) => string = (id) => id,
  historyTurns: number = DEFAULT_TUNING.historyTurns,
): ChatTurn[] {
  const pairs = collectTurnPairs(messages, nameOf);
  const start = historyWindowStart(pairs.length, historyTurns);

  return pairs.slice(start).flatMap((turn): ChatTurn[] => [
    { role: 'user', text: turn.player || openingMarker },
    { role: 'assistant', text: turn.told.join('\n\n') },
  ]);
}

export interface DroppedTurnsArchive {
  upToTurn: number;
  transcript: string;
  fallbackDigest: string;
}

/**
 * Finds turns that have slid out of `buildHistory`'s window and have not yet
 * been folded into `world.storySummary`.
 */
export function findDroppedTranscript(
  messages: Message[],
  openingMarker: string,
  nameOf: (characterId: string) => string = (id) => id,
  historyTurns: number = DEFAULT_TUNING.historyTurns,
  summarizedUpToTurn = 0,
): DroppedTurnsArchive | null {
  const pairs = collectTurnPairs(messages, nameOf);
  const start = historyWindowStart(pairs.length, historyTurns);
  if (start <= 0) return null;

  const dropped = pairs.slice(0, start).filter((entry) => entry.turn > summarizedUpToTurn);
  if (dropped.length === 0) return null;

  const transcript = dropped
    .map((entry) => {
      const action = entry.player || openingMarker;
      const outcome = entry.told.join('\n');
      return `[Turn ${entry.turn}]\nPlayer: ${action}\nStory: ${outcome}`;
    })
    .join('\n\n');

  const fallbackDigest = dropped
    .map((entry) => {
      const action = (entry.player || openingMarker).replace(/\s+/g, ' ').slice(0, 80);
      const outcome = entry.told.join(' ').replace(/\s+/g, ' ').slice(0, 140);
      return `[T${entry.turn}] ${action} -> ${outcome}`;
    })
    .join('\n');

  return {
    upToTurn: dropped[dropped.length - 1]!.turn,
    transcript,
    fallbackDigest,
  };
}

export function buildSummaryInit(session: Session, droppedTranscript: string): ConversationInit {
  const prompts = getPrompts(session.language);
  return {
    system: prompts.summarySystem,
    history: [],
    prompt: prompts.summarize(session.world.storySummary ?? '', droppedTranscript),
    tools: [],
    meta: {
      locale: session.language,
      kind: 'summary',
      turn: session.world.turn,
      playerText: '',
      seed: session.seed,
      world: structuredClone(session.world),
    },
  };
}

function gameMasterInit(
  session: Session,
  kind: 'start' | 'action' | 'referee',
  ask: string,
  playerText: string,
  turn: number,
  options: ContextOptions,
  characterId?: string,
): ConversationInit {
  const prompts = getPrompts(session.language);
  const { world } = session;
  // The game master watches several characters at once, so each gets fewer memories than an actor would.
  const perCharacter = Math.max(2, Math.round((options.memoriesRecalled * 2) / 3));
  const view = gameMasterView(world, playerText, perCharacter, options.modules);
  const state = `<world_state>\n${JSON.stringify(view)}\n</world_state>`;
  const nameOf = (id: string) => world.characters[id]?.name ?? id;

  return {
    system: prompts.system(options),
    history: buildHistory(session.messages, prompts.openingMarker, nameOf, options.historyTurns),
    prompt: `${state}\n\n${ask}`,
    tools: getToolbox(options).specs,
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
  options: ContextOptions,
): ConversationInit {
  if (request.kind === 'start') {
    return gameMasterInit(session, 'start', getPrompts(session.language).opening(session.seed), '', turn, options);
  }
  const ask = `<player_action>\n${request.text}\n</player_action>`;
  return gameMasterInit(session, 'action', ask, request.text, turn, options);
}

/**
 * The game master ruling on what a conversation changed.
 * The exchange is already the last entry of the transcript; the ask restates
 * it together with the one thing the transcript lacks, what the character
 * says it changes.
 */
export function buildRefereeInit(
  session: Session,
  characterId: string,
  exchange: Exchange,
  turn: number,
  options: ContextOptions,
): ConversationInit {
  const ask = getPrompts(session.language).referee(exchange);
  return gameMasterInit(session, 'referee', ask, exchange.said, turn, options, characterId);
}
