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
  'court',
  'lineage',
  'domain',
  'espionage',
  'progression',
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
  court: 'world',
  lineage: 'characters',
  domain: 'world',
  espionage: 'story',
  progression: 'rules',
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

/** Strategic landmark archetypes used for map tokens and siege modifiers. */
export const SANDBOX_REGION_KINDS = ['capital', 'pass', 'fortress', 'city', 'frontier', 'wilderness'] as const;
export type SandboxRegionKind = (typeof SANDBOX_REGION_KINDS)[number];

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
  /** Optional strategic landmark kind; inferred from name/terrain on legacy saves when omitted. */
  kind?: SandboxRegionKind;
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
  /** Garrison troop strength, when tracked. */
  strength: number | null;
  /** Wall and fortification rating, 0 to 100. */
  defense?: number;
  /** Local public order, morale and livelihood stability, 0 to 100. */
  stability?: number;
  /** Tax base, farmland and trade prosperity index, 0 to 100. */
  prosperity?: number;
  /** Character id (`world.characters`) of the stationed general or governor, if any. */
  commanderId?: string | null;
  /** Short regional condition or crisis tag ("大旱赤地", "流民四起", "重兵云集"). */
  status?: string;
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

const CRISIS_RE = /旱|灾|乱|叛|饥|匪|疫|流民|unrest|famine|drought|rebel|plague|siege|围困|残破/i;
const GRAIN_RE = /grain|food|ration|rice|wheat|provision|粮|粟|米|草料|刍/i;
const MANPOWER_RE = /troop|manpower|soldier|army|levy|recruit|reserve|force|兵|军|丁|卒|骑|动员|预备/i;
const FUNDS_RE = /silver|gold|treasury|coin|money|wealth|credit|fund|银|金|钱|库|饷|财|两|贯|钞/i;

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Infers a region's strategic landmark archetype when not explicitly recorded. */
export function inferSandboxRegionKind(
  region: Pick<SandboxRegion, 'name' | 'terrain' | 'ownerId' | 'kind'>,
): SandboxRegionKind {
  if (region.kind && (SANDBOX_REGION_KINDS as readonly string[]).includes(region.kind)) {
    return region.kind;
  }
  const text = `${region.name} ${region.terrain}`;
  if (/京|都|皇城|王城|capital|throne|imperial/i.test(text)) return 'capital';
  if (/关(?!外|内|中|东|西)|隘|山口|峡口|\bpass\b|\bgate\b/i.test(text)) return 'pass';
  if (/军镇|边镇|卫所|镇|堡|卫|寨|营|fort|bastion|garrison|stronghold|citadel|keep/i.test(text)) return 'fortress';
  if (/关外|塞外|草原|边塞|边疆|北疆|steppe|frontier|march|borderland/i.test(text)) return 'frontier';
  if (/荒|漠|野|泽|林|旱区|waste|desert|marsh|fens|wild/i.test(text)) return 'wilderness';
  return 'city';
}

export function sandboxRegionDefense(region: SandboxRegion): number {
  if (typeof region.defense === 'number' && Number.isFinite(region.defense)) {
    return clampPercent(region.defense);
  }
  const kind = inferSandboxRegionKind(region);
  const base: Record<SandboxRegionKind, number> = {
    capital: 75,
    pass: 80,
    fortress: 70,
    city: 55,
    frontier: 40,
    wilderness: 25,
  };
  return base[kind];
}

export function sandboxRegionStability(region: SandboxRegion): number {
  if (typeof region.stability === 'number' && Number.isFinite(region.stability)) {
    return clampPercent(region.stability);
  }
  const cue = `${region.name} ${region.status ?? ''} ${region.description}`;
  if (CRISIS_RE.test(cue)) return 28;
  if (!region.ownerId) return 42;
  return 68;
}

export function sandboxRegionProsperity(region: SandboxRegion): number {
  if (typeof region.prosperity === 'number' && Number.isFinite(region.prosperity)) {
    return clampPercent(region.prosperity);
  }
  const kind = inferSandboxRegionKind(region);
  const base: Record<SandboxRegionKind, number> = {
    capital: 80,
    city: 65,
    pass: 45,
    fortress: 45,
    frontier: 35,
    wilderness: 20,
  };
  const cue = `${region.name} ${region.status ?? ''} ${region.description}`;
  return clampPercent(base[kind] - (CRISIS_RE.test(cue) ? 20 : 0));
}

export interface MatchedSandboxPools {
  funds?: SandboxResource;
  grain?: SandboxResource;
  manpower?: SandboxResource;
}

/** Matches free-form world resources ("可用银两估计", "Gold", "粮草", "可动员兵力") to strategic roles. */
export function matchSandboxResourcePools(board: SandboxState): MatchedSandboxPools {
  const labelOf = (r: SandboxResource) => `${r.id} ${r.name}`;
  const grain = board.resources.find((r) => GRAIN_RE.test(labelOf(r)));
  const manpower = board.resources.find((r) => r.id !== grain?.id && MANPOWER_RE.test(labelOf(r)));
  const funds =
    board.resources.find((r) => r.id !== grain?.id && r.id !== manpower?.id && FUNDS_RE.test(labelOf(r))) ??
    board.resources.find((r) => r.id !== grain?.id && r.id !== manpower?.id);
  return {
    ...(funds ? { funds } : {}),
    ...(grain ? { grain } : {}),
    ...(manpower ? { manpower } : {}),
  };
}

/** Rounds a raw estimate to a clean human-friendly strategy integer (e.g. 5, 10, 250, 1000, 3000). */
export function niceSandboxNumber(raw: number, min = 1): number {
  if (!Number.isFinite(raw) || raw <= min) return min;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** Math.max(0, exp - 1);
  if (base <= 1) return Math.max(min, Math.round(raw));
  const steps = [10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100];
  const scaled = raw / base;
  let best = steps[0]!;
  let bestDiff = Infinity;
  for (const s of steps) {
    const diff = Math.abs(scaled - s);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return Math.max(min, best * base);
}

/** Returns 3 clean batch presets (small / standard / heavy) calibrated to an available garrison or reserve pool. */
export function sandboxStepPresets(available: number): number[] {
  const cap = Math.floor(Math.max(0, available));
  if (cap <= 0) return [];
  if (cap <= 3) return [1, cap].filter((v, i, a) => v <= cap && a.indexOf(v) === i);
  const candidates = [
    niceSandboxNumber(cap * 0.15, 1),
    niceSandboxNumber(cap * 0.35, 1),
    niceSandboxNumber(cap * 0.7, 1),
  ].map((v) => Math.min(v, cap));
  return [...new Set(candidates.filter((v) => v > 0))].sort((a, b) => a - b);
}

export interface SandboxEconomicScale {
  fortifyCost: number;
  pacifyGrainCost: number;
  pacifyFundsCost: number;
  developCost: number;
  developFundsYield: number;
  developGrainYield: number;
  costPerTroop: number;
}

/** Calibrates decree costs and yields proportionally to the campaign's resource scale. */
export function sandboxEconomicScale(board: SandboxState): SandboxEconomicScale {
  const pools = matchSandboxResourcePools(board);
  const player = Object.values(board.factions).find((f) => f.isPlayer);
  const maxHeld = (resId: string | undefined) =>
    resId ? Math.max(0, ...Object.values(board.factions).map((f) => f.resources[resId] ?? 0)) : 0;

  const fundsId = pools.funds?.id;
  const grainId = pools.grain?.id;
  const manpowerId = pools.manpower?.id;

  const fundsRef = fundsId
    ? Math.max(player?.resources[fundsId] ?? 0, Math.abs(player?.income[fundsId] ?? 0) * 4, maxHeld(fundsId), 25)
    : 100;
  const grainRef = grainId
    ? Math.max(player?.resources[grainId] ?? 0, Math.abs(player?.income[grainId] ?? 0) * 4, maxHeld(grainId), 25)
    : fundsRef;

  const maxRegionStrength = Math.max(0, ...Object.values(board.regions).map((r) => r.strength ?? 0));
  const troopRef = Math.max(
    manpowerId ? (player?.resources[manpowerId] ?? 0) : 0,
    maxRegionStrength * 3,
    20,
  );

  const fortifyCost = fundsId ? niceSandboxNumber(fundsRef * 0.04, 5) : 0;
  const pacifyFundsCost = fundsId ? niceSandboxNumber(fundsRef * 0.035, 5) : 0;
  const pacifyGrainCost = grainId ? niceSandboxNumber(grainRef * 0.1, 5) : 0;
  const developCost = fundsId ? niceSandboxNumber(fundsRef * 0.05, 5) : 0;
  const developFundsYield = fundsId ? niceSandboxNumber(Math.max(1, developCost * 0.3), 1) : 0;
  const developGrainYield = grainId ? niceSandboxNumber(Math.max(1, grainRef * 0.03), 1) : 0;
  const costPerTroop = fundsId ? Math.min(10, Math.max(0.05, fundsRef / (troopRef * 2))) : 0;

  return {
    fortifyCost,
    pacifyGrainCost,
    pacifyFundsCost,
    developCost,
    developFundsYield,
    developGrainYield,
    costPerTroop,
  };
}

/** True when `fromId` and `toId` are owned by `factionId` and linked through an unbroken chain of `factionId` regions. */
export function areFriendlyRegionsConnected(
  board: SandboxState,
  fromId: string,
  toId: string,
  factionId: string,
): boolean {
  if (fromId === toId) return false;
  const start = board.regions[fromId];
  const goal = board.regions[toId];
  if (!start || !goal || start.ownerId !== factionId || goal.ownerId !== factionId) return false;

  const visited = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length > 0) {
    const currId = queue.shift()!;
    const curr = board.regions[currId];
    if (!curr) continue;
    for (const other of Object.values(board.regions)) {
      if (visited.has(other.id) || other.ownerId !== factionId) continue;
      if (curr.neighbors.includes(other.id) || other.neighbors.includes(currId)) {
        if (other.id === toId) return true;
        visited.add(other.id);
        queue.push(other.id);
      }
    }
  }
  return false;
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

// --- court: imperial council, registered ministers, memorials, and edicts ----------

export const MEMORIAL_URGENCIES = ['routine', 'urgent', 'secret'] as const;
export type MemorialUrgency = (typeof MEMORIAL_URGENCIES)[number];

export const MEMORIAL_STATUSES = ['pending', 'approved', 'rejected', 'shelved'] as const;
export type MemorialStatus = (typeof MEMORIAL_STATUSES)[number];

export const COURT_DOMAINS = ['governance', 'military', 'intrigue'] as const;
export type CourtDomain = (typeof COURT_DOMAINS)[number];

export const COURT_OUTCOMES = ['smooth', 'compromise', 'deadlock', 'backlash'] as const;
export type CourtOutcome = (typeof COURT_OUTCOMES)[number];

export interface CourtMetric {
  id: string;
  name: string;
  value: number;
  max?: number;
  /** Most recent change applied to this metric. */
  delta: number;
}

export interface CourtFaction {
  id: string;
  name: string;
  description: string;
  leaderId: string | null;
  /** Share of political influence at court, 0 to 100. */
  influence: number;
  /** Agenda or political posture ("清流守成", "边功主战", "外戚专权"). */
  stance: string;
}

export interface CourtOfficial {
  /** Matches a `Character.id` in `world.characters`. */
  characterId: string;
  /** Official office or post ("内阁首辅", "兵部尚书", "江南巡抚"). */
  office: string;
  /** Ministry, organ, or branch ("内阁", "六部", "都察院", "边镇"). */
  department: string;
  /** Rank label ("正一品", "从二品", "Senior Councilor"). */
  rank: string;
  factionId: string | null;
  /** Allegiance to the sovereign, 0 to 100. */
  loyalty: number;
  /** Political weight at court, 0 to 100. */
  influence: number;
  /** Civil governance & statecraft, 0 to 100. */
  governance: number;
  /** Military command & strategy, 0 to 100. */
  military: number;
  /** Court intrigue & maneuvering, 0 to 100. */
  intrigue: number;
  /** Current commission or active duty ("督理漕运", "镇守雁门关"). */
  assignment: string;
}

export interface CourtMemorial {
  id: string;
  /** Character id of the petitioner when they are in the cast. */
  authorId: string | null;
  /** Display name of the petitioner when outside the cast or mirrored from it. */
  authorName: string;
  title: string;
  summary: string;
  /** Concrete course of action requested in the memorial. */
  proposal: string;
  urgency: MemorialUrgency;
  status: MemorialStatus;
  /** The sovereign's rescript ("朱批") once answered. */
  ruling: string;
  turn: number;
}

export interface CourtEdict {
  id: string;
  title: string;
  description: string;
  /** Ongoing rule or realm effect while active. */
  effect: string;
  active: boolean;
  turnIssued: number;
}

export interface CourtState {
  regimeName: string;
  rulerTitle: string;
  sessionsHeld: number;
  metrics: CourtMetric[];
  factions: Record<string, CourtFaction>;
  /** Keyed by `characterId`. */
  officials: Record<string, CourtOfficial>;
  memorials: Record<string, CourtMemorial>;
  edicts: Record<string, CourtEdict>;
}

// --- lineage: inner court consorts, heirs, tutors, and dynastic clan ---------------

export const HEIR_APTITUDES = ['governance', 'martial', 'virtue', 'learning'] as const;
export type HeirAptitudeKey = (typeof HEIR_APTITUDES)[number];

export const NURTURE_INTENSITIES = ['gentle', 'strict', 'harsh'] as const;
export type NurtureIntensity = (typeof NURTURE_INTENSITIES)[number];

export const NURTURE_OUTCOMES = ['breakthrough', 'steady', 'strained', 'resisted'] as const;
export type NurtureOutcome = (typeof NURTURE_OUTCOMES)[number];

export interface ConsortEntry {
  characterId: string;
  /** Rank or investiture title ("皇后", "皇贵妃", "贵嫔", "王夫"). */
  title: string;
  /** 1 = highest rank, ascending downward for display order. */
  rankOrder: number;
  /** Residence or hall ("坤宁宫", "永寿宫"). */
  palace: string;
  /** Sovereign favor, 0 to 100. */
  favor: number;
  /** Maternal clan or noble backing ("清河崔氏·礼部尚书之女"). */
  familyBackground: string;
}

export interface HeirAptitude {
  governance: number;
  martial: number;
  virtue: number;
  learning: number;
}

export interface HeirEntry {
  characterId: string;
  /** Birth order or style ("皇长子", "皇嫡次女"). */
  order: string;
  /** Princely or noble title ("东宫太子", "燕王", "长乐公主"). */
  title: string;
  /** Character ids of known parents in the cast. */
  parentIds: string[];
  /** Character id of assigned grand tutor ("太傅/授业恩师"), if any. */
  tutorId: string | null;
  /** Designated crown successor. At most one true at a time. */
  isHeirApparent: boolean;
  aptitude: HeirAptitude;
  /** Faction or maternal house backing this heir. */
  backing: string;
}

export interface ClanRelative {
  characterId: string;
  /** Kinship to the sovereign ("皇叔", "圣母皇太后", "国舅"). */
  relation: string;
  title: string;
  influence: number;
  note: string;
}

export interface LineageState {
  houseName: string;
  successionLaw: string;
  consorts: Record<string, ConsortEntry>;
  heirs: Record<string, HeirEntry>;
  relatives: Record<string, ClanRelative>;
}

// --- domain: seat construction, facilities, yields, and NPC stewards ---------------

export const FACILITY_STATUSES = ['operational', 'building', 'damaged'] as const;
export type FacilityStatus = (typeof FACILITY_STATUSES)[number];

export const DOMAIN_CYCLE_OUTCOMES = ['bountiful', 'steady', 'delayed', 'setback'] as const;
export type DomainCycleOutcome = (typeof DOMAIN_CYCLE_OUTCOMES)[number];

export interface DomainResource {
  id: string;
  name: string;
  amount: number;
  /** Net yield per development cycle. */
  perCycle: number;
}

export interface DomainFacility {
  id: string;
  name: string;
  category: string;
  level: number;
  maxLevel: number;
  status: FacilityStatus;
  /** Construction or repair progress (0 to `segments`). */
  progress: number;
  segments: number;
  /** Character id of the NPC assigned to oversee or garrison this facility. */
  stewardId: string | null;
  output: string;
  description: string;
}

export interface DomainState {
  name: string;
  tier: string;
  locationId: string | null;
  cycles: number;
  resources: DomainResource[];
  facilities: Record<string, DomainFacility>;
}

// --- espionage: secret police, covert agents, surveillance, and dossiers -----------

export const SPY_STATUSES = ['active', 'compromised', 'recalled'] as const;
export type SpyStatus = (typeof SPY_STATUSES)[number];

export const ESPIONAGE_OPERATIONS = ['recon', 'infiltrate', 'wiretap', 'frame', 'subvert', 'raid'] as const;
export type EspionageOperation = (typeof ESPIONAGE_OPERATIONS)[number];

export const OPERATION_OUTCOMES = ['triumph', 'success', 'partial', 'blown'] as const;
export type OperationOutcome = (typeof OPERATION_OUTCOMES)[number];

export interface SpyAgent {
  id: string;
  /** Character id when the operative is a named cast member. */
  characterId: string | null;
  codename: string;
  cover: string;
  targetId: string | null;
  targetName: string;
  /** Penetration depth on target, 0 to 100. */
  infiltration: number;
  /** Suspicion / exposure heat, 0 to 10. At 10 the agent becomes `compromised`. */
  exposure: number;
  status: SpyStatus;
}

export interface IntelDossier {
  id: string;
  subjectId: string | null;
  subjectName: string;
  title: string;
  summary: string;
  /** Actionable blackmail, proof, or secret leverage. */
  leverage: string;
  verified: boolean;
  /** True while kept by the GM before spies uncover it. */
  hidden: boolean;
}

export interface EspionageState {
  agencyName: string;
  commanderId: string | null;
  /** Overall surveillance grip, 0 to 100. */
  networkPower: number;
  agents: Record<string, SpyAgent>;
  dossiers: Record<string, IntelDossier>;
}

// --- progression: cultivation realms / class tiers, XP gauge, and abilities --------

export const BREAKTHROUGH_OUTCOMES = ['transcendent', 'success', 'stalled', 'backlash'] as const;
export type BreakthroughOutcome = (typeof BREAKTHROUGH_OUTCOMES)[number];

export interface ProgressionAbility {
  id: string;
  name: string;
  category: string;
  rank: string;
  equipped: boolean;
  cost: string;
  description: string;
}

export interface ProgressionState {
  systemName: string;
  realm: string;
  subRealm: string;
  ladder: string[];
  xp: number;
  xpMax: number;
  bottleneck: string;
  /** Inner demon / qi deviation / strain risk, 0 to 100. */
  deviation: number;
  abilities: Record<string, ProgressionAbility>;
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
  court?: CourtState;
  lineage?: LineageState;
  domain?: DomainState;
  espionage?: EspionageState;
  progression?: ProgressionState;
  custom?: Record<string, CustomModuleState>;
}
