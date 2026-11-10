import type { Locale } from '@roleplay/shared';
import { getModules, modulesKey } from '../modules';
import type { PromptOptions } from './index';

/** The pieces a story language supplies for the game master's instructions. */
export interface SystemParts {
  /** Everything up to how a turn is run. */
  intro: string;
  /**
   * How a turn is run, as numbered steps. With `instruments`, the first step is
   * to use a module's tool before telling the story.
   */
  running(instruments: boolean): string;
  /** Building the world, characters, narration. */
  rest: string;
  /** Opens the section on play modules; each module's own guide follows it. */
  modules: string;
  /** Closes that section on the turn in which the choice of modules is the game master's. */
  choosing: string;
  illustrations: string;
  language: string;
}

/**
 * Puts the game master's instructions together for a set of options. Each
 * combination is assembled once and reused, so the text is byte-identical from
 * turn to turn and caches.
 */
export function assembleSystem(parts: SystemParts, locale: Locale): (options: PromptOptions) => string {
  const assembled = new Map<string, string>();
  return (options) => {
    const choosing = options.choosing === true && options.modules.length > 0;
    const key = `${modulesKey(options.modules)}|${options.illustrations ? 'pictures' : 'plain'}|${choosing ? 'choosing' : 'set'}`;
    let text = assembled.get(key);
    if (text === undefined) {
      const modules = getModules(options.modules);
      text = [
        parts.intro,
        parts.running(modules.some((module) => module.tools.length > 0)),
        parts.rest,
        ...(modules.length > 0 ? [parts.modules, ...modules.map((module) => module.guide[locale])] : []),
        ...(choosing ? [parts.choosing] : []),
        ...(options.illustrations ? [parts.illustrations] : []),
        parts.language,
      ].join('\n\n');
      assembled.set(key, text);
    }
    return text;
  };
}
