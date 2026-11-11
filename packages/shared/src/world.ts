import type { ModuleStates } from './modules';

/**
 * The world model. Everything in here is authored by the game master (the
 * model) through tools; the UI only renders it.
 */

export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

/** A free-form attribute the game master defines per world: HP, Gold, Sanity, 灵力… */
export interface Stat {
  name: string;
  value: number | string;
  /** Upper bound of a numeric stat. Present when the stat should render as a gauge. */
  max?: number;
}

/**
 * One thing a character remembers. A character's memories are everything they
 * know of the story: only what they witnessed or were told, in their own view
 * of it. What is not here, they do not know.
 */
export interface Memory {
  id: string;
  /** The turn it was formed in. */
  turn: number;
  /** In-world time, as the scene's clock read then. */
  time: string;
  /** Where the character was. */
  locationId: string | null;
  /** The memory, from this character's point of view. */
  text: string;
  /** Ids of the characters, places and things it concerns. Brings it back to mind when they come up. */
  about: string[];
  /** 1 (in passing) to 5 (never forgotten). */
  importance: number;
  /** Who told them, when they did not witness it themselves. Hearsay may be wrong. */
  toldBy?: string;
}

export interface Character {
  id: string;
  name: string;
  isPlayer: boolean;
  /** Short label: "innkeeper", "rival cultivator". */
  role: string;
  description: string;
  /** Concrete visual traits for consistent portraits: age, face, hair, build, attire. */
  appearance: string;
  personality: string;
  /** What they are doing or what condition they are in right now. */
  status: string;
  /** How they feel about the player. Empty for the player character. */
  attitude: string;
  locationId: string | null;
  stats: Stat[];
  /** Portrait, once the game master has had one painted. A path on this server. */
  imageUrl?: string;

  // The character's mind. All of it is hidden from the player by default, like
  // hidden lore: it is what makes them themselves, not what they would tell you.
  /** How they speak: register, habits, a sample line. Keeps them sounding like themselves. */
  voice: string;
  /** What they want right now. */
  goals: string;
  /** What they are hiding. Known to them and the game master only. */
  secrets: string;
  /** What they remember, oldest first. Always empty for the player character. */
  memories: Memory[];
}

export interface Location {
  id: string;
  name: string;
  description: string;
  /** Ids of locations reachable from here. */
  connections: string[];
  imageUrl?: string;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  quantity: number;
  /** A character id, or null when the item belongs to nobody. */
  ownerId: string | null;
  imageUrl?: string;
}

export type QuestStatus = 'active' | 'completed' | 'failed';

export interface Quest {
  id: string;
  title: string;
  description: string;
  status: QuestStatus;
  /** Free-text note on how far along the quest is. */
  progress: string;
}

export interface LoreEntry {
  id: string;
  title: string;
  content: string;
  /** Game master's private notes (secrets, plans). Hidden from the player by default. */
  hidden: boolean;
}

export interface Scene {
  locationId: string | null;
  /** In-world time, in whatever form fits the setting: "Dusk, day 3". */
  time: string;
  weather: string;
  /** One line on what is going on right now. */
  summary: string;
}

export const CHRONICLE_KINDS = [
  'milestone',
  'turning_point',
  'decree',
  'battle',
  'alliance',
  'betrayal',
  'revelation',
  'consequence',
] as const;
export type ChronicleKind = (typeof CHRONICLE_KINDS)[number];

/** Current macro chapter / narrative phase of the story. */
export interface StoryArc {
  /** Current chapter or act title, e.g. "第一卷：辽沈烽烟" or "Act I: The Drowned Road". */
  chapter: string;
  /** Concise macro summary of where the overarching plot stands right now. */
  summary: string;
  /** Active narrative tensions, looming crises, or unresolved plot threads. */
  threads: string[];
}

/** One pivotal plot milestone recorded on the campaign chronicle timeline. */
export interface ChronicleEntry {
  id: string;
  turn: number;
  time: string;
  kind: ChronicleKind;
  title: string;
  summary: string;
  /** Resulting shift in power, stakes, or relationships. */
  impact: string;
  /** True if known only behind the scenes (hidden from NPCs and hidden from player unless secrets are revealed). */
  secret: boolean;
  /** True when the event is realm-wide / public news that characters across the world would have heard of. */
  public?: boolean;
}

export interface WorldState {
  title: string;
  premise: string;
  /** The look every illustration of this world shares: "ink wash, muted palette". */
  artStyle: string;
  scene: Scene;
  playerId: string | null;
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  items: Record<string, Item>;
  quests: Record<string, Quest>;
  lore: Record<string, LoreEntry>;
  /** State kept by the play modules this story uses (see modules.ts). */
  modules: ModuleStates;
  /** Next moves the game master proposes; replaced every turn. */
  suggestions: string[];
  /** Current overarching chapter, situation, and active narrative threads. */
  storyArc: StoryArc;
  /** Ordered timeline of pivotal plot milestones and turning points across turns. */
  chronicle: ChronicleEntry[];
  /** Rolling recap of earlier chapters once older turns slide out of the transcript window. */
  storySummary: string;
  /** Highest turn number already folded into `storySummary`. */
  summarizedUpToTurn: number;
  /** Number of turns played. 0 means the opening scene has not been generated. */
  turn: number;
}

export function createEmptyWorld(): WorldState {
  return {
    title: '',
    premise: '',
    artStyle: '',
    scene: { locationId: null, time: '', weather: '', summary: '' },
    playerId: null,
    characters: {},
    locations: {},
    items: {},
    quests: {},
    lore: {},
    modules: {},
    suggestions: [],
    storyArc: { chapter: '', summary: '', threads: [] },
    chronicle: [],
    storySummary: '',
    summarizedUpToTurn: 0,
    turn: 0,
  };
}
