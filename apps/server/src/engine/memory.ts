import type { Character, Memory, WorldState } from '@roleplay/shared';

/**
 * Remembering. A character can hold hundreds of memories; a prompt can carry
 * a handful. `recall` picks the ones that would come to mind right now, the
 * way a person's do: what was just brought up, what happened lately, what
 * mattered, and what has to do with who and what is in front of them.
 */

export interface RecallFocus {
  /** Ids named in what was just said. Being asked about something brings it back, however old or slight. */
  cues: ReadonlySet<string>;
  /** Ids of what is simply there: who is present and where. */
  around: ReadonlySet<string>;
  /** The current turn, to judge how long ago things were. */
  turn: number;
}

// Importance runs 1–5. A fresh memory adds up to 3 and fades by a tenth per
// turn. A memory about someone or something present adds 2.
const RECENCY_WEIGHT = 3;
const RECENCY_DECAY = 0.9;
const PRESENCE_BONUS = 2;

function concerns(memory: Memory, ids: ReadonlySet<string>): boolean {
  return memory.about.some((id) => ids.has(id)) || (memory.toldBy !== undefined && ids.has(memory.toldBy));
}

function weight(memory: Memory, focus: RecallFocus): number {
  const age = Math.max(focus.turn - memory.turn, 0);
  const recency = RECENCY_WEIGHT * RECENCY_DECAY ** age;
  return memory.importance + recency + (concerns(memory, focus.around) ? PRESENCE_BONUS : 0);
}

/**
 * The `limit` memories most likely to come to mind, in the order they happened.
 * Up to half the places go to memories of what was just brought up, so that
 * asking about the cellar recalls the cellar even past a crowd of fresher,
 * weightier memories; the rest go to whatever weighs most.
 */
export function recall(memories: Memory[], focus: RecallFocus, limit: number): Memory[] {
  if (memories.length <= limit) return memories;

  const ranked = memories
    .map((memory, index) => ({ memory, index, weight: weight(memory, focus) }))
    .sort((a, b) => b.weight - a.weight || b.index - a.index);

  const cued = ranked.filter((entry) => concerns(entry.memory, focus.cues)).slice(0, Math.ceil(limit / 2));
  const chosen = new Set(cued.map((entry) => entry.index));
  for (const entry of ranked) {
    if (chosen.size >= limit) break;
    chosen.add(entry.index);
  }
  return memories.filter((_, index) => chosen.has(index));
}

/** Ids of the characters, places and items whose names appear in a piece of text. */
export function mentionedIds(world: WorldState, text: string): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const named = [
    ...Object.values(world.characters),
    ...Object.values(world.locations),
    ...Object.values(world.items),
  ];
  return named.filter((thing) => thing.name && haystack.includes(thing.name.toLowerCase())).map((thing) => thing.id);
}

/** Everyone at the scene's location, the player included. */
export function presentCharacters(world: WorldState): Character[] {
  return Object.values(world.characters).filter(
    (character) => character.locationId === world.scene.locationId || character.id === world.playerId,
  );
}

export function isPresent(world: WorldState, character: Character): boolean {
  return character.locationId === world.scene.locationId;
}

/** What is in play in the current scene, with whatever `text` names as the cue. */
export function sceneFocus(world: WorldState, text = ''): RecallFocus {
  const around = new Set<string>(presentCharacters(world).map((character) => character.id));
  if (world.scene.locationId) around.add(world.scene.locationId);
  return { cues: new Set(mentionedIds(world, text)), around, turn: world.turn };
}

// Memories shown to the game master per character in play.
const GAME_MASTER_RECALL = 8;

/**
 * The world as the game master is shown it. Everything is there except the
 * full memory of every character, which would grow without bound: characters
 * in play (present, or named in the player's words) come with the memories
 * that bear on this moment, and the rest only with a count.
 */
export function gameMasterView(world: WorldState, playerText: string): unknown {
  const focus = sceneFocus(world, playerText);
  const characters = Object.fromEntries(
    Object.values(world.characters).map((character) => {
      const inPlay = focus.around.has(character.id) || focus.cues.has(character.id);
      const memories = inPlay ? recall(character.memories, focus, GAME_MASTER_RECALL) : [];
      const omitted = character.memories.length - memories.length;
      return [character.id, { ...character, memories, ...(omitted > 0 ? { memories_not_shown: omitted } : {}) }];
    }),
  );
  return { ...world, characters };
}
