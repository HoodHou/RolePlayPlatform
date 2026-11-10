import type { Clock, WorldState } from '@roleplay/shared';

/**
 * The clocks the player may see: every clock that is not hidden, and the
 * hidden ones (the game master's own countdowns) only with its secrets shown.
 * Old saves are migrated by the server, but a missing slice must not crash the panel.
 */
export function visibleClocks(world: WorldState, showSecrets: boolean): Clock[] {
  const clocks = Object.values(world.modules?.clocks?.clocks ?? {});
  const open = clocks.filter((clock) => !clock.hidden);
  return showSecrets ? [...open, ...clocks.filter((clock) => clock.hidden)] : open;
}

export function isFull(clock: Pick<Clock, 'filled' | 'segments'>): boolean {
  return clock.filled >= clock.segments;
}
