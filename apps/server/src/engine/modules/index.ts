import { MODULE_CATEGORY, MODULE_IDS, type Locale, type ModuleId, type ModuleLibraryEntry, type Session } from '@roleplay/shared';
import { toJsonSchema } from '../toolKit';
import { bondsModule } from './bonds';
import { calendarModule } from './calendar';
import { clocksModule } from './clocks';
import { combatModule } from './combat';
import { diceModule } from './dice';
import { oracleModule } from './oracle';
import { sandboxModule } from './sandbox';
import type { GameModule } from './types';

export type { GameModule } from './types';

const MODULES: Record<ModuleId, GameModule> = {
  dice: diceModule,
  combat: combatModule,
  oracle: oracleModule,
  clocks: clocksModule,
  calendar: calendarModule,
  bonds: bondsModule,
  sandbox: sandboxModule,
};

/** The modules with these ids, in one fixed order whatever order they are asked for in. */
export function getModules(ids: readonly ModuleId[]): GameModule[] {
  return MODULE_IDS.filter((id) => ids.includes(id)).map((id) => MODULES[id]);
}

/** A set of modules as a short string: the key prompts and tool lists are cached under. */
export function modulesKey(ids: readonly ModuleId[]): string {
  return getModules(ids)
    .map((module) => module.id)
    .join('+');
}

/** Ids in the fixed order, without repeats or strangers. */
export function normalizeModules(ids: readonly string[]): ModuleId[] {
  return MODULE_IDS.filter((id) => ids.includes(id));
}

/**
 * The modules a story can actually be played with: the ones it has that the
 * player still subscribes to. This is the one gate every turn goes through, so
 * a module nobody subscribed to is never offered, whatever a save says.
 */
export function playableModules(session: Session, subscribed: readonly ModuleId[]): ModuleId[] {
  return MODULE_IDS.filter((id) => session.modules.includes(id) && subscribed.includes(id));
}

/**
 * Ends the game master's choice of modules. A story that left the choice to it
 * was played with every subscribed module on offer; from here on it keeps the
 * ones the game master asked for in its record, and whatever it actually set
 * up. Without a word from the game master, each module's own default decides.
 */
export function settleModules(session: Session, offered: readonly ModuleId[], chosen: readonly ModuleId[] | undefined): void {
  if (!session.modulesAuto) return;
  session.modulesAuto = false;
  const { modules: states } = session.world;
  const kept = getModules(offered)
    .filter((module) => (module.id in states && states[module.id as keyof typeof states] !== undefined) || (chosen ? chosen.includes(module.id) : module.keptWhenUnused))
    .map((module) => module.id);
  // A module the story lists but the player was not subscribed to was never on offer: it is not the game master's to drop.
  const notOffered = session.modules.filter((id) => !offered.includes(id));
  session.modules = normalizeModules([...notOffered, ...kept]);
}

// Rough weights: English prose and JSON run about four characters to a token,
// Chinese about one and a half.
function estimateTokens(text: string): number {
  let ascii = 0;
  for (const char of text) if (char.charCodeAt(0) < 128) ascii++;
  return Math.round(ascii / 4 + (text.length - ascii) / 1.5);
}

/** What a module adds to every request of a story that has it on: its instructions and its schemas. */
function promptCost(module: GameModule, locale: Locale): number {
  const schemas = [
    ...module.tools.map(({ spec }) => JSON.stringify(spec)),
    ...(module.record ? [JSON.stringify(toJsonSchema(module.record.schema))] : []),
  ];
  return estimateTokens(module.guide[locale]) + estimateTokens(schemas.join(''));
}

/** Every module as the library lists it. */
export function listLibrary(subscribed: readonly ModuleId[]): ModuleLibraryEntry[] {
  return MODULE_IDS.map((id) => {
    const module = MODULES[id];
    return {
      id,
      category: MODULE_CATEGORY[id],
      subscribed: subscribed.includes(id),
      tools: module.tools.map(({ spec }) => spec.name),
      keepsRecords: module.record !== undefined,
      reachesCharacters: module.actor !== undefined || module.shownToCharacter !== undefined,
      hasPanel: module.hasPanel,
      promptTokens: { en: promptCost(module, 'en'), zh: promptCost(module, 'zh') },
    };
  });
}
