import { MODULE_IDS, type ModuleId, type Session, type WorldEvent, type WorldState } from '@roleplay/shared';

export type CheckEvent = Extract<WorldEvent, { type: 'check_rolled' }>;
export type BattleEvent = Extract<WorldEvent, { type: 'sandbox_battle' }>;
export type FateEvent = Extract<WorldEvent, { type: 'fate_asked' }>;
export type ClockTickEvent = Extract<WorldEvent, { type: 'clock_ticked' }>;
export type AttackEvent = Extract<WorldEvent, { type: 'attack_resolved' }>;
export type CombatStartEvent = Extract<WorldEvent, { type: 'combat_started' }>;

/** A text glyph (not emoji) for each module, as the library and the world panel show it. */
export const MODULE_GLYPH: Record<ModuleId, string> = {
  dice: '⚅',
  combat: '⚔',
  oracle: '☽',
  clocks: '◔',
  calendar: '▦',
  bonds: '♡',
  sandbox: '⚑',
};

/** The modules a story has. Old saves are migrated by the server, but a missing list must not crash the UI. */
export function modulesOf(session: Session): ModuleId[] {
  return Array.isArray(session.modules) ? session.modules : [];
}

/** `current` with one module switched on or off, in the fixed module order. */
export function withModule(current: readonly ModuleId[], id: ModuleId, on: boolean): ModuleId[] {
  return MODULE_IDS.filter((module) => (module === id ? on : current.includes(module)));
}

/**
 * How a module stands in a story:
 *   on          the story has it and it is played;
 *   off         the player subscribes to it, but the story does not have it;
 *   outOfPlay   the story has it, but the player no longer subscribes, so it is not played anywhere;
 *   unavailable neither: subscribing comes first.
 * Subscriptions not known yet count as subscribed: the server is the gate either way.
 */
export type StoryRelation = 'on' | 'off' | 'outOfPlay' | 'unavailable';

export function relationOf(session: Session, id: ModuleId, subscribed: readonly ModuleId[] | null): StoryRelation {
  const has = modulesOf(session).includes(id);
  const available = subscribed === null || subscribed.includes(id);
  if (has) return available ? 'on' : 'outOfPlay';
  return available ? 'off' : 'unavailable';
}

/** Whether a module has kept anything in this world. The oracle never does. */
export function hasModuleState(world: WorldState, id: ModuleId): boolean {
  const states: Partial<Record<ModuleId, unknown>> = world.modules ?? {};
  return states[id] !== undefined;
}

/** The modules a story is actually played with: those it has that the player subscribes to. */
export function playedModules(session: Session, subscribed: readonly ModuleId[] | null): ModuleId[] {
  return modulesOf(session).filter((id) => subscribed === null || subscribed.includes(id));
}

export interface DieView {
  value: number;
  /** False for a die an edge threw away. */
  kept: boolean;
}

/** Every die of a check in the order rolled, marked with whether it counted. */
export function diceOf(event: CheckEvent): DieView[] {
  // `kept` lists values, so each claims the first unclaimed die showing that value.
  const unclaimed = [...event.kept];
  return event.rolls.map((value) => {
    const index = unclaimed.indexOf(value);
    if (index === -1) return { value, kept: false };
    unclaimed.splice(index, 1);
    return { value, kept: true };
  });
}

export type Edge = 'advantage' | 'disadvantage';

/**
 * The edge a check was rolled with, read off which dice the server kept. Null
 * without one, or when the dice cannot tell (the extra die matched a kept one).
 */
export function edgeOf(event: CheckEvent): Edge | null {
  const dropped = diceOf(event).filter((die) => !die.kept);
  const first = dropped[0];
  if (dropped.length !== 1 || !first || event.kept.length === 0) return null;
  // Under d100 the lower roll is the better one; flip it so higher is better everywhere.
  const sign = event.system === 'd100' ? -1 : 1;
  const lost = sign * first.value;
  const kept = event.kept.map((value) => sign * value);
  const low = Math.min(...kept);
  const high = Math.max(...kept);
  if (lost <= low && lost < high) return 'advantage';
  if (lost >= high && lost > low) return 'disadvantage';
  return null;
}

/** Whether a clock tick filled the clock: what it counted toward happens now. */
export function fillsClock(event: ClockTickEvent): boolean {
  return event.to >= event.segments && event.to > event.from;
}
