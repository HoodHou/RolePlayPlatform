/**
 * Modules: instruments the game master can be given for a particular kind of
 * play. A module bundles a tool or two whose results the server works out
 * (a skill check, a battle), a slice of state it keeps in `world.modules`, and
 * a panel the UI draws from that state.
 *
 * Modules live in a library the player subscribes from, the way an editor's
 * extensions are installed. A module the player has not subscribed to is never
 * offered to the game master, in any story, whoever chose that story's modules.
 * Among the subscribed ones the player decides which a story has, or leaves it
 * to the game master (see `CreateSessionRequest.modules`); the game master
 * decides when to use them. A module that is off is simply not there: its
 * tools, its part of `record` and its instructions are all left out of the
 * request.
 */
export const MODULE_IDS = [
  'dice',
  'combat',
  'oracle',
  'clocks',
  'calendar',
  'bonds',
  'sandbox',
  'market',
  'clues',
  'travel',
  'deck',
  'reputation',
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** What a module is for, as the library groups them. */
export const MODULE_CATEGORIES = ['rules', 'story', 'world', 'characters'] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export const MODULE_CATEGORY: Record<ModuleId, ModuleCategory> = {
  dice: 'rules',
  combat: 'rules',
  oracle: 'story',
  clocks: 'story',
  calendar: 'world',
  bonds: 'characters',
  sandbox: 'world',
  market: 'world',
  clues: 'story',
  travel: 'world',
  deck: 'rules',
  reputation: 'characters',
};

/** What a fresh install is subscribed to: dice, which every story had before there was a library. */
export const DEFAULT_SUBSCRIPTIONS: ModuleId[] = ['dice'];

export interface LocalizedText {
  en: string;
  zh: string;
}

/** UI metadata carried by an externally installed plugin module. */
export interface PluginLibraryMeta {
  glyph: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  tools: Record<string, { signature: string; description: LocalizedText }>;
  recordDescription?: LocalizedText;
}

/** One module as the library lists it. Its name and description are worded by the UI, per language. */
export interface ModuleLibraryEntry {
  id: ModuleId;
  category: ModuleCategory;
  subscribed: boolean;
  /** Names of the tools it gives the game master. Empty for a module that only keeps records. */
  tools: string[];
  /** Whether it has a section of its own in `record`. */
  keepsRecords: boolean;
  /**
   * Whether it reaches characters who speak for themselves: they are shown
   * some of its state (the board), or what they say back moves it (bonds).
   */
  reachesCharacters: boolean;
  /** Whether it keeps state the world panel draws. */
  hasPanel: boolean;
  /**
   * Roughly how many tokens it adds to every request of a story that has it on
   * (its instructions and schemas), in a story told in that language. An
   * estimate, for comparing modules: real counts depend on the model.
   */
  promptTokens: Record<'en' | 'zh', number>;
  /** Present only for user-installed external plugins. */
  plugin?: PluginLibraryMeta;
}

// --- dice: rolls and skill checks, for tabletop-style play -------------------------

/**
 * The rules a check is rolled by.
 *   d20   roll a d20, add the stat, meet the difficulty. A natural 20 or 1 is a critical or a fumble.
 *   d100  roll a d100 at or under the stat, a percentage. Hard halves the stat, extreme takes a fifth.
 *   2d6   roll 2d6, add the stat: 10 or more succeeds, 7 to 9 succeeds at a cost, less fails.
 */
export const DICE_SYSTEMS = ['d20', 'd100', '2d6'] as const;
export type DiceSystem = (typeof DICE_SYSTEMS)[number];

export const CHECK_DIFFICULTIES = ['easy', 'normal', 'hard', 'extreme'] as const;
export type CheckDifficulty = (typeof CHECK_DIFFICULTIES)[number];

/** `partial` (success at a cost) only comes up under 2d6. */
export const CHECK_OUTCOMES = ['critical', 'success', 'partial', 'failure', 'fumble'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

export interface DiceState {
  /** Chosen by the game master to suit the setting; d20 until it says otherwise. */
  system: DiceSystem;
}

// --- sandbox: powers contending over a map -----------------------------------------

/** How two factions stand toward each other, from open war to alliance. */
export const STANCES = ['war', 'hostile', 'neutral', 'friendly', 'allied'] as const;
export type Stance = (typeof STANCES)[number];

/** The map is a grid of this many cells; a region sits in one of them. */
export const SANDBOX_GRID = { columns: 12, rows: 8 } as const;

/** How many colours factions are told apart by. `SandboxFaction.color` is a slot in that palette. */
export const SANDBOX_COLORS = 8;

/** Something factions count: treasury, grain, troops, stability. Defined per world by the game master. */
export interface SandboxResource {
  id: string;
  name: string;
}

export interface SandboxFaction {
  id: string;
  name: string;
  description: string;
  /** Palette slot, 0 to SANDBOX_COLORS - 1, assigned by the server when the faction is created. */
  color: number;
  /** Id of the character who leads it. They may since have left the cast: then there is no leader to show. */
  leaderId: string | null;
  /** The side the player is on. At most one. */
  isPlayer: boolean;
  /** One line on how it is faring. */
  status: string;
  /** Holdings by resource id. */
  resources: Record<string, number>;
  /** Change per round by resource id, applied when a round passes. May be negative. */
  income: Record<string, number>;
}

export interface SandboxRegion {
  id: string;
  name: string;
  description: string;
  /** Free label: "plains", "mountain pass", "港口". */
  terrain: string;
  /** Faction id, or null when nobody holds it. */
  ownerId: string | null;
  /** Cell on the map grid, 0-based from the top left. */
  x: number;
  y: number;
  /**
   * Ids of regions that border this one. Borders run both ways. An id may name
   * a region the game master has not created (yet): draw a border only where
   * both ends exist.
   */
  neighbors: string[];
  /** How strongly it is held (garrison, walls), when that is tracked. */
  strength: number | null;
}

export interface SandboxRelation {
  /** The two faction ids, in a fixed order: `a < b` as plain strings. */
  a: string;
  b: string;
  stance: Stance;
  note: string;
}

export interface SandboxState {
  /** Rounds played on the board. A round is whatever span the game master runs it in: a season, a month. */
  round: number;
  /** The date on the board, in the setting's own terms: "建安五年·春". */
  period: string;
  resources: SandboxResource[];
  factions: Record<string, SandboxFaction>;
  regions: Record<string, SandboxRegion>;
  /** Pairs with no entry are neutral. */
  relations: SandboxRelation[];
}

// --- oracle: the story's open questions, answered by fate ---------------------------

/** How likely the game master judges a yes to be. */
export const FATE_ODDS = ['almost_impossible', 'unlikely', 'even', 'likely', 'almost_certain'] as const;
export type FateOdds = (typeof FATE_ODDS)[number];

/** The chance of a yes, in percent, for each of the odds. */
export const FATE_CHANCE: Record<FateOdds, number> = {
  almost_impossible: 10,
  unlikely: 30,
  even: 50,
  likely: 70,
  almost_certain: 90,
};

/**
 * What the oracle answers. `_and` is the answer and then some; `_but` is the
 * answer with a catch.
 */
export const FATE_ANSWERS = ['yes_and', 'yes', 'yes_but', 'no_but', 'no', 'no_and'] as const;
export type FateAnswer = (typeof FATE_ANSWERS)[number];

/** Something unasked-for that fate throws in now and then, for the game master to weave into the turn. */
export const FATE_TWISTS = [
  'new_arrival',
  'old_thread',
  'loss',
  'windfall',
  'betrayal',
  'escalation',
  'reversal',
  'revelation',
  'delay',
  'omen',
  'rival_moves',
  'respite',
] as const;
export type FateTwist = (typeof FATE_TWISTS)[number];

// --- clocks: progress toward something, in segments ---------------------------------

export const CLOCK_SEGMENTS = { min: 2, max: 12 } as const;

/** A looming danger, a long task, a rival's plan: it happens when the last segment fills. */
export interface Clock {
  id: string;
  name: string;
  /** What happens when it fills. */
  description: string;
  segments: number;
  /** 0 to `segments`. */
  filled: number;
  /** The game master's own countdown, kept from the player like hidden lore. */
  hidden: boolean;
}

export interface ClocksState {
  clocks: Record<string, Clock>;
}

// --- calendar: a clock for the world, and what is due when --------------------------

export const HOURS_PER_DAY = 24;

export const DAY_PARTS = ['night', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'evening'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** The part of the day an hour (0 to 23) falls in. */
export function dayPart(hour: number): DayPart {
  if (hour < 5) return 'night';
  if (hour < 7) return 'dawn';
  if (hour < 11) return 'morning';
  if (hour < 13) return 'noon';
  if (hour < 17) return 'afternoon';
  if (hour < 19) return 'dusk';
  if (hour < 22) return 'evening';
  return 'night';
}

export const SCHEDULE_STATUSES = ['pending', 'due', 'done', 'cancelled'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** Something set to happen at a time: a deadline, a meeting, a ship's departure. */
export interface ScheduledEvent {
  id: string;
  title: string;
  description: string;
  /** The day it falls on, counted like `CalendarState.day`. */
  day: number;
  /** The hour (0 to 23), or null for "some time that day": then it comes due as the day ends. */
  hour: number | null;
  /** Known to the game master only. */
  hidden: boolean;
  /**
   * `pending` until its time comes, then `due`: the server has told the game
   * master, who settles it as `done` once the story has dealt with it.
   */
  status: ScheduleStatus;
}

export interface CalendarState {
  /** Days since the story began, starting at 1. */
  day: number;
  /** Hour of the day, 0 to 23. */
  hour: number;
  schedule: Record<string, ScheduledEvent>;
}

// --- bonds: how close each character has grown to the player -------------------------

export const BOND_RANGE = { min: -100, max: 100 } as const;

/** Stages a bond passes through, from enmity to devotion. */
export const BOND_STAGES = ['hostile', 'cold', 'neutral', 'warm', 'close', 'devoted'] as const;
export type BondStage = (typeof BOND_STAGES)[number];

/** The stage a score stands for. */
export function bondStage(score: number): BondStage {
  if (score <= -60) return 'hostile';
  if (score <= -20) return 'cold';
  if (score < 20) return 'neutral';
  if (score < 50) return 'warm';
  if (score < 80) return 'close';
  return 'devoted';
}

/** How many past changes a bond remembers. */
export const BOND_HISTORY = 6;

export interface Bond {
  characterId: string;
  /** `BOND_RANGE.min` to `BOND_RANGE.max`; 0 is a stranger. */
  score: number;
  /** What moved it lately, oldest first. */
  history: { turn: number; change: number; reason: string }[];
}

export interface BondsState {
  /** By character id. A character with no entry is a stranger: score 0. */
  bonds: Record<string, Bond>;
}

// --- combat: a fight, tracked round by round -----------------------------------------

export const COMBAT_SIDES = ['player', 'ally', 'enemy', 'neutral'] as const;
export type CombatSide = (typeof COMBAT_SIDES)[number];

/** A natural 20 is a critical (damage dice doubled), a natural 1 a fumble. */
export const ATTACK_OUTCOMES = ['critical', 'hit', 'miss', 'fumble'] as const;
export type AttackOutcome = (typeof ATTACK_OUTCOMES)[number];

export interface Combatant {
  id: string;
  name: string;
  side: CombatSide;
  /** The character in the cast this is, when it is one; null for a passing foe that is no one in particular. */
  characterId: string | null;
  /**
   * For a combatant who is a character: the stat on their sheet that is their
   * health. That stat is then the truth, and `hp` and `maxHp` mirror it.
   */
  hpStat: string | null;
  hp: number;
  maxHp: number;
  /** What an attack roll must meet to hit. */
  defense: number;
  /** Rolled by the server when the fight begins; higher acts first. */
  initiative: number;
  /** Free labels: "prone", "poisoned", "中毒". */
  conditions: string[];
  /** Out of the fight: at 0 health, fled, surrendered. */
  down: boolean;
}

export interface CombatState {
  /** False once the fight is over; what is left is how it ended. */
  active: boolean;
  /** Starts at 1. */
  round: number;
  /** Combatant ids from first to act to last. */
  order: string[];
  combatants: Record<string, Combatant>;
  /** How the last fight ended, in the story language. Empty while one is on. */
  outcome: string;
}

// --- market: shops, wares, coin, and haggling ---------------------------------------

export const HAGGLE_OUTCOMES = ['deal', 'fair', 'refused'] as const;
export type HaggleOutcome = (typeof HAGGLE_OUTCOMES)[number];

export interface MarketWare {
  id: string;
  name: string;
  description: string;
  /** Unit price in the world's currency. */
  price: number;
  /** Units left in stock, or null when the shop does not run out. */
  stock: number | null;
}

export interface MarketShop {
  id: string;
  name: string;
  description: string;
  /** Location id where this shop stands, or null for a travelling peddler. */
  locationId: string | null;
  /** Character id of the merchant who keeps it, when they are in the cast. */
  keeperId: string | null;
  wares: Record<string, MarketWare>;
}

export interface MarketState {
  /** Display name of the currency in the setting ("银两", "Crowns", "Credits"). */
  currency: string;
  /** Name of the stat on the player's sheet that holds their balance, when mirrored there. */
  currencyStat: string | null;
  shops: Record<string, MarketShop>;
}

// --- clues: evidence, links, and deductions on an investigation board --------------

export const CLUE_KINDS = ['evidence', 'testimony', 'observation', 'document'] as const;
export type ClueKind = (typeof CLUE_KINDS)[number];

export const DEDUCTION_STATUSES = ['open', 'confirmed', 'disproven'] as const;
export type DeductionStatus = (typeof DEDUCTION_STATUSES)[number];

export interface Clue {
  id: string;
  title: string;
  description: string;
  kind: ClueKind;
  /** Where or from whom it was found, in the story language. */
  source: string;
  /** Ids of other clues connected to this one on the board (bidirectional). */
  links: string[];
  /** Known to the game master only until discovered by the player. */
  hidden: boolean;
}

export interface Deduction {
  id: string;
  /** The hypothesis or question being weighed. */
  title: string;
  /** Reasoning or conclusion drawn from the clues. */
  conclusion: string;
  /** Ids of clues that bear on this deduction. */
  clueIds: string[];
  status: DeductionStatus;
}

export interface CluesState {
  clues: Record<string, Clue>;
  deductions: Record<string, Deduction>;
}

// --- travel: routes between places, road hazards, and journeys ---------------------

export const ROUTE_HAZARDS = ['safe', 'watchful', 'perilous', 'deadly'] as const;
export type RouteHazard = (typeof ROUTE_HAZARDS)[number];

export const TRAVEL_PACES = ['cautious', 'normal', 'forced'] as const;
export type TravelPace = (typeof TRAVEL_PACES)[number];

export const JOURNEY_OUTCOMES = ['clear', 'discovery', 'omen', 'hazard', 'ambush'] as const;
export type JourneyOutcome = (typeof JOURNEY_OUTCOMES)[number];

export interface TravelRoute {
  id: string;
  name: string;
  description: string;
  /** The two location ids the route connects. */
  fromId: string;
  toId: string;
  /** Travel time at a normal pace, in hours. */
  hours: number;
  /** Free label: "mountain pass", "river", "古道". */
  terrain: string;
  hazard: RouteHazard;
  /** Known to the player; false for a secret path until found. */
  discovered: boolean;
  /** Impassable until cleared (flooded bridge, sealed gate). */
  blocked: boolean;
}

export interface TravelState {
  routes: Record<string, TravelRoute>;
  /** Total hours spent on the road across the story. */
  hoursTravelled: number;
}

// --- deck: card draws without replacement and weighted random tables ---------------

export interface DeckCard {
  id: string;
  name: string;
  /** Meaning when drawn upright (or its sole meaning when reversals are not used). */
  upright: string;
  /** Meaning when drawn reversed; empty when the deck does not use reversals. */
  reversed: string;
}

export interface DrawnCard {
  id: string;
  name: string;
  reversed: boolean;
  meaning: string;
  turn: number;
  reason: string;
}

export interface CardDeck {
  id: string;
  name: string;
  description: string;
  /** Whether drawn cards can come up reversed (50% chance). */
  reversals: boolean;
  /** Cards still in the draw pile, in order. */
  remaining: DeckCard[];
  /** Cards already drawn, in the order they were drawn. */
  drawn: DrawnCard[];
}

export interface RandomTableEntry {
  id: string;
  label: string;
  description: string;
  /** Relative weight (1 or more). */
  weight: number;
}

export interface RandomTable {
  id: string;
  name: string;
  description: string;
  entries: RandomTableEntry[];
}

export interface DeckState {
  decks: Record<string, CardDeck>;
  tables: Record<string, RandomTable>;
}

// --- reputation: standing, titles, and heat with groups and places -----------------

export const REPUTATION_RANGE = { min: -100, max: 100 } as const;
export const HEAT_RANGE = { min: 0, max: 10 } as const;
export const REPUTATION_HISTORY = 6;

export const REPUTATION_TIERS = ['hunted', 'reviled', 'distrusted', 'neutral', 'respected', 'revered'] as const;
export type ReputationTier = (typeof REPUTATION_TIERS)[number];

/** The public standing tier a reputation score stands for. */
export function reputationTier(score: number): ReputationTier {
  if (score <= -60) return 'hunted';
  if (score <= -25) return 'reviled';
  if (score <= -10) return 'distrusted';
  if (score < 25) return 'neutral';
  if (score < 65) return 'respected';
  return 'revered';
}

export interface ReputationStanding {
  id: string;
  name: string;
  description: string;
  /** `REPUTATION_RANGE.min` to `REPUTATION_RANGE.max`; 0 is unremarked. */
  score: number;
  /** Public epithet or rank held among this group ("Sworn Friend", "钦犯"). Empty when none. */
  title: string;
  /** Wanted or heat level with this group, 0 (none) to `HEAT_RANGE.max`. */
  heat: number;
  /** Recent shifts in standing, oldest first. */
  history: { turn: number; change: number; reason: string }[];
}

export interface ReputationState {
  standings: Record<string, ReputationStanding>;
}

// --- external plugin manifests and state -------------------------------------------

export interface PluginFieldSpec {
  key: string;
  label: LocalizedText;
  type: 'string' | 'number' | 'boolean';
  description?: string;
  min?: number;
  max?: number;
}

export interface PluginToolSpec {
  name: string;
  description: string;
  /** How the server resolves a call to this tool. */
  kind: 'roll' | 'table' | 'counter';
  /** For `roll`: default dice notation (e.g. "2d6", "1d100"). */
  dice?: string;
  /** For `roll`: target number to meet (or roll under when `rollUnder` is true). */
  target?: number;
  rollUnder?: boolean;
  /** For `table`: weighted outcomes the server picks from at random. */
  entries?: { label: string; description?: string; weight?: number }[];
  /** For `counter`: key of a numeric field in the plugin's state to adjust. */
  counterKey?: string;
  /** Display signature in the library UI, e.g. "cast_spell(power, risk?)". */
  signature?: string;
  /** Description in the library UI. */
  uiDescription?: LocalizedText;
}

export interface PluginManifest {
  /** Unique module id (lowercase letters, digits, underscores, e.g. "alchemy" or "sanity"). */
  id: string;
  category: ModuleCategory;
  glyph?: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  /** Instructions added to the game master's system prompt when this module is active. */
  guide: LocalizedText;
  /** Whether the GM keeps this module on opening when it did not explicitly list modules. */
  keptWhenUnused?: boolean;
  /** Whether to expose this plugin's state to characters in `talk` turns. */
  reachesCharacters?: boolean;
  /** Optional record schema for `record.<id>`: lets the GM track entries/meters in `world.modules.custom[id]`. */
  record?: {
    description: string;
    uiDescription?: LocalizedText;
    fields: PluginFieldSpec[];
  };
  /** Optional server-executed tools provided by this plugin. */
  tools?: PluginToolSpec[];
}

export interface CustomModuleEntry {
  id: string;
  name: string;
  values: Record<string, string | number | boolean>;
}

export interface CustomModuleState {
  id: string;
  name: string;
  entries: Record<string, CustomModuleEntry>;
}

/**
 * Each module's state, present once the game master has set that module up.
 * The oracle keeps none.
 */
export interface ModuleStates {
  dice?: DiceState;
  combat?: CombatState;
  clocks?: ClocksState;
  calendar?: CalendarState;
  bonds?: BondsState;
  sandbox?: SandboxState;
  market?: MarketState;
  clues?: CluesState;
  travel?: TravelState;
  deck?: DeckState;
  reputation?: ReputationState;
  custom?: Record<string, CustomModuleState>;
}
