import {
  areFriendlyRegionsConnected,
  inferSandboxRegionKind,
  matchSandboxResourcePools,
  niceSandboxNumber,
  SANDBOX_COLORS,
  SANDBOX_GRID,
  SANDBOX_REGION_KINDS,
  sandboxEconomicScale,
  sandboxRegionDefense,
  sandboxRegionProsperity,
  sandboxRegionStability,
  STANCES,
  type BattleMargin,
  type SandboxFaction,
  type SandboxRegion,
  type SandboxRegionKind,
  type SandboxState,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { asParts, entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool, type ToolContext } from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * The sandbox, for stories about powers contending over territory: a board of
 * regions, the factions that hold them and what each faction has. The game
 * master sets the board up and keeps it in step with the story through
 * `record.sandbox`; battles and the passing of rounds it hands to `simulate`,
 * so that who wins a war is not simply whatever the storyteller fancies.
 */

export const SIMULATE = 'simulate';

function emptyBoard(): SandboxState {
  return { round: 0, period: '', resources: [], factions: {}, regions: {}, relations: [] };
}

const unique = (ids: string[]) => [...new Set(ids.map((value) => value.trim()).filter(Boolean))];
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function requireName(value: string | undefined, kind: string, entryId: string): string {
  const name = value?.trim();
  if (!name) throw new WorldOpError(`${kind} "${entryId}" does not exist yet. Include "name" to create it.`);
  return name;
}

function requireFaction(board: SandboxState, factionId: string): SandboxFaction {
  const faction = board.factions[factionId];
  if (!faction) {
    const known = Object.keys(board.factions).join(', ') || 'none yet';
    throw new WorldOpError(`There is no faction with id "${factionId}". Factions on the board: ${known}.`);
  }
  return faction;
}

function requireResource(board: SandboxState, resourceId: string): string {
  const resource = board.resources.find((entry) => entry.id === resourceId);
  if (!resource) {
    const known = board.resources.map((entry) => entry.id).join(', ') || 'none yet';
    throw new WorldOpError(`There is no resource with id "${resourceId}". Resources defined: ${known}. Define it under sandbox.resources first.`);
  }
  return resource.name;
}

// --- the board ----------------------------------------------------------------

function defineResource(board: SandboxState, entry: { id: string; name?: string }): WorldEvent[] {
  const existing = board.resources.find((resource) => resource.id === entry.id);
  if (existing) {
    if (entry.name?.trim()) existing.name = entry.name.trim();
  } else {
    board.resources.push({ id: entry.id, name: requireName(entry.name, 'Resource', entry.id) });
  }
  return [];
}

/** The first palette slot no faction uses yet, so neighbours on the map are told apart. */
function freeColor(board: SandboxState): number {
  const taken = new Set(Object.values(board.factions).map((faction) => faction.color));
  for (let slot = 0; slot < SANDBOX_COLORS; slot++) if (!taken.has(slot)) return slot;
  return Object.keys(board.factions).length % SANDBOX_COLORS;
}

interface Amount {
  id: string;
  value?: number;
  change?: number;
}

function upsertFaction(
  world: WorldState,
  board: SandboxState,
  entry: {
    id: string;
    name?: string;
    description?: string;
    leader_id?: string | null;
    is_player?: boolean;
    status?: string;
    resources?: Amount[];
    income?: { id: string; value: number }[];
  },
): WorldEvent[] {
  // Everything that can be wrong with the entry is checked before anything is
  // written, so an entry that is rejected leaves no trace on the board.
  if (entry.leader_id && !world.characters[entry.leader_id]) {
    throw new WorldOpError(`Character "${entry.leader_id}" does not exist, so they cannot lead a faction. Record them under characters first.`);
  }
  let faction = board.factions[entry.id];
  const created = !faction;
  const newName = created ? requireName(entry.name, 'Faction', entry.id) : entry.name?.trim();
  for (const named of [...(entry.resources ?? []), ...(entry.income ?? [])]) requireResource(board, named.id);

  const events: WorldEvent[] = [];
  if (!faction) {
    const name = newName ?? '';
    faction = {
      id: entry.id,
      name,
      description: '',
      color: freeColor(board),
      leaderId: null,
      isPlayer: false,
      status: '',
      resources: {},
      income: {},
    };
    board.factions[entry.id] = faction;
    events.push({ type: 'faction_added', id: entry.id, name });
  } else if (newName) {
    faction.name = newName;
  }

  if (entry.description !== undefined) faction.description = entry.description;
  if (entry.status !== undefined) faction.status = entry.status;
  if (entry.leader_id !== undefined) faction.leaderId = entry.leader_id;
  if (entry.is_player !== undefined) {
    // The player is on one side at a time; changing sides is allowed.
    if (entry.is_player) for (const other of Object.values(board.factions)) other.isPlayer = false;
    faction.isPlayer = entry.is_player;
  }

  for (const amount of entry.resources ?? []) {
    const resource = requireResource(board, amount.id);
    const before = faction.resources[amount.id] ?? 0;
    const after = Math.min(Math.max(amount.value ?? before + (amount.change ?? 0), 0), AMOUNT_LIMIT);
    faction.resources[amount.id] = after;
    // What the player's side gains and loses is worth a line; its starting stock is not.
    if (!created && faction.isPlayer && after !== before) {
      events.push({ type: 'resource_changed', factionId: faction.id, factionName: faction.name, resource, from: before, to: after });
    }
  }
  for (const income of entry.income ?? []) {
    requireResource(board, income.id);
    if (income.value === 0) delete faction.income[income.id];
    else faction.income[income.id] = income.value;
  }
  return events;
}

/** The cell asked for if it is free, otherwise the free cell nearest to it. */
function placeAt(board: SandboxState, x: number, y: number, self?: string): { x: number; y: number } {
  const { columns, rows } = SANDBOX_GRID;
  const wanted = { x: Math.min(Math.max(Math.round(x), 0), columns - 1), y: Math.min(Math.max(Math.round(y), 0), rows - 1) };
  const taken = new Set(
    Object.values(board.regions)
      .filter((region) => region.id !== self)
      .map((region) => `${region.x},${region.y}`),
  );
  let best: { x: number; y: number } | undefined;
  let bestDistance = Infinity;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (taken.has(`${column},${row}`)) continue;
      const distance = (column - wanted.x) ** 2 + (row - wanted.y) ** 2;
      if (distance < bestDistance) [best, bestDistance] = [{ x: column, y: row }, distance];
    }
  }
  // A full grid stacks regions rather than refusing one.
  return best ?? wanted;
}

function assertValidRegionCommander(
  world: WorldState,
  board: SandboxState,
  commanderId: string,
  ownerId: string | null,
  disallowPlayer = false,
): void {
  const character = world.characters[commanderId];
  if (!character) {
    throw new WorldOpError(
      `Character "${commanderId}" does not exist, so they cannot command a region. Record them under characters first.`,
    );
  }
  if (disallowPlayer && character.isPlayer) {
    throw new WorldOpError('The player character cannot be appointed as a subordinate garrison commander.');
  }
  const rivalFaction = Object.values(board.factions).find(
    (faction) => faction.leaderId === commanderId && faction.id !== ownerId,
  );
  if (rivalFaction) {
    throw new WorldOpError(
      `"${character.name}" leads faction "${rivalFaction.name}" and cannot command a region held by another power.`,
    );
  }
  if (ownerId && board.factions[ownerId]?.isPlayer) {
    const rivalPost = Object.values(board.regions).find(
      (other) => other.commanderId === commanderId && other.ownerId !== null && other.ownerId !== ownerId,
    );
    if (rivalPost) {
      throw new WorldOpError(
        `"${character.name}" commands "${rivalPost.name}" for another faction and cannot be stationed in ${board.factions[ownerId]!.name}.`,
      );
    }
  }
}

function upsertRegion(
  world: WorldState,
  board: SandboxState,
  entry: {
    id: string;
    name?: string;
    description?: string;
    terrain?: string;
    kind?: SandboxRegionKind;
    owner_id?: string | null;
    x?: number;
    y?: number;
    neighbors?: string[];
    strength?: number | null;
    defense?: number;
    stability?: number;
    prosperity?: number;
    commander_id?: string | null;
    status?: string;
  },
): WorldEvent[] {
  if (entry.owner_id) requireFaction(board, entry.owner_id);
  const existing = board.regions[entry.id];
  const targetOwnerId = entry.owner_id !== undefined ? entry.owner_id : (existing?.ownerId ?? null);
  if (entry.commander_id) {
    assertValidRegionCommander(world, board, entry.commander_id, targetOwnerId, false);
  }
  const events: WorldEvent[] = [];
  let region = existing;

  if (!region) {
    const name = requireName(entry.name, 'Region', entry.id);
    // Left unplaced, a region goes next to the last one placed.
    const last = Object.values(board.regions).at(-1);
    const cell = placeAt(board, entry.x ?? (last ? last.x + 1 : 0), entry.y ?? last?.y ?? 0);
    region = {
      id: entry.id,
      name,
      description: entry.description ?? '',
      terrain: entry.terrain ?? '',
      ownerId: entry.owner_id ?? null,
      ...cell,
      neighbors: [],
      strength: entry.strength ?? null,
    };
    // Regions recorded earlier may already border this one.
    for (const other of Object.values(board.regions)) {
      if (other.neighbors.includes(entry.id)) region.neighbors.push(other.id);
    }
    board.regions[entry.id] = region;
  } else {
    if (entry.name?.trim()) region.name = entry.name.trim();
    if (entry.description !== undefined) region.description = entry.description;
    if (entry.terrain !== undefined) region.terrain = entry.terrain;
    if (entry.strength !== undefined) region.strength = entry.strength;
    if (entry.x !== undefined || entry.y !== undefined) {
      Object.assign(region, placeAt(board, entry.x ?? region.x, entry.y ?? region.y, region.id));
    }
    if (entry.owner_id !== undefined && entry.owner_id !== region.ownerId) {
      events.push(changeHands(board, region, entry.owner_id));
    }
  }

  if (entry.kind !== undefined) region.kind = entry.kind;
  if (entry.defense !== undefined) region.defense = Math.round(entry.defense);
  if (entry.stability !== undefined) region.stability = Math.round(entry.stability);
  if (entry.prosperity !== undefined) region.prosperity = Math.round(entry.prosperity);
  if (entry.status !== undefined) region.status = entry.status.trim();
  if (entry.commander_id !== undefined) {
    if (entry.commander_id !== null) {
      for (const other of Object.values(board.regions)) {
        if (other.id !== region.id && other.commanderId === entry.commander_id) {
          other.commanderId = null;
        }
      }
    }
    region.commanderId = entry.commander_id;
  }

  if (entry.neighbors) {
    region.neighbors = unique([...region.neighbors, ...entry.neighbors]).filter((other) => other !== entry.id);
    for (const otherId of region.neighbors) {
      const other = board.regions[otherId];
      if (other && !other.neighbors.includes(entry.id)) other.neighbors.push(entry.id);
    }
  }
  return events;
}

function changeHands(board: SandboxState, region: SandboxRegion, ownerId: string | null): WorldEvent {
  const nameOf = (factionId: string | null) => (factionId ? (board.factions[factionId]?.name ?? '') : '');
  const fromId = region.ownerId;
  region.ownerId = ownerId;
  if (fromId !== ownerId) {
    region.commanderId = null;
  }
  return {
    type: 'region_taken',
    regionId: region.id,
    regionName: region.name,
    fromId,
    fromName: nameOf(fromId),
    toId: ownerId,
    toName: nameOf(ownerId),
  };
}

function setRelation(
  board: SandboxState,
  entry: { a: string; b: string; stance: (typeof STANCES)[number]; note?: string },
): WorldEvent[] {
  if (entry.a === entry.b) throw new WorldOpError('A relation is between two different factions.');
  // Plain string order, so anyone comparing ids with `<` agrees on which is `a`.
  const [a, b] = [requireFaction(board, entry.a), requireFaction(board, entry.b)].sort((x, y) => (x.id < y.id ? -1 : 1));
  if (!a || !b) return [];
  let relation = board.relations.find((candidate) => candidate.a === a.id && candidate.b === b.id);
  const before = relation?.stance ?? 'neutral';
  if (!relation) {
    relation = { a: a.id, b: b.id, stance: entry.stance, note: entry.note ?? '' };
    board.relations.push(relation);
  } else {
    relation.stance = entry.stance;
    if (entry.note !== undefined) relation.note = entry.note;
  }
  return before === entry.stance ? [] : [{ type: 'relation_changed', aName: a.name, bName: b.name, stance: entry.stance }];
}

function removeFromBoard(board: SandboxState, entry: { kind: 'faction' | 'region'; id: string; reason?: string }): WorldEvent[] {
  if (entry.kind === 'faction') {
    const faction = requireFaction(board, entry.id);
    delete board.factions[entry.id];
    // Its lands lie open until somebody takes them.
    for (const region of Object.values(board.regions)) if (region.ownerId === entry.id) region.ownerId = null;
    board.relations = board.relations.filter((relation) => relation.a !== entry.id && relation.b !== entry.id);
    return [{ type: 'faction_removed', id: entry.id, name: faction.name, reason: entry.reason ?? '' }];
  }
  if (!board.regions[entry.id]) throw new WorldOpError(`There is no region with id "${entry.id}".`);
  delete board.regions[entry.id];
  for (const other of Object.values(board.regions)) other.neighbors = other.neighbors.filter((neighbor) => neighbor !== entry.id);
  return [];
}

// --- record.sandbox -----------------------------------------------------------

// Far beyond any story's numbers, and far short of where sums stop being exact.
const AMOUNT_LIMIT = 1e12;
const quantity = z.number().min(-AMOUNT_LIMIT).max(AMOUNT_LIMIT);

const amountEntry = z.strictObject({
  id: id.describe('Resource id.'),
  value: quantity.optional().describe('Set the amount to this.'),
  change: quantity.optional().describe('Or add this to it; negative to take away.'),
});

const resourceEntry = z.strictObject({
  id,
  name: z.string().optional().describe('What the player reads, e.g. "Treasury", "粮草". Required when creating.'),
});

const factionEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Required when creating.'),
  description: z.string().optional().describe('What kind of power it is and what it wants.'),
  leader_id: id.nullable().optional().describe('Id of the character who leads it, so the player can speak with them.'),
  is_player: z.boolean().optional().describe('True for the side the player is on.'),
  status: z.string().optional().describe('One line on how it is faring now.'),
  resources: z.array(amountEntry).max(8).optional().describe('Holdings to set or change; others stay as they are.'),
  income: z
    .array(z.strictObject({ id: id.describe('Resource id.'), value: quantity.describe('Change per round. Negative when upkeep outruns income.') }))
    .max(8)
    .optional()
    .describe('What it gains or loses each round, applied when a round passes.'),
});

const percentRating = z.number().min(0).max(100);

const regionEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Required when creating.'),
  description: z.string().optional(),
  terrain: z.string().optional().describe('Short label, e.g. "plains", "mountain pass", "port".'),
  kind: z.enum(SANDBOX_REGION_KINDS).optional().describe('Landmark archetype: capital, pass, fortress, city, frontier, wilderness.'),
  owner_id: id.nullable().optional().describe('Faction that holds it; null when nobody does.'),
  x: z.number().int().min(0).max(SANDBOX_GRID.columns - 1).optional().describe('Column on the map grid, 0 at the west edge.'),
  y: z.number().int().min(0).max(SANDBOX_GRID.rows - 1).optional().describe('Row on the map grid, 0 at the north edge.'),
  neighbors: z.array(id).max(8).optional().describe('Ids of the regions it borders. Borders run both ways.'),
  strength: z.number().min(0).max(AMOUNT_LIMIT).nullable().optional().describe('Garrison troop count stationed here.'),
  defense: percentRating.optional().describe('Wall & fortification integrity, 0 to 100.'),
  stability: percentRating.optional().describe('Public order & morale, 0 to 100.'),
  prosperity: percentRating.optional().describe('Tax base & agricultural prosperity, 0 to 100.'),
  commander_id: id.nullable().optional().describe('Character id of the general or governor stationed here.'),
  status: z.string().optional().describe('Short condition tag, e.g. "大旱赤地", "流民四起", "Under siege".'),
});

const relationEntry = z.strictObject({
  a: id.describe('Faction id.'),
  b: id.describe('The other faction id.'),
  stance: z.enum(STANCES),
  note: z.string().optional().describe('What lies behind it: a treaty, a grudge, a marriage.'),
});

const boardRemoval = z.strictObject({
  kind: z.enum(['faction', 'region']),
  id,
  reason: z.string().optional().describe('For a faction: how it ended, in the story language. Shown to the player.'),
});

const SANDBOX_PARTS = {
  period: z.string().describe('The date on the board in the setting\'s own terms, e.g. "Spring, year 3".'),
  resources: z.array(resourceEntry).max(6).describe('What factions count: two to five things such as treasury, grain, troops, stability. Define them once, at set-up.'),
  factions: z.array(factionEntry).max(12).describe('Powers to create or update. Only the fields you pass change.'),
  regions: z.array(regionEntry).max(40).describe('Regions to create or update: who holds them, where they lie on the map, what they border.'),
  relations: z.array(relationEntry).max(40).describe('How pairs of factions stand toward each other. Pairs never mentioned are neutral.'),
  remove: z.array(boardRemoval).describe('A faction that has fallen or a region that no longer exists.'),
};

const sandboxSection = z
  .strictObject({
    period: SANDBOX_PARTS.period.optional(),
    resources: SANDBOX_PARTS.resources.optional(),
    factions: SANDBOX_PARTS.factions.optional(),
    regions: SANDBOX_PARTS.regions.optional(),
    relations: SANDBOX_PARTS.relations.optional(),
    remove: SANDBOX_PARTS.remove.optional(),
  })
  .describe('The sandbox board: set it up when a story about contending powers begins, then record every change to territory, holdings and relations here. Leave it out of stories that are not about that.');

function applySandbox(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'sandbox', errors);
  if (!parts) return [];
  const events: WorldEvent[] = [];
  const board = world.modules.sandbox ?? emptyBoard();
  const reader = entryReader(parts, 'sandbox.', errors, events);

  // Resources before the factions that hold them, factions before the regions they own.
  reader.one('period', SANDBOX_PARTS.period, (period) => {
    board.period = period;
    return [];
  });
  reader.each('resources', resourceEntry, (entry) => defineResource(board, entry));
  reader.each('factions', factionEntry, (entry) => upsertFaction(world, board, entry));
  reader.each('regions', regionEntry, (entry) => upsertRegion(world, board, entry));
  reader.each('relations', relationEntry, (entry) => setRelation(board, entry));
  reader.each('remove', boardRemoval, (entry) => removeFromBoard(board, entry));
  reader.rejectUnknown(Object.keys(SANDBOX_PARTS), 'part of the sandbox');

  // An empty section sets nothing up.
  const inUse = board.period || board.resources.length > 0 || Object.keys(board.factions).length > 0 || Object.keys(board.regions).length > 0;
  if (inUse) world.modules.sandbox = board;
  return events;
}

function cleanDanglingRefs(world: WorldState): void {
  const board = world.modules.sandbox;
  if (!board) return;
  for (const region of Object.values(board.regions)) {
    if (region.commanderId && !world.characters[region.commanderId]) {
      region.commanderId = null;
    }
  }
}

// --- simulate -----------------------------------------------------------------

export interface BattleInput {
  attackerForce: number;
  defenderForce: number;
  /** -3 to +3: terrain, walls, surprise, leadership. Each point is worth 15% of strength. */
  attackerEdge: number;
  defenderEdge: number;
}

export interface BattleResult {
  attackerDice: number[];
  defenderDice: number[];
  winner: 'attacker' | 'defender';
  margin: BattleMargin;
  attackerLosses: number;
  defenderLosses: number;
}

// The share of its force each side loses, by how one-sided the fight was. The
// winner's losses are counted against the smaller force: a host that rolls
// over a village does not lose a fifth of itself doing it.
const LOSER_LOSSES: Record<BattleMargin, number> = { narrow: 0.25, clear: 0.4, decisive: 0.6 };
const WINNER_LOSSES: Record<BattleMargin, number> = { narrow: 0.2, clear: 0.12, decisive: 0.06 };

/**
 * Settles a battle. Each side's strength is its force, shifted by its edge and
 * by 2d6 of fortune (from 0.85 to 1.35), so numbers and position decide most
 * fights and luck decides the close ones. An even fight goes to the defender.
 */
export function resolveBattle(input: BattleInput, random: () => number): BattleResult {
  const roll = () => [Math.floor(random() * 6) + 1, Math.floor(random() * 6) + 1];
  const strength = (force: number, edgeVal: number, dice: number[]) => force * (1 + 0.15 * edgeVal) * (0.75 + 0.05 * sum(dice));
  const attackerDice = roll();
  const defenderDice = roll();
  const attacker = strength(input.attackerForce, input.attackerEdge, attackerDice);
  const defender = strength(input.defenderForce, input.defenderEdge, defenderDice);

  const winner = attacker > defender ? 'attacker' : 'defender';
  const ratio = Math.max(attacker, defender) / Math.max(Math.min(attacker, defender), Number.EPSILON);
  const margin: BattleMargin = ratio >= 2 ? 'decisive' : ratio >= 1.3 ? 'clear' : 'narrow';

  const smaller = Math.min(input.attackerForce, input.defenderForce);
  const lossesOf = (side: 'attacker' | 'defender', force: number) =>
    Math.round(side === winner ? smaller * WINNER_LOSSES[margin] : force * LOSER_LOSSES[margin]);
  return {
    attackerDice,
    defenderDice,
    winner,
    margin,
    attackerLosses: lossesOf('attacker', input.attackerForce),
    defenderLosses: lossesOf('defender', input.defenderForce),
  };
}

function clampEdge(value: number): number {
  return Math.max(-3, Math.min(3, Math.round(value)));
}

/** Derives a -1..+2 tactical command edge from a character's court military rating or martial stat. */
export function commanderEdge(world: WorldState, characterId: string | null | undefined): number {
  if (!characterId) return 0;
  const official = world.modules.court?.officials[characterId];
  if (official) {
    if (official.military >= 85) return 2;
    if (official.military >= 68) return 1;
    if (official.military < 35) return -1;
    return 0;
  }
  const character = world.characters[characterId];
  if (!character) return 0;
  const martial = character.stats.find(
    (s) => typeof s.value === 'number' && /武|兵|统|军|战|martial|military|command|war|tactics/i.test(s.name),
  );
  if (!martial || typeof martial.value !== 'number') return 0;
  if ((martial.max && martial.max >= 50) || martial.value > 20) {
    return martial.value >= 85 ? 2 : martial.value >= 68 ? 1 : martial.value < 35 ? -1 : 0;
  }
  return martial.value >= 16 ? 2 : martial.value >= 13 ? 1 : 0;
}

const edge = z.number().int().min(-3).max(3);

const battleEntry = z.strictObject({
  attacker_id: id.describe('Faction that attacks.'),
  defender_id: id.describe('Faction that is attacked.'),
  region_id: id.optional().describe('The region fought over. If the attacker wins, it takes the region.'),
  attacker_force: z.number().positive().max(AMOUNT_LIMIT).describe('How much the attacker commits, in whatever the board counts forces in.'),
  defender_force: z.number().positive().max(AMOUNT_LIMIT).describe('How much stands against it.'),
  attacker_edge: edge.optional().describe('-3 to +3 for the attacker\'s circumstances: surprise, leadership, morale, supply. 0 when even.'),
  defender_edge: edge.optional().describe('-3 to +3 for the defender\'s: walls, terrain, leadership, morale. 0 when even.'),
  losses_from: id
    .optional()
    .describe('Id of the resource the forces are drawn from, e.g. the one for troops. Given, neither side can field more of it than it has, and each side\'s losses are taken from it.'),
  reason: z.string().describe('What the battle is, in the story language. Shown to the player.'),
});

const simulateSchema = z.strictObject({
  battles: z.array(battleEntry).max(6).optional().describe('Battles to settle, in order.'),
  advance: z
    .strictObject({ period: z.string().optional().describe('The new date on the board.') })
    .optional()
    .describe('Lets one round pass, after any battles: every faction\'s income is applied to its holdings.'),
});

type BattleEntry = z.infer<typeof battleEntry>;

function fightBattle(world: WorldState, board: SandboxState, entry: BattleEntry, random: () => number): { report: unknown; events: WorldEvent[] } {
  if (entry.attacker_id === entry.defender_id) throw new WorldOpError('A faction cannot attack itself.');
  const attacker = requireFaction(board, entry.attacker_id);
  const defender = requireFaction(board, entry.defender_id);
  const region = entry.region_id ? board.regions[entry.region_id] : undefined;
  if (entry.region_id && !region) throw new WorldOpError(`There is no region with id "${entry.region_id}".`);
  if (region?.ownerId && region.ownerId !== defender.id && region.ownerId !== attacker.id) {
    const holder = board.factions[region.ownerId]?.name ?? region.ownerId;
    throw new WorldOpError(`${region.name} is held by ${holder}, not by ${defender.name}. A battle for a region is fought against whoever holds it.`);
  }

  let { attacker_force: attackerForce, defender_force: defenderForce } = entry;
  const pool = entry.losses_from;
  if (pool) {
    const resource = requireResource(board, pool);
    // Nobody fields more than they have.
    attackerForce = Math.min(attackerForce, attacker.resources[pool] ?? 0);
    defenderForce = Math.min(defenderForce, defender.resources[pool] ?? 0);
    for (const [side, force] of [[attacker, attackerForce], [defender, defenderForce]] as const) {
      if (force <= 0) throw new WorldOpError(`${side.name} has no ${resource} to fight with. If nothing stands in the way, change the region's owner in record instead.`);
    }
  }

  const autoDefenderEdge =
    region && (region.defense !== undefined || region.commanderId)
      ? clampEdge(Math.round(((region.defense ?? 50) - 50) / 22) + commanderEdge(world, region.commanderId))
      : 0;

  const result = resolveBattle(
    {
      attackerForce,
      defenderForce,
      attackerEdge: entry.attacker_edge ?? 0,
      defenderEdge: entry.defender_edge ?? autoDefenderEdge,
    },
    random,
  );
  const events: WorldEvent[] = [
    {
      type: 'sandbox_battle',
      attackerId: attacker.id,
      attackerName: attacker.name,
      defenderId: defender.id,
      defenderName: defender.name,
      regionId: region?.id ?? null,
      regionName: region?.name ?? '',
      attackerForce,
      defenderForce,
      attackerLosses: result.attackerLosses,
      defenderLosses: result.defenderLosses,
      winner: result.winner,
      margin: result.margin,
      reason: entry.reason,
    },
  ];

  if (pool) {
    // The losses are told by the battle itself; no separate notice.
    for (const [side, losses] of [[attacker, result.attackerLosses], [defender, result.defenderLosses]] as const) {
      side.resources[pool] = Math.max((side.resources[pool] ?? 0) - losses, 0);
    }
  }

  if (region) {
    if (region.defense !== undefined) {
      region.defense = Math.max(10, region.defense - (result.winner === 'attacker' ? 18 : 8));
    }
    if (region.stability !== undefined) {
      region.stability = Math.max(15, region.stability - 12);
    }
  }

  const captured = region !== undefined && result.winner === 'attacker' && region.ownerId !== attacker.id;
  if (captured) {
    if (region.commanderId) region.commanderId = null;
    events.push(changeHands(board, region, attacker.id));
  }

  const report = {
    attacker: attacker.id,
    defender: defender.id,
    ...(region ? { region: region.id, region_captured: captured } : {}),
    forces: { attacker: attackerForce, defender: defenderForce },
    dice: { attacker: result.attackerDice, defender: result.defenderDice },
    winner: result.winner,
    margin: result.margin,
    losses: { attacker: result.attackerLosses, defender: result.defenderLosses },
    ...(pool ? { left: { attacker: attacker.resources[pool], defender: defender.resources[pool] } } : {}),
    // Whether a power with no land left has fallen is the game master's call.
    ...(Object.values(board.regions).some((held) => held.ownerId === defender.id) ? {} : { defender_holds_no_regions: true }),
  };
  return { report, events };
}

function passRound(board: SandboxState, period: string | undefined): { report: unknown; events: WorldEvent[] } {
  board.round += 1;
  if (period?.trim()) board.period = period.trim();
  const changes: { resource: string; from: number; to: number }[] = [];
  const nameOf = (resourceId: string) => board.resources.find((entry) => entry.id === resourceId)?.name ?? resourceId;

  const factions = Object.fromEntries(
    Object.values(board.factions).map((faction) => {
      const shortfall: string[] = [];
      for (const [resourceId, change] of Object.entries(faction.income)) {
        const before = faction.resources[resourceId] ?? 0;
        // Holdings do not go below nothing; what could not be paid is reported instead.
        if (before + change < 0) shortfall.push(resourceId);
        const after = Math.min(Math.max(before + change, 0), AMOUNT_LIMIT);
        faction.resources[resourceId] = after;
        if (faction.isPlayer && after !== before) changes.push({ resource: nameOf(resourceId), from: before, to: after });
      }
      return [faction.id, { resources: faction.resources, ...(shortfall.length > 0 ? { could_not_pay: shortfall } : {}) }];
    }),
  );
  const events: WorldEvent[] = [{ type: 'sandbox_round', round: board.round, period: board.period, changes }];
  return { report: { round: board.round, period: board.period, factions }, events };
}

const simulateTool: GameTool = {
  name: SIMULATE,
  silent: false,
  // It does change the board, but the turn still owes a record: the scene, what people remember, what comes next.
  records: false,
  endsTurn: false,
  run(world, input, ctx) {
    const parsed = simulateSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error, input);
    const board = world.modules.sandbox;
    if (!board) {
      const content = 'The board has not been set up yet. Record resources, factions and regions under sandbox first.';
      return { content, isError: true, events: [] };
    }
    const { battles = [], advance } = parsed.data;
    if (battles.length === 0 && !advance) {
      return { content: 'Nothing to simulate: pass battles, advance, or both.', isError: true, events: [] };
    }

    const events: WorldEvent[] = [];
    const rejected: EntryError[] = [];
    const reports: unknown[] = [];
    battles.forEach((entry, index) => {
      try {
        const fought = fightBattle(world, board, entry, ctx.random);
        reports.push(fought.report);
        events.push(...fought.events);
      } catch (err) {
        if (!(err instanceof WorldOpError)) throw err;
        rejected.push({ at: `battles[${index}]`, problem: err.message });
      }
    });
    const round = advance ? passRound(board, advance.period) : undefined;
    if (round) events.push(...round.events);

    const content = JSON.stringify({
      ...(reports.length > 0 ? { battles: reports } : {}),
      ...(round ? { round: round.report } : {}),
      ...(rejected.length > 0 ? { rejected, note: 'Everything else was applied. Send only the corrected battles again.' } : {}),
    });
    return { content, isError: rejected.length > 0, events };
  },
};

// --- what characters & GM know of it ------------------------------------------

/** The balance of power as anyone in the world would know it, plus the books of the faction or garrison this character commands. */
function commonKnowledge(world: WorldState, characterId: string): unknown {
  const board = world.modules.sandbox;
  if (!board || Object.keys(board.factions).length === 0) return undefined;
  const factions = Object.values(board.factions);
  const regions = Object.values(board.regions);
  const resourceName = (resourceId: string) => board.resources.find((entry) => entry.id === resourceId)?.name ?? resourceId;
  const named = (amounts: Record<string, number>) =>
    Object.fromEntries(Object.entries(amounts).map(([resourceId, amount]) => [resourceName(resourceId), amount]));
  const led = factions.find((faction) => faction.leaderId === characterId);
  const commanded = regions.find((region) => region.commanderId === characterId);

  return {
    date: board.period,
    powers: factions.map((faction) => ({
      name: faction.name,
      ...(faction.leaderId && world.characters[faction.leaderId] ? { led_by: world.characters[faction.leaderId]?.name } : {}),
      holds: regions.filter((region) => region.ownerId === faction.id).map((region) => region.name),
      standing: faction.status,
    })),
    relations: board.relations
      .filter((relation) => relation.stance !== 'neutral')
      .map((relation) => ({
        between: [board.factions[relation.a]?.name ?? relation.a, board.factions[relation.b]?.name ?? relation.b],
        stance: relation.stance,
      })),
    ...(led ? { you_lead: { name: led.name, has: named(led.resources), gains_per_round: named(led.income) } } : {}),
    ...(commanded
      ? {
          you_command: {
            region: commanded.name,
            ...(commanded.strength !== null ? { garrison: commanded.strength } : {}),
            defense: sandboxRegionDefense(commanded),
            stability: sandboxRegionStability(commanded),
            ...(commanded.status ? { status: commanded.status } : {}),
          },
        }
      : {}),
  };
}

function viewSandboxForGM(world: WorldState): unknown {
  const board = world.modules.sandbox;
  if (!board) return undefined;
  return {
    round: board.round,
    ...(board.period ? { period: board.period } : {}),
    resources: board.resources,
    factions: Object.fromEntries(
      Object.values(board.factions).map((f) => [
        f.id,
        {
          name: f.name,
          ...(f.isPlayer ? { isPlayer: true } : {}),
          ...(f.leaderId ? { leaderId: f.leaderId } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.description ? { description: f.description } : {}),
          resources: f.resources,
          ...(Object.keys(f.income).length > 0 ? { income: f.income } : {}),
        },
      ]),
    ),
    regions: Object.fromEntries(
      Object.values(board.regions).map((r) => [
        r.id,
        {
          name: r.name,
          ownerId: r.ownerId,
          x: r.x,
          y: r.y,
          neighbors: r.neighbors,
          ...(r.kind ? { kind: r.kind } : {}),
          ...(r.terrain ? { terrain: r.terrain } : {}),
          ...(r.strength !== null ? { strength: r.strength } : {}),
          ...(r.defense !== undefined ? { defense: r.defense } : {}),
          ...(r.stability !== undefined ? { stability: r.stability } : {}),
          ...(r.prosperity !== undefined ? { prosperity: r.prosperity } : {}),
          ...(r.commanderId ? { commanderId: r.commanderId } : {}),
          ...(r.status ? { status: r.status } : {}),
          ...(r.description ? { description: r.description } : {}),
        },
      ]),
    ),
    ...(board.relations.length > 0
      ? {
          relations: board.relations.map((rel) => ({
            a: rel.a,
            b: rel.b,
            stance: rel.stance,
            ...(rel.note ? { note: rel.note } : {}),
          })),
        }
      : {}),
  };
}

// --- what the game master is told ---------------------------------------------

const en = `## Sandbox

You have a sandbox: a strategic map of regions, contending factions, and their treasuries, provisions and reserves. Use it for stories about empires, warlords, sects or rival houses contending over territory; leave it alone otherwise.

Set the board up in the opening record under sandbox:
- resources (2–5, e.g. silver/treasury, grain, reserve manpower),
- factions (3–8, with the player's side marked is_player, starting resources, per-round income/upkeep, and leader_id from the cast),
- regions (6–20): place them across BOTH axes of the 2D grid (x: 0..${SANDBOX_GRID.columns - 1} west→east, y: 0..${SANDBOX_GRID.rows - 1} north→south — spread north, central, west, east and south geographically instead of a single flat row!). Give each region its kind (capital, pass, fortress, city, frontier, wilderness), garrison strength, defense (0–100), stability (0–100), prosperity (0–100), optional status tag and stationed commander_id, plus bordering neighbors.
- relations between factions.

Keep record.sandbox synchronized whenever territory, garrisons, walls, stability, commanders, resources or stances change.

Call simulate before narrating battles or round settlements:
- battles: pass forces and tactical edges; never decide a battle's outcome yourself.
- advance: settles per-round income/upkeep when a strategic round (month/season) passes.

Rival factions pursue their own ambitions: each round, have one or two reinforce, raid a pass, stir unrest, or propose/break a pact.`;

const zh = `## 沙盘

你有一个战略沙盘：由州郡关隘组成的二维版图、割据或对峙的各方势力，以及各方的钱粮兵备。它用于王朝军国、诸侯争霸、宗门割据等争夺地盘的故事；其他题材不要动它。

在开场的 record.sandbox 中搭好沙盘：
- resources：二到五种核心资源（如国库银两、军粮、可动员兵力）；
- factions：三到八方势力（玩家一方标 is_player），写明初始存量、每轮收支（入不敷出可为负数）及登场人物担任的 leader_id；
- regions：六到二十个地区，务必在二维网格上按真实地理方位铺开（x 从 0 到 ${SANDBOX_GRID.columns - 1} 自西向东，y 从 0 到 ${SANDBOX_GRID.rows - 1} 自北向南——切忌把所有地区排成单行直线！）。写明各地区的 kind（capital 都城、pass 雄关、fortress 军镇、city 州府、frontier 塞外、wilderness 荒原）、驻军 strength、城防 defense（0–100）、民心治安 stability（0–100）、富庶度 prosperity（0–100）、态势标签 status、驻守将领 commander_id 及接壤 neighbors；
- relations：各方关系。

凡地盘易手、兵力调动、城防民心升降、守将更替或邦交变动，均在同一回合写入 record.sandbox。

战事与回合收支交给 simulate 裁定，先调用再按结果叙述：
- battles：交由骰子结合兵力与地利裁定胜负及折损，切勿自行拍板战果；
- advance：故事里确实度过一轮（如一月、一季）时调用以结算各方收支。

其他势力各有图谋：每轮让一两方主动整军、叩关、劫掠或遣使合纵，并将变化记入沙盘。`;

// --- player strategic operations ----------------------------------------------

function requirePlayerFaction(board: SandboxState): SandboxFaction {
  const faction = Object.values(board.factions).find((entry) => entry.isPlayer);
  if (!faction) {
    throw new WorldOpError('No player faction is marked on the sandbox board.');
  }
  return faction;
}

function requireRegion(board: SandboxState, regionId: string): SandboxRegion {
  const region = board.regions[regionId];
  if (!region) {
    throw new WorldOpError(`There is no region with id "${regionId}".`);
  }
  return region;
}

function requirePlayerOwnedRegion(board: SandboxState, regionId: string, playerFaction: SandboxFaction): SandboxRegion {
  const region = requireRegion(board, regionId);
  if (region.ownerId !== playerFaction.id) {
    throw new WorldOpError(`"${region.name}" is not held by ${playerFaction.name}.`);
  }
  return region;
}

function spendFactionResource(
  board: SandboxState,
  faction: SandboxFaction,
  resourceId: string,
  amount: number,
  events: WorldEvent[],
): string {
  const resName = requireResource(board, resourceId);
  if (amount <= 0) return resName;
  const before = faction.resources[resourceId] ?? 0;
  if (before < amount) {
    throw new WorldOpError(`${resName}不足：需要 ${amount}，当前仅有 ${before}。`);
  }
  const after = before - amount;
  faction.resources[resourceId] = after;
  if (faction.isPlayer) {
    events.push({
      type: 'resource_changed',
      factionId: faction.id,
      factionName: faction.name,
      resource: resName,
      from: before,
      to: after,
    });
  }
  return resName;
}

const transferTroopsSchema = z.strictObject({
  from_region_id: id,
  to_region_id: id,
  amount: z.number().int().positive().max(AMOUNT_LIMIT),
});

const reinforceGarrisonSchema = z.strictObject({
  region_id: id,
  amount: z.number().int().positive().max(AMOUNT_LIMIT),
  manpower_resource_id: id.optional(),
  cost_resource_id: id.optional(),
  cost: z.number().min(0).max(AMOUNT_LIMIT).optional(),
});

const fortifyRegionSchema = z.strictObject({
  region_id: id,
  resource_id: id.optional(),
  cost: z.number().min(0).max(AMOUNT_LIMIT).optional(),
  gain: z.number().int().min(1).max(100).optional(),
});

const pacifyRegionSchema = z.strictObject({
  region_id: id,
  resource_id: id.optional(),
  cost: z.number().min(0).max(AMOUNT_LIMIT).optional(),
  gain: z.number().int().min(1).max(100).optional(),
});

const developRegionSchema = z.strictObject({
  region_id: id,
  resource_id: id.optional(),
  yield_resource_id: id.optional(),
  cost: z.number().min(0).max(AMOUNT_LIMIT).optional(),
  gain: z.number().int().min(1).max(100).optional(),
  income_gain: z.number().min(0).max(AMOUNT_LIMIT).optional(),
});

const assignCommanderSchema = z.strictObject({
  region_id: id,
  commander_id: id.nullable(),
});

const launchCampaignSchema = z.strictObject({
  from_region_id: id,
  target_region_id: id,
  force: z.number().int().positive().max(AMOUNT_LIMIT),
});

const diplomacyStanceSchema = z.strictObject({
  target_faction_id: id,
  stance: z.enum(['war', 'hostile']),
  note: z.string().optional(),
});

const regionDecreeOpSchema = z.strictObject({
  region_id: id,
  action: z.enum(['fortify', 'mobilize', 'relief', 'claim']),
  resource_id: id.optional(),
  cost: z.number().min(0).max(AMOUNT_LIMIT).optional(),
  delta: z.number().min(1).max(AMOUNT_LIMIT).optional(),
  note: z.string().optional(),
});

function operateSandbox(
  world: WorldState,
  op: string,
  params: Record<string, unknown>,
  ctx: Pick<ToolContext, 'random'>,
): { events: WorldEvent[]; summary: string } {
  const board = world.modules.sandbox;
  if (!board) {
    throw new WorldOpError('The sandbox board has not been set up yet.');
  }

  const pools = matchSandboxResourcePools(board);
  const scale = sandboxEconomicScale(board);

  if (op === 'transfer_troops') {
    const parsed = transferTroopsSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const player = requirePlayerFaction(board);
    const from = requirePlayerOwnedRegion(board, parsed.data.from_region_id, player);
    const to = requirePlayerOwnedRegion(board, parsed.data.to_region_id, player);
    if (from.id === to.id) {
      throw new WorldOpError('调出地与调入地不能相同。');
    }
    if (!areFriendlyRegionsConnected(board, from.id, to.id, player.id)) {
      throw new WorldOpError(`【${from.name}】与【${to.name}】之间缺乏连贯的我方控制走廊，无法直接调兵。`);
    }
    const available = from.strength ?? 0;
    if (available < parsed.data.amount) {
      throw new WorldOpError(`【${from.name}】当前驻军仅 ${available}，不足以调出 ${parsed.data.amount}。`);
    }
    from.strength = available - parsed.data.amount;
    to.strength = (to.strength ?? 0) + parsed.data.amount;
    return {
      events: [],
      summary: `调兵移防：自【${from.name}】调拨 ${parsed.data.amount} 兵力增戍【${to.name}】（${from.name} 余 ${from.strength}，${to.name} 现驻 ${to.strength}）`,
    };
  }

  if (op === 'reinforce_garrison') {
    const parsed = reinforceGarrisonSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const player = requirePlayerFaction(board);
    const region = requirePlayerOwnedRegion(board, parsed.data.region_id, player);
    const amount = parsed.data.amount;
    const events: WorldEvent[] = [];

    const manpowerId = parsed.data.manpower_resource_id ?? pools.manpower?.id;
    if (manpowerId) {
      spendFactionResource(board, player, manpowerId, amount, events);
    }

    const fundsId = parsed.data.cost_resource_id ?? (pools.funds && pools.funds.id !== manpowerId ? pools.funds.id : undefined);
    const fee =
      parsed.data.cost !== undefined
        ? Math.round(parsed.data.cost)
        : fundsId
          ? niceSandboxNumber(Math.max(1, amount * scale.costPerTroop), 1)
          : 0;
    let feeNote = '';
    if (fundsId && fee > 0) {
      const fundsName = spendFactionResource(board, player, fundsId, fee, events);
      feeNote = `，耗支${fundsName} ${fee}`;
    }

    region.strength = (region.strength ?? 0) + amount;
    return {
      events,
      summary: `征调增戍：向【${region.name}】增派 ${amount} 兵力（现驻军 ${region.strength}${feeNote}）`,
    };
  }

  if (op === 'fortify_region') {
    const parsed = fortifyRegionSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const player = requirePlayerFaction(board);
    const region = requirePlayerOwnedRegion(board, parsed.data.region_id, player);
    const before = sandboxRegionDefense(region);
    if (before >= 100) {
      throw new WorldOpError(`【${region.name}】城防已臻完固（100/100）。`);
    }
    const events: WorldEvent[] = [];
    const resId = parsed.data.resource_id ?? pools.funds?.id;
    const cost = parsed.data.cost !== undefined ? Math.round(parsed.data.cost) : resId ? scale.fortifyCost : 0;
    let costNote = '';
    if (resId && cost > 0) {
      const resName = spendFactionResource(board, player, resId, cost, events);
      costNote = `，耗支${resName} ${cost}`;
    }
    const after = Math.min(100, before + (parsed.data.gain ?? 15));
    region.defense = after;
    return {
      events,
      summary: `修筑城防：【${region.name}】城防工事由 ${before} 升至 ${after}/100${costNote}`,
    };
  }

  if (op === 'pacify_region') {
    const parsed = pacifyRegionSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const player = requirePlayerFaction(board);
    const region = requirePlayerOwnedRegion(board, parsed.data.region_id, player);
    const before = sandboxRegionStability(region);
    if (before >= 100) {
      throw new WorldOpError(`【${region.name}】民心治安已极安稳（100/100）。`);
    }
    const events: WorldEvent[] = [];
    const resId = parsed.data.resource_id ?? pools.grain?.id ?? pools.funds?.id;
    const defaultCost = resId === pools.grain?.id ? scale.pacifyGrainCost : scale.pacifyFundsCost;
    const cost = parsed.data.cost !== undefined ? Math.round(parsed.data.cost) : resId ? defaultCost : 0;
    let costNote = '';
    if (resId && cost > 0) {
      const resName = spendFactionResource(board, player, resId, cost, events);
      costNote = `，拨付${resName} ${cost}`;
    }
    const after = Math.min(100, before + (parsed.data.gain ?? 20));
    region.stability = after;
    if (after >= 65 && region.status && /旱|灾|饥|流民|unrest|famine|drought/i.test(region.status)) {
      region.status = '';
    }
    return {
      events,
      summary: `赈灾安民：【${region.name}】民心治安由 ${before} 升至 ${after}/100${costNote}`,
    };
  }

  if (op === 'develop_region') {
    const parsed = developRegionSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const player = requirePlayerFaction(board);
    const region = requirePlayerOwnedRegion(board, parsed.data.region_id, player);
    const before = sandboxRegionProsperity(region);
    if (before >= 100) {
      throw new WorldOpError(`【${region.name}】税粮富庶已达上限（100/100）。`);
    }
    const events: WorldEvent[] = [];
    const costResId = parsed.data.resource_id ?? pools.funds?.id;
    const cost = parsed.data.cost !== undefined ? Math.round(parsed.data.cost) : costResId ? scale.developCost : 0;
    let costNote = '';
    if (costResId && cost > 0) {
      const resName = spendFactionResource(board, player, costResId, cost, events);
      costNote = `，投入${resName} ${cost}`;
    }

    const after = Math.min(100, before + (parsed.data.gain ?? 15));
    region.prosperity = after;

    const yieldId = parsed.data.yield_resource_id ?? pools.funds?.id ?? pools.grain?.id;
    let yieldNote = '';
    if (yieldId) {
      const yieldName = requireResource(board, yieldId);
      const gainPerRound =
        parsed.data.income_gain !== undefined
          ? Math.round(parsed.data.income_gain)
          : yieldId === pools.grain?.id
            ? scale.developGrainYield
            : scale.developFundsYield;
      if (gainPerRound > 0) {
        const nextIncome = (player.income[yieldId] ?? 0) + gainPerRound;
        if (nextIncome === 0) delete player.income[yieldId];
        else player.income[yieldId] = nextIncome;
        yieldNote = `，每回合${yieldName}收支 +${gainPerRound}`;
      }
    }

    return {
      events,
      summary: `屯田兴利：【${region.name}】富庶度由 ${before} 升至 ${after}/100${costNote}${yieldNote}`,
    };
  }

  if (op === 'assign_commander') {
    const parsed = assignCommanderSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const player = requirePlayerFaction(board);
    const region = requirePlayerOwnedRegion(board, parsed.data.region_id, player);
    const { commander_id } = parsed.data;

    if (commander_id === null) {
      const prev = region.commanderId ? world.characters[region.commanderId]?.name : undefined;
      region.commanderId = null;
      return {
        events: [],
        summary: prev ? `召回守将：解除 ${prev} 在【${region.name}】的镇守职务` : `解除【${region.name}】守将委任`,
      };
    }

    assertValidRegionCommander(world, board, commander_id, player.id, true);
    const character = world.characters[commander_id]!;
    for (const other of Object.values(board.regions)) {
      if (other.id !== region.id && other.commanderId === commander_id) {
        other.commanderId = null;
      }
    }
    region.commanderId = commander_id;
    return {
      events: [],
      summary: `委任守将：命 ${character.name} 镇守【${region.name}】`,
    };
  }

  if (op === 'launch_campaign') {
    const parsed = launchCampaignSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const player = requirePlayerFaction(board);
    const from = requirePlayerOwnedRegion(board, parsed.data.from_region_id, player);
    const target = requireRegion(board, parsed.data.target_region_id);
    if (target.ownerId === player.id) {
      throw new WorldOpError(`【${target.name}】已归我方控制，请改用「调兵移防」。`);
    }
    const borders = from.neighbors.includes(target.id) || target.neighbors.includes(from.id);
    if (!borders) {
      throw new WorldOpError(`【${from.name}】与【${target.name}】并不接壤，无法越境出师。`);
    }
    const available = from.strength ?? 0;
    const force = parsed.data.force;
    if (available < force) {
      throw new WorldOpError(`【${from.name}】现驻兵力 ${available}，不足以派出 ${force} 大军。`);
    }

    const events: WorldEvent[] = [];
    const defender = target.ownerId ? board.factions[target.ownerId] : undefined;
    const defenderForce = target.strength ?? 0;

    // Unclaimed territory with no garrison: orderly occupation by dispatched force.
    if (!defender && defenderForce <= 0) {
      from.strength = available - force;
      target.strength = force;
      target.stability = Math.min(sandboxRegionStability(target), 50);
      events.push(changeHands(board, target, player.id));
      return {
        events,
        summary: `发兵进驻：自【${from.name}】分兵 ${force} 进驻收复【${target.name}】（${from.name} 留守 ${from.strength}）`,
      };
    }

    if (defender) {
      events.push(...setRelation(board, { a: player.id, b: defender.id, stance: 'war' }));
    }

    if (defender && defenderForce <= 0) {
      from.strength = available - force;
      target.strength = force;
      target.commanderId = null;
      target.stability = Math.max(20, sandboxRegionStability(target) - 15);
      events.push(changeHands(board, target, player.id));
      return {
        events,
        summary: `出师克捷：【${target.name}】空虚无备，我军自【${from.name}】进兵 ${force} 兵不血刃克复之`,
      };
    }

    const kind = inferSandboxRegionKind(target);
    const terrainBonus = kind === 'pass' ? 1 : 0;
    const wallBonus = Math.round((sandboxRegionDefense(target) - 50) / 22);
    const attackerEdge = clampEdge(commanderEdge(world, from.commanderId));
    const defenderEdge = clampEdge(wallBonus + terrainBonus + commanderEdge(world, target.commanderId));

    const result = resolveBattle(
      {
        attackerForce: force,
        defenderForce: Math.max(1, defenderForce),
        attackerEdge,
        defenderEdge,
      },
      ctx.random,
    );

    events.push({
      type: 'sandbox_battle',
      attackerId: player.id,
      attackerName: player.name,
      defenderId: defender?.id ?? 'unclaimed',
      defenderName: defender?.name ?? target.name,
      regionId: target.id,
      regionName: target.name,
      attackerForce: force,
      defenderForce: Math.max(1, defenderForce),
      attackerLosses: result.attackerLosses,
      defenderLosses: result.defenderLosses,
      winner: result.winner,
      margin: result.margin,
      reason: `自${from.name}出师攻伐${target.name}`,
    });

    target.defense = Math.max(10, sandboxRegionDefense(target) - (result.winner === 'attacker' ? 20 : 10));
    target.stability = Math.max(15, sandboxRegionStability(target) - 15);

    if (result.winner === 'attacker') {
      const survivors = Math.max(1, force - result.attackerLosses);
      from.strength = available - force;
      target.strength = survivors;
      target.commanderId = null;
      events.push(changeHands(board, target, player.id));
      return {
        events,
        summary: `出师大捷：我军 ${force} 自【${from.name}】攻克【${target.name}】（歼敌 ${result.defenderLosses}，自损 ${result.attackerLosses}，现驻 ${survivors}）`,
      };
    }

    from.strength = Math.max(0, available - result.attackerLosses);
    target.strength = Math.max(0, defenderForce - result.defenderLosses);
    return {
      events,
      summary: `攻伐受挫：我军 ${force} 强攻【${target.name}】未克，折损 ${result.attackerLosses} 后退回【${from.name}】（敌军折损 ${result.defenderLosses}，余 ${target.strength}）`,
    };
  }

  if (op === 'diplomacy_stance') {
    const parsed = diplomacyStanceSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const player = requirePlayerFaction(board);
    const target = requireFaction(board, parsed.data.target_faction_id);
    if (target.id === player.id) throw new WorldOpError('Cannot set diplomatic stance with your own faction.');
    const events = setRelation(board, {
      a: player.id,
      b: target.id,
      stance: parsed.data.stance,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
    const label = parsed.data.stance === 'war' ? '正式宣战' : '断交戒备';
    return {
      events,
      summary: `邦交决断：${player.name}对【${target.name}】${label}`,
    };
  }

  if (op === 'region_decree') {
    const parsed = regionDecreeOpSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const { region_id, action, resource_id, cost, delta } = parsed.data;
    if (action === 'fortify') {
      return operateSandbox(
        world,
        'fortify_region',
        { region_id, ...(resource_id ? { resource_id } : {}), ...(cost !== undefined ? { cost } : {}), ...(delta ? { gain: Math.min(100, delta) } : {}) },
        ctx,
      );
    }
    if (action === 'mobilize') {
      return operateSandbox(
        world,
        'reinforce_garrison',
        { region_id, amount: delta ?? 100, ...(cost !== undefined ? { cost } : {}), ...(resource_id ? { cost_resource_id: resource_id } : {}) },
        ctx,
      );
    }
    if (action === 'relief') {
      return operateSandbox(
        world,
        'pacify_region',
        { region_id, ...(resource_id ? { resource_id } : {}), ...(cost !== undefined ? { cost } : {}), ...(delta ? { gain: Math.min(100, delta) } : {}) },
        ctx,
      );
    }
    const player = requirePlayerFaction(board);
    const region = requireRegion(board, region_id);
    const events: WorldEvent[] = [];
    if (region.ownerId !== player.id) {
      events.push(changeHands(board, region, player.id));
    }
    return { events, summary: `接管【${region.name}】归入 ${player.name}` };
  }

  throw new WorldOpError(`Unknown sandbox operation "${op}".`);
}

export const sandboxModule: GameModule = {
  id: 'sandbox',
  // Only a story about contending powers has a use for a board.
  keptWhenUnused: false,
  hasPanel: true,
  tools: [
    {
      tool: simulateTool,
      spec: {
        name: SIMULATE,
        description:
          'Have the sandbox settle what is not yours to decide: battles between factions, and the passing of a round. Call it before narrating what it settles, and tell the story from the result. Outcomes are applied to the board and shown to the player.',
        inputSchema: toJsonSchema(simulateSchema),
      },
    },
  ],
  record: { schema: sandboxSection, apply: applySandbox },
  afterRecord: cleanDanglingRefs,
  guide: { en, zh },
  shownToCharacter: { tag: 'the_board', of: commonKnowledge },
  viewForGM: viewSandboxForGM,
  operate: operateSandbox,
};
