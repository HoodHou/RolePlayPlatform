import type {
  Character,
  ChronicleEntry,
  ChronicleKind,
  ImageSubject,
  Item,
  Locale,
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

/** Builds a self-contained visual portrait prompt from a character's recorded dossier. */
export function buildCharacterPortraitPrompt(
  character: Character,
  world: WorldState,
  extra?: string,
): string {
  const parts: string[] = [`Character portrait of ${character.name}`];
  if (character.role.trim()) parts.push(`Role: ${character.role.trim()}`);
  if (character.appearance.trim()) parts.push(`Appearance: ${character.appearance.trim()}`);
  if (character.description.trim()) parts.push(`Details: ${character.description.trim()}`);
  if (character.personality.trim()) parts.push(`Demeanor: ${character.personality.trim()}`);
  if (character.status.trim()) parts.push(`Current state: ${character.status.trim()}`);
  if (world.title.trim()) parts.push(`World setting: ${world.title.trim()}`);
  if (extra?.trim()) parts.push(extra.trim());
  parts.push(
    'Composition: expressive three-quarter or half-body standing character portrait (立绘), crisp facial features and attire details, atmospheric lighting, no text, no captions, no UI elements.',
  );
  return parts.join('. ');
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
    appearance?: string;
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
      appearance: input.appearance ?? '',
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
  if (input.appearance !== undefined) existing.appearance = input.appearance;
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
// oldest go first; core memories (importance 5) stay anchored unless every slot is 5.
const MEMORY_LIMIT = 500;

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

  const trimmedText = input.text.trim();
  const clampedImportance = Math.min(Math.max(Math.round(input.importance ?? 2), 1), 5);
  const cleanedAbout = unique(input.about ?? []);

  // Deduplicate identical memories recorded twice for the same character in the same turn.
  const sameTurnDup = character.memories.find(
    (m) => m.turn === world.turn && m.text === trimmedText && m.toldBy === input.toldBy,
  );
  if (sameTurnDup) {
    sameTurnDup.importance = Math.max(sameTurnDup.importance, clampedImportance);
    sameTurnDup.about = unique([...sameTurnDup.about, ...cleanedAbout]);
    return [];
  }

  const last = character.memories.at(-1);
  const sequence = last && last.turn === world.turn ? Number(last.id.split('_')[1] ?? 0) + 1 : 0;
  const memory: Memory = {
    id: `m${world.turn}_${sequence}`,
    turn: world.turn,
    time: world.scene.time,
    locationId: character.locationId,
    text: trimmedText,
    about: cleanedAbout,
    importance: clampedImportance,
    ...(input.toldBy ? { toldBy: input.toldBy } : {}),
  };
  character.memories.push(memory);

  if (character.memories.length > MEMORY_LIMIT) {
    const oldestHalf = character.memories.slice(0, Math.floor(MEMORY_LIMIT / 2));
    // Protect permanent anchor memories (importance 5) whenever any lesser memory can be evicted instead.
    const pool = oldestHalf.some((m) => m.importance < 5)
      ? oldestHalf
      : character.memories.some((m) => m.importance < 5)
        ? character.memories
        : oldestHalf;
    const faintest = Math.min(...pool.map((m) => m.importance));
    const evictId = pool.find((m) => m.importance === faintest)?.id;
    const idx = evictId ? character.memories.findIndex((m) => m.id === evictId) : 0;
    if (idx >= 0) character.memories.splice(idx, 1);
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

// --- story progression & chronicle --------------------------------------------

const CHRONICLE_LIMIT = 150;

export function updateStoryArc(
  world: WorldState,
  patch: { chapter?: string; summary?: string; threads?: string[] },
): WorldEvent[] {
  const arc = (world.storyArc ??= { chapter: '', summary: '', threads: [] });
  const prevChapter = arc.chapter;
  if (patch.chapter !== undefined) arc.chapter = patch.chapter.trim();
  if (patch.summary !== undefined) arc.summary = patch.summary.trim();
  if (patch.threads !== undefined) {
    arc.threads = unique(patch.threads).slice(0, 8);
  }
  if (arc.chapter && arc.chapter !== prevChapter) {
    return [{ type: 'chapter_changed', chapter: arc.chapter, summary: arc.summary }];
  }
  return [];
}

export function upsertChronicle(
  world: WorldState,
  input: {
    id?: string;
    kind?: ChronicleKind;
    title?: string;
    summary?: string;
    impact?: string;
    secret?: boolean;
    public?: boolean;
  },
): WorldEvent[] {
  const list = (world.chronicle ??= []);
  const rawId = input.id?.trim();
  const existing = rawId ? list.find((entry) => entry.id === rawId) : undefined;

  if (!existing) {
    const title = requireName(input.title, 'Chronicle entry', rawId ?? `chr_t${world.turn}`, 'title');
    const seq = list.filter((e) => e.turn === world.turn).length;
    const entryId = rawId || `chr_t${world.turn}_${seq}`;
    const secret = input.secret ?? false;
    const isPublic = secret ? false : (input.public ?? false);
    const kind: ChronicleKind = input.kind ?? 'milestone';
    const entry: ChronicleEntry = {
      id: entryId,
      turn: world.turn,
      time: world.scene.time,
      kind,
      title,
      summary: input.summary?.trim() ?? '',
      impact: input.impact?.trim() ?? '',
      secret,
      ...(isPublic ? { public: true } : {}),
    };
    list.push(entry);
    trimChronicle(list);
    return secret ? [] : [{ type: 'chronicle_recorded', id: entryId, title, kind }];
  }

  const wasSecret = existing.secret;
  if (input.kind !== undefined) existing.kind = input.kind;
  if (input.title?.trim()) existing.title = input.title.trim();
  if (input.summary !== undefined) existing.summary = input.summary.trim();
  if (input.impact !== undefined) existing.impact = input.impact.trim();
  if (input.secret !== undefined) existing.secret = input.secret;
  if (existing.secret) {
    delete existing.public;
  } else if (input.public !== undefined) {
    if (input.public) existing.public = true;
    else delete existing.public;
  }
  return wasSecret && !existing.secret
    ? [{ type: 'chronicle_recorded', id: existing.id, title: existing.title, kind: existing.kind }]
    : [];
}

function trimChronicle(list: ChronicleEntry[]): void {
  while (list.length > CHRONICLE_LIMIT) {
    // Keep major turning points whenever any ordinary milestone can be dropped first.
    const idx = list.findIndex((e) => e.kind !== 'turning_point');
    list.splice(idx >= 0 ? idx : 0, 1);
  }
}

/**
 * Automatically captures major mechanical turning points (wars, conquered regions,
 * imperial edicts, succession, completed quests, filled clocks, breakthroughs) into
 * `world.chronicle` when the game master did not already record a chronicle entry
 * for the turn, ensuring campaign history is never lost even in fast turns.
 */
export function autoCaptureChronicleFromEvents(
  world: WorldState,
  events: readonly WorldEvent[],
  locale: Locale,
): void {
  const list = (world.chronicle ??= []);
  const alreadyThisTurn = list.some((entry) => entry.turn === world.turn);
  if (alreadyThisTurn) return;

  const zh = locale === 'zh';
  for (const event of events) {
    switch (event.type) {
      case 'sandbox_battle': {
        const winName = event.winner === 'attacker' ? event.attackerName : event.defenderName;
        const where = event.regionName ? (zh ? `于${event.regionName}` : ` at ${event.regionName}`) : '';
        list.push({
          id: `chr_auto_t${world.turn}_${list.length}`,
          turn: world.turn,
          time: world.scene.time,
          kind: 'battle',
          title: zh
            ? `${event.regionName || '边境'}之战：${winName}获胜`
            : `Battle${where}: ${winName} prevailed`,
          summary: zh
            ? `${event.attackerName}与${event.defenderName}${where}交兵，${winName}取胜（${event.reason || '战局已定'}）。`
            : `${event.attackerName} clashed with ${event.defenderName}${where}; ${winName} won.`,
          impact: '',
          secret: false,
          public: true,
        });
        break;
      }
      case 'region_taken': {
        if (!event.toName && !event.fromName) break;
        list.push({
          id: `chr_auto_t${world.turn}_${list.length}`,
          turn: world.turn,
          time: world.scene.time,
          kind: 'turning_point',
          title: zh
            ? `${event.regionName}易主`
            : `${event.regionName} changed hands`,
          summary: zh
            ? event.fromName && event.toName
              ? `${event.regionName}由${event.fromName}转归${event.toName}控制。`
              : event.toName
                ? `${event.toName}占领了${event.regionName}。`
                : `${event.fromName}失去了${event.regionName}。`
            : event.fromName && event.toName
              ? `${event.regionName} passed from ${event.fromName} to ${event.toName}.`
              : `${event.regionName} changed control.`,
          impact: '',
          secret: false,
          public: true,
        });
        break;
      }
      case 'relation_changed': {
        if (event.stance !== 'war' && event.stance !== 'allied') break;
        list.push({
          id: `chr_auto_t${world.turn}_${list.length}`,
          turn: world.turn,
          time: world.scene.time,
          kind: event.stance === 'war' ? 'battle' : 'alliance',
          title: zh
            ? event.stance === 'war'
              ? `${event.aName}与${event.bName}开战`
              : `${event.aName}与${event.bName}结盟`
            : event.stance === 'war'
              ? `War between ${event.aName} and ${event.bName}`
              : `Alliance of ${event.aName} and ${event.bName}`,
          summary: '',
          impact: '',
          secret: false,
          public: true,
        });
        break;
      }
      case 'edict_issued': {
        list.push({
          id: `chr_auto_t${world.turn}_${list.length}`,
          turn: world.turn,
          time: world.scene.time,
          kind: 'decree',
          title: zh ? `颁布诏令：${event.title}` : `Edict issued: ${event.title}`,
          summary: event.effect || '',
          impact: '',
          secret: false,
          public: true,
        });
        break;
      }
      case 'heir_designated': {
        list.push({
          id: `chr_auto_t${world.turn}_${list.length}`,
          turn: world.turn,
          time: world.scene.time,
          kind: 'decree',
          title: zh ? `册立储君：${event.characterName}` : `Heir designated: ${event.characterName}`,
          summary: event.title || '',
          impact: '',
          secret: false,
          public: true,
        });
        break;
      }
      case 'quest_completed':
      case 'quest_failed': {
        const done = event.type === 'quest_completed';
        list.push({
          id: `chr_auto_t${world.turn}_${list.length}`,
          turn: world.turn,
          time: world.scene.time,
          kind: done ? 'milestone' : 'consequence',
          title: zh
            ? `${done ? '达成目标' : '目标受挫'}：${event.title}`
            : `${done ? 'Quest completed' : 'Quest failed'}: ${event.title}`,
          summary: '',
          impact: '',
          secret: false,
          // Personal quest logs stay out of random NPCs' common knowledge unless explicitly recorded as public.
        });
        break;
      }
      case 'clock_ticked': {
        if (event.to < event.segments) break;
        list.push({
          id: `chr_auto_t${world.turn}_${list.length}`,
          turn: world.turn,
          time: world.scene.time,
          kind: 'consequence',
          title: zh ? `时局爆发：${event.name}` : `Crisis reached: ${event.name}`,
          summary: '',
          impact: '',
          secret: false,
        });
        break;
      }
      case 'realm_breakthrough': {
        if (event.outcome !== 'transcendent' && event.outcome !== 'success') break;
        list.push({
          id: `chr_auto_t${world.turn}_${list.length}`,
          turn: world.turn,
          time: world.scene.time,
          kind: 'milestone',
          title: zh ? `境界突破：晋入${event.toRealm}` : `Breakthrough: reached ${event.toRealm}`,
          summary: event.reason || '',
          impact: '',
          secret: false,
        });
        break;
      }
      default:
        break;
    }
  }
  trimChronicle(list);
}
