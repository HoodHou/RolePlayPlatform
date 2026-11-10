import { BOND_RANGE, bondStage, type Bond, type BondStage, type Character, type WorldState } from '@roleplay/shared';

/** The boundaries between stages, ticked on the meter (see `bondStage`: cold above −60, neutral above −20, warm from 20…). */
export const BOND_THRESHOLDS = [-60, -20, 20, 50, 80] as const;

export interface BondView {
  bond: Bond;
  character: Character;
  stage: BondStage;
}

/** The bond with one character, when there is one. A character with no entry is a stranger. */
export function bondOf(world: WorldState, characterId: string): Bond | undefined {
  // Old saves are migrated by the server, but a missing slice must not crash the panel.
  return world.modules?.bonds?.bonds[characterId];
}

/** Bonds with characters still in the cast, closest first. */
export function bondsOf(world: WorldState): BondView[] {
  return Object.values(world.modules?.bonds?.bonds ?? {})
    .flatMap((bond) => {
      const character = world.characters[bond.characterId];
      return character ? [{ bond, character, stage: bondStage(bond.score) }] : [];
    })
    .sort((a, b) => b.bond.score - a.bond.score);
}

/** Where a score sits on the scale, 0 (the bottom) to 100 (the top), in percent. */
export function bondPosition(score: number): number {
  const clamped = Math.min(Math.max(score, BOND_RANGE.min), BOND_RANGE.max);
  return ((clamped - BOND_RANGE.min) / (BOND_RANGE.max - BOND_RANGE.min)) * 100;
}
