import type { Locale, NewGameSeed } from '@roleplay/shared';
import { en } from './en';
import { zh } from './zh';

export interface PromptOptions {
  /** Whether the game master has a drawing tool this turn. */
  illustrations: boolean;
}

/** Everything the game master is told, in one story language. */
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
  /** Sent when a turn was narrated but nothing was recorded with tools. */
  recordReminder: string;
  /** Sent when the model stopped without telling the player anything. */
  narrateReminder: string;
}

const PACKS: Record<Locale, PromptPack> = { en, zh };

export function getPrompts(locale: Locale): PromptPack {
  return PACKS[locale];
}
