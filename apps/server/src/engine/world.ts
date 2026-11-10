import type {
  Character,
  ImageSubject,
  Item,
  Location,
  Memory,
  QuestStatus,
  Stat,
  WorldEvent,
  WorldState,
} from '@roleplay/shared';

/**
 * World operations. Each one mutates the world in place and returns the events
 * worth showing the player. They are the only code that changes world state;
 * the game master reaches them through tools (see tools.ts).
 */

/** A change the game master asked for that cannot be applied. The message is sent back to it. */
export class WorldOpError extends Error {}

export interface StatPatch {
  name: string;
  /** null removes the stat. */
  value: number | string | null;
  max?: number | null;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function requireName(value: string | undefined, kind: string, id: string, field = 'name'): string {
  const name = value?.trim();
  if (!name) {
    throw new WorldOpError(`${kind} "${id}" does not exist yet. Include "${field}" to create it.`);
  }
  return name;
}

export function updateWorld(
  world: WorldState,
  patch: { title?: string; premise?: string; artStyle?: string },
): WorldEvent[] {
  const events: WorldEvent[] = [];
  if (patch.title !== undefined && patch.title !== world.title) {
    world.title = patch.title;
    if (patch.title) events.push({ type: 'world_named', title: patch.title });
  }
  if (patch.premise !== undefined) world.premise = patch.premise;
  if (patch.artStyle !== undefined) world.artStyle = patch.artStyle;
  return events;
}

/** The thing a portrait would belong to. A scene picture belongs to nothing. */
function picturable(world: WorldState, subject: ImageSubject, id: string | null) {
  if (subject === 'scene' || id === null) return undefined;
  const collection = { character: world.characters, location: world.locations, item: world.items }[subject];
  return collection[id];
}

/** Checks that a picture of this subject can be attached, and returns the id it attaches to. */
export function resolvePictureTarget(
  world: WorldState,
  subject: ImageSubject,
  id: string | undefined,
): string | null {
  if (subject === 'scene') return null;
  if (!id) throw new WorldOpError(`A ${subject} picture needs the id of the ${subject} it shows.`);
  if (!picturable(world, subject, id)) {
    throw new WorldOpError(`There is no ${subject} with id "${id}". Create it before painting it.`);
  }
  return id;
}

/** Makes a finished picture the portrait of what it shows, if that still exists. */
export function attachPicture(
  world: WorldState,
  subject: ImageSubject,
  id: string | null,
  url: string,
): boolean {
  const target = picturable(world, subject, id);
  if (!target) return false;
  target.imageUrl = url;
  return true;
}

export function setScene(
  world: WorldState,
  patch: { locationId?: string; time?: string; weather?: string; summary?: string },
): WorldEvent[] {
  const events: WorldEvent[] = [];
  if (patch.locationId !== undefined) {
    const location = world.locations[patch.locationId];
    if (!location) {
      throw new WorldOpError(
        `Location "${patch.locationId}" does not exist. Create it with upsert_location first.`,
      );
    }
    if (world.scene.locationId !== location.id) {
      world.scene.locationId = location.id;
      events.push({ type: 'scene_changed', locationId: location.id, locationName: location.name });
    }
    // The scene follows the player, so the player is wherever the scene is.
    const player = world.playerId ? world.characters[world.playerId] : undefined;
    if (player) player.locationId = location.id;
  }
  if (patch.time !== undefined) world.scene.time = patch.time;
  if (patch.weather !== undefined) world.scene.weather = patch.weather;
  if (patch.summary !== undefined) world.scene.summary = patch.summary;
  return events;
}

/**
 * The scene is wherever the player is. Whatever a record says about the player
 * character's whereabouts, they end up where the scene is set.
 */
export function keepPlayerInScene(world: WorldState): void {
  const player = world.playerId ? world.characters[world.playerId] : undefined;
  if (player && world.scene.locationId) player.locationId = world.scene.locationId;
}

export function upsertLocation(
  world: WorldState,
  input: { id: string; name?: string; description?: string; connections?: string[] },
): WorldEvent[] {
  const events: WorldEvent[] = [];
  const id = input.id;
  const existing = world.locations[id];
  const location: Location = existing ?? {
    id,
    name: requireName(input.name, 'Location', id),
    description: input.description ?? '',
    connections: [],
  };

  if (!existing) {
    world.locations[id] = location;
    events.push({ type: 'location_added', id, name: location.name });
    // Places created earlier may already point here.
    for (const other of Object.values(world.locations)) {
      if (other.id !== id && other.connections.includes(id)) location.connections.push(other.id);
    }
  } else {
    if (input.name?.trim()) location.name = input.name.trim();
    if (input.description !== undefined) location.description = input.description;
  }

  if (input.connections) {
    location.connections = unique([...location.connections, ...input.connections]).filter(
      (other) => other !== id,
    );
    // Paths run both ways unless the game master removes one.
    for (const otherId of location.connections) {
      const other = world.locations[otherId];
      if (other && !other.connections.includes(id)) other.connections.push(id);
    }
  }
  return events;
}

function applyStats(character: Character, patches: StatPatch[], emit: boolean): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const patch of patches) {
    const name = patch.name.trim();
    if (!name) continue;
    const index = character.stats.findIndex((s) => s.name === name);
    const current = index >= 0 ? character.stats[index] : undefined;

    if (patch.value === null) {
      if (index >= 0) character.stats.splice(index, 1);
      continue;
    }

    const next: Stat = { name, value: patch.value };
    const max = patch.max === undefined ? current?.max : (patch.max ?? undefined);
    if (max !== undefined) next.max = max;

    if (!current) {
      character.stats.push(next);
      continue;
    }
    character.stats[index] = next;
    if (emit && current.value !== next.value) {
      events.push({
        type: 'stat_changed',
        characterId: character.id,
        characterName: character.name,
        isPlayer: character.isPlayer,
        stat: name,
        from: current.value,
        to: next.value,
        ...(next.max !== undefined ? { max: next.max } : {}),
      });
    }
  }
  return events;
}

/**
 * Sets one numeric stat on a character's sheet, keeping its upper bound.
 * For modules whose state lives on the sheet: a fight that wears down health.
 */
export function setStat(world: WorldState, characterId: string, name: string, value: number): WorldEvent[] {
  const character = world.characters[characterId];
  if (!character) throw new WorldOpError(`There is no character with id "${characterId}".`);
  return applyStats(character, [{ name, value }], true);
}

export function upsertCharacter(
  world: WorldState,
  input: {
    id: string;
    name?: string;
    isPlayer?: boolean;
    role?: string;
    description?: string;
    personality?: string;
    status?: string;
    attitude?: string;
    locationId?: string | null;
    stats?: StatPatch[];
    voice?: string;
    goals?: string;
    secrets?: string;
  },
): WorldEvent[] {
  if (input.locationId && !world.locations[input.locationId]) {
    throw new WorldOpError(
      `Location "${input.locationId}" does not exist. Create it with upsert_location first.`,
    );
  }

  const existing = world.characters[input.id];
  if (!existing) {
    const name = requireName(input.name, 'Character', input.id);
    const isPlayer = input.isPlayer ?? false;
    if (isPlayer && world.playerId) {
      throw new WorldOpError(
        `The player character already exists as "${world.playerId}". Update that one instead.`,
      );
    }
    const character: Character = {
      id: input.id,
      name,
      isPlayer,
      role: input.role ?? '',
      description: input.description ?? '',
      personality: input.personality ?? '',
      status: input.status ?? '',
      attitude: input.attitude ?? '',
      // Newcomers appear where the action is unless placed elsewhere.
      locationId: input.locationId !== undefined ? input.locationId : world.scene.locationId,
      stats: [],
      voice: input.voice ?? '',
      goals: input.goals ?? '',
      secrets: input.secrets ?? '',
      memories: [],
    };
    applyStats(character, input.stats ?? [], false);
    world.characters[character.id] = character;
    if (isPlayer) {
      world.playerId = character.id;
      return [];
    }
    return [{ type: 'character_added', id: character.id, name, role: character.role }];
  }

  if (input.isPlayer !== undefined && input.isPlayer !== existing.isPlayer) {
    throw new WorldOpError('is_player cannot change after a character is created.');
  }
  if (input.name?.trim()) existing.name = input.name.trim();
  if (input.role !== undefined) existing.role = input.role;
  if (input.description !== undefined) existing.description = input.description;
  if (input.personality !== undefined) existing.personality = input.personality;
  if (input.status !== undefined) existing.status = input.status;
  if (input.attitude !== undefined) existing.attitude = input.attitude;
  if (input.locationId !== undefined) existing.locationId = input.locationId;
  if (input.voice !== undefined) existing.voice = input.voice;
  if (input.goals !== undefined) existing.goals = input.goals;
  if (input.secrets !== undefined) existing.secrets = input.secrets;
  return applyStats(existing, input.stats ?? [], true);
}

// A character keeps this many memories. Past it, the least important of the
// oldest go first; what mattered stays.
const MEMORY_LIMIT = 300;

/**
 * Gives a character a memory of something they witnessed, did or were told.
 * Memories are the whole of what a character knows about the story, so this is
 * also how knowledge spreads: whoever gets no memory of an event does not know
 * it happened. Stamped with the scene's time and the character's whereabouts.
 */
export function addMemory(
  world: WorldState,
  input: { characterId: string; text: string; about?: string[]; importance?: number; toldBy?: string },
): WorldEvent[] {
  const character = world.characters[input.characterId];
  if (!character) throw new WorldOpError(`There is no character with id "${input.characterId}".`);
  if (character.isPlayer) {
    throw new WorldOpError('The player character keeps no memories here; the player remembers for them.');
  }
  if (input.toldBy && !world.characters[input.toldBy]) {
    throw new WorldOpError(`There is no character with id "${input.toldBy}" to have told them.`);
  }

  const last = character.memories.at(-1);
  const sequence = last && last.turn === world.turn ? Number(last.id.split('_')[1] ?? 0) + 1 : 0;
  const memory: Memory = {
    id: `m${world.turn}_${sequence}`,
    turn: world.turn,
    time: world.scene.time,
    locationId: character.locationId,
    text: input.text.trim(),
    about: unique(input.about ?? []),
    importance: Math.min(Math.max(Math.round(input.importance ?? 2), 1), 5),
    ...(input.toldBy ? { toldBy: input.toldBy } : {}),
  };
  character.memories.push(memory);

  if (character.memories.length > MEMORY_LIMIT) {
    const oldestHalf = character.memories.slice(0, MEMORY_LIMIT / 2);
    const faintest = Math.min(...oldestHalf.map((m) => m.importance));
    character.memories.splice(oldestHalf.findIndex((m) => m.importance === faintest), 1);
  }
  // What a character remembers is theirs; nothing is announced to the player.
  return [];
}

/** How many of this item the player holds. playerId is null until the player exists. */
function heldByPlayer(world: WorldState, item: Item): number {
  const owned = world.playerId !== null && item.ownerId === world.playerId;
  return owned ? Math.max(item.quantity, 0) : 0;
}

export function upsertItem(
  world: WorldState,
  input: {
    id: string;
    name?: string;
    description?: string;
    quantity?: number;
    ownerId?: string | null;
  },
): WorldEvent[] {
  if (input.ownerId && !world.characters[input.ownerId]) {
    throw new WorldOpError(`Character "${input.ownerId}" does not exist, so it cannot own an item.`);
  }

  const existing = world.items[input.id];
  const heldBefore = existing ? heldByPlayer(world, existing) : 0;

  const item: Item = existing ?? {
    id: input.id,
    name: requireName(input.name, 'Item', input.id),
    description: input.description ?? '',
    quantity: input.quantity ?? 1,
    // Items are the player's unless the game master says otherwise.
    ownerId: input.ownerId !== undefined ? input.ownerId : world.playerId,
  };
  if (!existing) {
    world.items[item.id] = item;
  } else {
    if (input.name?.trim()) item.name = input.name.trim();
    if (input.description !== undefined) item.description = input.description;
    if (input.quantity !== undefined) item.quantity = input.quantity;
    if (input.ownerId !== undefined) item.ownerId = input.ownerId;
  }

  if (item.quantity <= 0) delete world.items[item.id];

  // Only the player's inventory is announced.
  const heldAfter = heldByPlayer(world, item);
  if (heldAfter > heldBefore) {
    return [{ type: 'item_gained', id: item.id, name: item.name, quantity: heldAfter - heldBefore }];
  }
  if (heldAfter < heldBefore) {
    return [{ type: 'item_lost', id: item.id, name: item.name, quantity: heldBefore - heldAfter }];
  }
  return [];
}

export function upsertQuest(
  world: WorldState,
  input: { id: string; title?: string; description?: string; status?: QuestStatus; progress?: string },
): WorldEvent[] {
  const existing = world.quests[input.id];
  if (!existing) {
    const title = requireName(input.title, 'Quest', input.id, 'title');
    world.quests[input.id] = {
      id: input.id,
      title,
      description: input.description ?? '',
      status: input.status ?? 'active',
      progress: input.progress ?? '',
    };
    return [{ type: 'quest_started', id: input.id, title }];
  }

  const events: WorldEvent[] = [];
  if (input.title?.trim()) existing.title = input.title.trim();
  if (input.description !== undefined) existing.description = input.description;
  const progressChanged = input.progress !== undefined && input.progress !== existing.progress;
  if (input.progress !== undefined) existing.progress = input.progress;

  if (input.status !== undefined && input.status !== existing.status) {
    existing.status = input.status;
    if (input.status === 'completed') {
      events.push({ type: 'quest_completed', id: existing.id, title: existing.title });
    } else if (input.status === 'failed') {
      events.push({ type: 'quest_failed', id: existing.id, title: existing.title });
    }
  } else if (progressChanged && existing.progress) {
    events.push({
      type: 'quest_updated',
      id: existing.id,
      title: existing.title,
      progress: existing.progress,
    });
  }
  return events;
}

export function upsertLore(
  world: WorldState,
  input: { id: string; title?: string; content?: string; hidden?: boolean },
): WorldEvent[] {
  const existing = world.lore[input.id];
  if (!existing) {
    const title = requireName(input.title, 'Lore entry', input.id, 'title');
    const hidden = input.hidden ?? false;
    world.lore[input.id] = { id: input.id, title, content: input.content ?? '', hidden };
    return hidden ? [] : [{ type: 'lore_added', id: input.id, title }];
  }

  const wasHidden = existing.hidden;
  if (input.title?.trim()) existing.title = input.title.trim();
  if (input.content !== undefined) existing.content = input.content;
  if (input.hidden !== undefined) existing.hidden = input.hidden;
  // A secret coming to light reads to the player as new lore.
  return wasHidden && !existing.hidden
    ? [{ type: 'lore_added', id: existing.id, title: existing.title }]
    : [];
}

export type EntityKind = 'character' | 'location' | 'item' | 'quest' | 'lore';

export function removeEntity(
  world: WorldState,
  kind: EntityKind,
  id: string,
  reason = '',
): WorldEvent[] {
  switch (kind) {
    case 'character': {
      const character = world.characters[id];
      if (!character) throw new WorldOpError(`Character "${id}" does not exist.`);
      if (character.isPlayer) throw new WorldOpError('The player character cannot be removed.');
      delete world.characters[id];
      for (const item of Object.values(world.items)) {
        if (item.ownerId === id) item.ownerId = null;
      }
      return [{ type: 'character_removed', id, name: character.name, reason }];
    }
    case 'location': {
      if (!world.locations[id]) throw new WorldOpError(`Location "${id}" does not exist.`);
      if (world.scene.locationId === id) {
        throw new WorldOpError('The current scene is here. Move the scene with set_scene first.');
      }
      delete world.locations[id];
      for (const other of Object.values(world.locations)) {
        other.connections = other.connections.filter((c) => c !== id);
      }
      for (const character of Object.values(world.characters)) {
        if (character.locationId === id) character.locationId = null;
      }
      return [];
    }
    case 'item': {
      const item = world.items[id];
      if (!item) throw new WorldOpError(`Item "${id}" does not exist.`);
      delete world.items[id];
      const held = heldByPlayer(world, item);
      return held > 0 ? [{ type: 'item_lost', id, name: item.name, quantity: held }] : [];
    }
    case 'quest':
      if (!world.quests[id]) throw new WorldOpError(`Quest "${id}" does not exist.`);
      delete world.quests[id];
      return [];
    case 'lore':
      if (!world.lore[id]) throw new WorldOpError(`Lore entry "${id}" does not exist.`);
      delete world.lore[id];
      return [];
  }
}

export function setSuggestions(world: WorldState, actions: string[]): WorldEvent[] {
  world.suggestions = actions.map((a) => a.trim()).filter(Boolean);
  return [];
}
