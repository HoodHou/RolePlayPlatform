import type { Combatant, CombatSide, CombatState, WorldState } from '@roleplay/shared';

/** The fight, on or over. It outlives the module being switched off. */
export function fightOf(world: WorldState): CombatState | undefined {
  // Old saves are migrated by the server, but a missing slice must not crash the panel.
  return world.modules?.combat;
}

/** Everyone in the fight in acting order; anyone the order does not list comes last. */
export function combatantsInOrder(fight: CombatState): Combatant[] {
  const listed = fight.order.flatMap((id) => {
    const combatant = fight.combatants[id];
    return combatant ? [combatant] : [];
  });
  const rest = Object.values(fight.combatants).filter((combatant) => !fight.order.includes(combatant.id));
  return [...listed, ...rest];
}

/** Health as a percentage of the most it can be, for a bar. */
export function healthPercent(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return Math.min(Math.max((hp / maxHp) * 100, 0), 100);
}

/** Which way a blow or a side leans for the player: their side's hits are good news, the enemy's bad. */
export function sideTone(side: CombatSide): 'good' | 'bad' | 'neutral' {
  if (side === 'player' || side === 'ally') return 'good';
  if (side === 'enemy') return 'bad';
  return 'neutral';
}
