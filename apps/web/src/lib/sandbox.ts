import {
  areFriendlyRegionsConnected,
  SANDBOX_COLORS,
  type SandboxFaction,
  type SandboxRegion,
  type SandboxState,
  type Stance,
  type WorldState,
} from '@roleplay/shared';
import type { CSSProperties } from 'react';

/** The board, once the game master has set one up. It outlives the module being switched off. */
export function boardOf(world: WorldState): SandboxState | undefined {
  // Old saves are migrated by the server, but a missing slice must not crash the panel.
  return world.modules?.sandbox;
}

/** CSS colour of a faction's palette slot (see `--faction-N` in tokens.css). Strange slots wrap rather than fail. */
export function factionColor(slot: number): string {
  const index = Number.isInteger(slot) ? ((slot % SANDBOX_COLORS) + SANDBOX_COLORS) % SANDBOX_COLORS : 0;
  return `var(--faction-${index})`;
}

/** Sets `--faction` for an element and its children; nothing for a faction that no longer exists. */
export function factionStyle(faction: SandboxFaction | undefined): CSSProperties | undefined {
  return faction ? ({ '--faction': factionColor(faction.color) } as CSSProperties) : undefined;
}

export function playerFactionOf(board: SandboxState): SandboxFaction | undefined {
  return Object.values(board.factions).find((faction) => faction.isPlayer);
}

/** The player's own side first, then the others in the order the game master set them up. */
export function sortedFactions(board: SandboxState): SandboxFaction[] {
  const factions = Object.values(board.factions);
  return [...factions.filter((f) => f.isPlayer), ...factions.filter((f) => !f.isPlayer)];
}

/** How many regions each faction holds, by faction id. */
export function regionCounts(board: SandboxState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const region of Object.values(board.regions)) {
    if (region.ownerId) counts.set(region.ownerId, (counts.get(region.ownerId) ?? 0) + 1);
  }
  return counts;
}

/** How two factions stand; pairs with no entry are neutral. */
export function stanceBetween(board: SandboxState, x: string, y: string): Stance {
  const [a, b] = x < y ? [x, y] : [y, x];
  return board.relations.find((relation) => relation.a === a && relation.b === b)?.stance ?? 'neutral';
}

export interface MapBounds {
  minX: number;
  minY: number;
  columns: number;
  rows: number;
}

/** The part of the grid that has regions on it: the map is drawn to this box, not the whole grid. */
export function mapBounds(regions: SandboxRegion[]): MapBounds | null {
  const placed = regions.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
  if (placed.length === 0) return null;
  const xs = placed.map((r) => r.x);
  const ys = placed.map((r) => r.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, columns: Math.max(...xs) - minX + 1, rows: Math.max(...ys) - minY + 1 };
}

/** The regions bordering `id`, whichever side recorded the border. */
export function neighborsOf(board: SandboxState, id: string): SandboxRegion[] {
  const region = board.regions[id];
  if (!region) return [];
  return Object.values(board.regions).filter(
    (other) => other.id !== id && (region.neighbors.includes(other.id) || other.neighbors.includes(id)),
  );
}

export type BorderKind = 'inner' | 'between' | 'front';

export interface Border {
  from: SandboxRegion;
  to: SandboxRegion;
  /** Inside one faction's lands, between different holders, or a front between powers at war. */
  kind: BorderKind;
}

/** Every border once. Borders run both ways, so a one-sided `neighbors` entry still counts. */
export function bordersOf(board: SandboxState): Border[] {
  const seen = new Set<string>();
  const borders: Border[] = [];
  for (const from of Object.values(board.regions)) {
    for (const id of from.neighbors) {
      const to = board.regions[id];
      if (!to || to.id === from.id) continue;
      const key = from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let kind: BorderKind = 'between';
      if (from.ownerId !== null && from.ownerId === to.ownerId) kind = 'inner';
      else if (from.ownerId && to.ownerId && stanceBetween(board, from.ownerId, to.ownerId) === 'war') kind = 'front';
      borders.push({ from, to, kind });
    }
  }
  return borders;
}

/** Total garrison strength across every region currently held by `factionId`. */
export function totalGarrisonOf(board: SandboxState, factionId: string): number | null {
  let sum = 0;
  let tracked = false;
  for (const region of Object.values(board.regions)) {
    if (region.ownerId === factionId && region.strength !== null) {
      sum += region.strength;
      tracked = true;
    }
  }
  return tracked ? sum : null;
}

/** Other friendly regions connected to `regionId` through an unbroken friendly supply corridor (direct neighbors first). */
export function connectedFriendlyRegionsOf(
  board: SandboxState,
  regionId: string,
  factionId: string,
): SandboxRegion[] {
  const directIds = new Set(neighborsOf(board, regionId).map((r) => r.id));
  return Object.values(board.regions)
    .filter((other) => other.id !== regionId && areFriendlyRegionsConnected(board, regionId, other.id, factionId))
    .sort(
      (a, b) =>
        Number(directIds.has(b.id)) - Number(directIds.has(a.id)) ||
        (b.strength ?? 0) - (a.strength ?? 0),
    );
}

/** Adjacent player-owned regions capable of marching into `targetRegionId`, ordered by largest garrison. */
export function borderingPlayerRegionsOf(
  board: SandboxState,
  targetRegionId: string,
  playerFactionId: string,
): SandboxRegion[] {
  return neighborsOf(board, targetRegionId)
    .filter((other) => other.ownerId === playerFactionId)
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
}
