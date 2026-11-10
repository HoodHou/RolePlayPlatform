import type { Locale, NewGameSeed } from '@roleplay/shared';
import { en } from './en';
import { zh } from './zh';

export interface PromptOptions {
  /** Whether the game master can have pictures painted this turn. */
  illustrations: boolean;
}

/** A character's reply to the player, and what that character says it changes. */
export interface Exchange {
  /** The character's name. */
  name: string;
  /** What the player said to them. */
  said: string;
  /** What they answered. */
  reply: string;
  /** What the exchange changes, by the character's account: something they do, promise or reveal. */
  changes: string;
}

/** Everything the models are told, in one story language. */
export interface PromptPack {
  /**
   * The game master's standing instructions. For a given set of options the
   * text must be byte-identical every time, so that it caches.
   */
  system(options: PromptOptions): string;
  /** Stands in for the player's message on the opening turn of the transcript. */
  openingMarker: string;
  /** The request that starts a new game. */
  opening(seed: NewGameSeed): string;
  /** Sent when a turn was narrated but nothing was recorded. */
  recordReminder: string;
  /** Sent when the model stopped without telling the player anything. */
  narrateReminder: string;
  /** Asks the game master to rule on and record what a conversation changed. */
  referee(exchange: Exchange): string;

  /** Instructions for a model playing one character in conversation. Byte-stable, like `system`. */
  actorSystem: string;
  /** Sent when the actor answered without using its tool or said nothing. */
  actorReminder: string;
}

const PACKS: Record<Locale, PromptPack> = { en, zh };

export function getPrompts(locale: Locale): PromptPack {
  return PACKS[locale];
}
