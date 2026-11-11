import {
  MODULE_CATEGORY,
  MODULE_IDS,
  type Locale,
  type ModuleId,
  type ModuleLibraryEntry,
  type PluginManifest,
  type Session,
} from '@roleplay/shared';
import { toJsonSchema } from '../toolKit';
import { bondsModule } from './bonds';
import { calendarModule } from './calendar';
import { clocksModule } from './clocks';
import { cluesModule } from './clues';
import { combatModule } from './combat';
import { courtModule } from './court';
import { deckModule } from './deck';
import { diceModule } from './dice';
import { domainModule } from './domain';
import { espionageModule } from './espionage';
import { lineageModule } from './lineage';
import { marketModule } from './market';
import { oracleModule } from './oracle';
import { compilePluginManifest, type CompiledPlugin } from './plugins';
import { progressionModule } from './progression';
import { reputationModule } from './reputation';
import { sandboxModule } from './sandbox';
import { travelModule } from './travel';
import type { GameModule } from './types';

export type { GameModule, ModuleOperationOutcome } from './types';
export { compilePluginManifest, PluginStore, pluginManifestSchema, type CompiledPlugin } from './plugins';

const BUILTIN_MODULES: Record<ModuleId, GameModule> = {
  dice: diceModule,
  combat: combatModule,
  oracle: oracleModule,
  clocks: clocksModule,
  calendar: calendarModule,
  bonds: bondsModule,
  sandbox: sandboxModule,
  market: marketModule,
  clues: cluesModule,
  travel: travelModule,
  deck: deckModule,
  reputation: reputationModule,
  court: courtModule,
  lineage: lineageModule,
  domain: domainModule,
  espionage: espionageModule,
  progression: progressionModule,
};

/** User-installed external plugins, keyed by plugin id. */
const externalPlugins = new Map<string, CompiledPlugin>();

/** Registers or replaces an external plugin in the active module registry. */
export function registerPlugin(rawOrCompiled: unknown | CompiledPlugin): CompiledPlugin {
  const compiled =
    rawOrCompiled && typeof rawOrCompiled === 'object' && 'module' in rawOrCompiled && 'manifest' in rawOrCompiled
      ? (rawOrCompiled as CompiledPlugin)
      : compilePluginManifest(rawOrCompiled);
  externalPlugins.set(compiled.manifest.id, compiled);
  return compiled;
}

/** Removes an external plugin from the active module registry. */
export function unregisterPlugin(id: string): boolean {
  return externalPlugins.delete(id);
}

/** Clears all external plugins from the registry. */
export function clearPlugins(): void {
  externalPlugins.clear();
}

/** Lists all currently registered external plugin manifests. */
export function listPlugins(): PluginManifest[] {
  return [...externalPlugins.values()].map((entry) => entry.manifest);
}

/** All known module ids in fixed order: built-in modules first, then sorted external plugins. */
export function allModuleIds(): ModuleId[] {
  if (externalPlugins.size === 0) return [...MODULE_IDS];
  const extra = [...externalPlugins.keys()].sort() as ModuleId[];
  return [...MODULE_IDS, ...extra];
}

export function lookupModule(id: ModuleId): GameModule | undefined {
  return (BUILTIN_MODULES as Record<string, GameModule | undefined>)[id] ?? externalPlugins.get(id)?.module;
}

/** The modules with these ids, in one fixed order whatever order they are asked for in. */
export function getModules(ids: readonly ModuleId[]): GameModule[] {
  return allModuleIds()
    .filter((id) => ids.includes(id))
    .map((id) => lookupModule(id))
    .filter((mod): mod is GameModule => mod !== undefined);
}

/** A set of modules as a short string: the key prompts and tool lists are cached under. */
export function modulesKey(ids: readonly ModuleId[]): string {
  return getModules(ids)
    .map((module) => module.id)
    .join('+');
}

/** Ids in the fixed order, without repeats or strangers. */
export function normalizeModules(ids: readonly string[]): ModuleId[] {
  return allModuleIds().filter((id) => ids.includes(id));
}

/**
 * The modules a story can actually be played with: the ones it has that the
 * player still subscribes to. This is the one gate every turn goes through, so
 * a module nobody subscribed to is never offered, whatever a save says.
 */
export function playableModules(session: Session, subscribed: readonly ModuleId[]): ModuleId[] {
  return allModuleIds().filter((id) => session.modules.includes(id) && subscribed.includes(id));
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
    .filter(
      (module) =>
        (module.id in states && states[module.id as keyof typeof states] !== undefined) ||
        states.custom?.[module.id] !== undefined ||
        (chosen ? chosen.includes(module.id) : module.keptWhenUnused),
    )
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
  return allModuleIds().flatMap((id) => {
    const builtin = (BUILTIN_MODULES as Record<string, GameModule | undefined>)[id];
    const external = externalPlugins.get(id);
    const module = builtin ?? external?.module;
    if (!module) return [];
    const category = builtin ? MODULE_CATEGORY[id] : (external?.category ?? 'rules');
    return [
      {
        id,
        category,
        subscribed: subscribed.includes(id),
        tools: module.tools.map(({ spec }) => spec.name),
        keepsRecords: module.record !== undefined,
        reachesCharacters: module.actor !== undefined || module.shownToCharacter !== undefined,
        hasPanel: module.hasPanel,
        promptTokens: { en: promptCost(module, 'en'), zh: promptCost(module, 'zh') },
        ...(external ? { plugin: external.meta } : {}),
      },
    ];
  });
}
