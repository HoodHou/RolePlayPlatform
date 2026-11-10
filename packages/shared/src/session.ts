import type { ApiError } from './api';
import type { WorldEvent } from './events';
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
  subject: ImageSubject;
  /** The character, location or item pictured; null for a scene. */
  targetId: string | null;
  /** Why it failed, when it did. */
  error?: ApiError;
}

export type Message = PlayerMessage | NarrationMessage | EventMessage | ImageMessage;

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
  world: WorldState;
  messages: Message[];
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
