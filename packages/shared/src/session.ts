import type { ApiError, TokenUsage } from './api';
import type { WorldEvent } from './events';
import type { ModuleId } from './modules';
import type { Locale, WorldState } from './world';

interface MessageBase {
  id: string;
  /** The turn this message belongs to (1 = opening scene). */
  turn: number;
  createdAt: string;
}

/** What the player typed. */
export interface PlayerMessage extends MessageBase {
  kind: 'player';
  text: string;
  /** Set when this was said to one character directly (a `talk` turn): that character's id. */
  to?: string;
}

/**
 * A character speaking for themselves, in answer to the player. Unlike
 * narration, it is written from that character's own knowledge and memory.
 * Text is speech, with anything they visibly do in *asterisks*.
 */
export interface DialogueMessage extends MessageBase {
  kind: 'dialogue';
  characterId: string;
  /** Their name when they said it, so the line still reads right if they are later removed. */
  characterName: string;
  text: string;
}

/** Prose from the game master. Light markdown: paragraphs, *emphasis*, quoted speech. */
export interface NarrationMessage extends MessageBase {
  kind: 'narration';
  text: string;
}

/** A world change worth telling the player about. */
export interface EventMessage extends MessageBase {
  kind: 'event';
  event: WorldEvent;
}

export const IMAGE_SUBJECTS = ['scene', 'character', 'location', 'item'] as const;
export type ImageSubject = (typeof IMAGE_SUBJECTS)[number];

/**
 * A picture the game master asked for. It enters the log as `pending` the
 * moment it is requested and is sent again, same id, once it is `ready` or
 * `failed`.
 */
export interface ImageMessage extends MessageBase {
  kind: 'image';
  status: 'pending' | 'ready' | 'failed';
  /** Path on this server once ready, e.g. `/api/images/<session>/<file>`. */
  url: string | null;
  caption: string;
  /** Original visual description from the game master, preserved so a picture can be retried or repainted. */
  prompt?: string;
  subject: ImageSubject;
  /** The character, location or item pictured; null for a scene. */
  targetId: string | null;
  /** Why it failed, when it did. */
  error?: ApiError;
}

export type Message = PlayerMessage | NarrationMessage | DialogueMessage | EventMessage | ImageMessage;

/** Engine checkpoint at the end of a turn, used for undo, reroll and branching. */
export interface TurnSnapshot {
  turn: number;
  world: WorldState;
  modules: ModuleId[];
  modulesAuto: boolean;
}

/** Cumulative and most-recent token counters for a session. */
export interface SessionUsage extends TokenUsage {
  lastTurn?: TokenUsage;
}

/** What the player asked for when starting a game. Any field may be empty. */
export interface NewGameSeed {
  premise: string;
  playerName: string;
  playerConcept: string;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Language the story is told in. Independent of the UI language. */
  language: Locale;
  seed: NewGameSeed;
  /**
   * The play modules this story has. One the player has since unsubscribed
   * from stays listed but is not offered until they subscribe again.
   */
  modules: ModuleId[];
  /**
   * True while the choice of modules is the game master's: every subscribed
   * module is on offer until it has played a story turn through to the end,
   * and from then on the story keeps the ones it chose in that turn's record
   * (see `CreateSessionRequest.modules`).
   */
  modulesAuto: boolean;
  world: WorldState;
  messages: Message[];
  /** Engine checkpoints keyed by turn, oldest first, capped to keep saves compact. */
  snapshots?: TurnSnapshot[];
  /** Turn numbers with saved checkpoints, sent when `snapshots` are omitted on slim client fetches. */
  snapshotTurns?: number[];
  /** Token usage accumulated across this session. */
  usage?: SessionUsage;
}

export interface SessionSummary {
  id: string;
  /** World title once the game master has named it, otherwise empty. */
  title: string;
  premise: string;
  language: Locale;
  turn: number;
  createdAt: string;
  updatedAt: string;
}
