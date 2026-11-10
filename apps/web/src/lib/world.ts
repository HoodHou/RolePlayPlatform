import type { Character, Item, LoreEntry, Location, Memory, Quest, QuestStatus, WorldState } from '@roleplay/shared';

/** Whether a character is at the scene's location. */
export function isPresent(world: WorldState, character: Character): boolean {
  return world.scene.locationId !== null && character.locationId === world.scene.locationId;
}

/** Only characters in the scene, other than the player, can be spoken to directly. */
export function canTalkTo(world: WorldState, characterId: string): boolean {
  const character = world.characters[characterId];
  return character !== undefined && !character.isPlayer && character.id !== world.playerId && isPresent(world, character);
}

/** Newest first. Old saves are migrated by the server, but a missing list must not crash the panel. */
export function memoriesOf(character: Character): Memory[] {
  return Array.isArray(character.memories) ? [...character.memories].reverse() : [];
}

/** Everyone but the player, those in the current scene first. */
export function npcsOf(world: WorldState): Character[] {
  const npcs = Object.values(world.characters).filter((c) => !c.isPlayer && c.id !== world.playerId);
  return [...npcs.filter((c) => isPresent(world, c)), ...npcs.filter((c) => !isPresent(world, c))];
}

export function inventoryOf(world: WorldState): Item[] {
  if (!world.playerId) return [];
  return Object.values(world.items).filter((item) => item.ownerId === world.playerId);
}

const QUEST_ORDER: Record<QuestStatus, number> = { active: 0, completed: 1, failed: 2 };

/** Active quests first; otherwise in the order the game master created them. */
export function sortedQuests(world: WorldState): Quest[] {
  return Object.values(world.quests).sort((a, b) => (QUEST_ORDER[a.status] ?? 3) - (QUEST_ORDER[b.status] ?? 3));
}

/** The current location first. */
export function sortedPlaces(world: WorldState): Location[] {
  const places = Object.values(world.locations);
  const here = world.scene.locationId;
  return [...places.filter((p) => p.id === here), ...places.filter((p) => p.id !== here)];
}

export function splitLore(world: WorldState): { visible: LoreEntry[]; secret: LoreEntry[] } {
  const entries = Object.values(world.lore);
  return { visible: entries.filter((e) => !e.hidden), secret: entries.filter((e) => e.hidden) };
}
