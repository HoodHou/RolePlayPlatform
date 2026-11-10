import {
  SANDBOX_COLORS,
  SANDBOX_GRID,
  STANCES,
  type BattleMargin,
  type SandboxFaction,
  type SandboxRegion,
  type SandboxState,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { asParts, entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool } from '../toolKit';
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

function upsertRegion(
  board: SandboxState,
  entry: {
    id: string;
    name?: string;
    description?: string;
    terrain?: string;
    owner_id?: string | null;
    x?: number;
    y?: number;
    neighbors?: string[];
    strength?: number | null;
  },
): WorldEvent[] {
  if (entry.owner_id) requireFaction(board, entry.owner_id);
  const events: WorldEvent[] = [];
  let region = board.regions[entry.id];

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

const regionEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Required when creating.'),
  description: z.string().optional(),
  terrain: z.string().optional().describe('Short label, e.g. "plains", "mountain pass", "port".'),
  owner_id: id.nullable().optional().describe('Faction that holds it; null when nobody does.'),
  x: z.number().int().min(0).max(SANDBOX_GRID.columns - 1).optional().describe('Column on the map grid, 0 at the west edge.'),
  y: z.number().int().min(0).max(SANDBOX_GRID.rows - 1).optional().describe('Row on the map grid, 0 at the north edge.'),
  neighbors: z.array(id).max(8).optional().describe('Ids of the regions it borders. Borders run both ways.'),
  strength: z.number().min(0).max(AMOUNT_LIMIT).nullable().optional().describe('How strongly it is held: garrison, walls. Shown on the map.'),
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
  reader.each('regions', regionEntry, (entry) => upsertRegion(board, entry));
  reader.each('relations', relationEntry, (entry) => setRelation(board, entry));
  reader.each('remove', boardRemoval, (entry) => removeFromBoard(board, entry));
  reader.rejectUnknown(Object.keys(SANDBOX_PARTS), 'part of the sandbox');

  // An empty section sets nothing up.
  const inUse = board.period || board.resources.length > 0 || Object.keys(board.factions).length > 0 || Object.keys(board.regions).length > 0;
  if (inUse) world.modules.sandbox = board;
  return events;
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
  const strength = (force: number, edge: number, dice: number[]) => force * (1 + 0.15 * edge) * (0.75 + 0.05 * sum(dice));
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

function fightBattle(board: SandboxState, entry: BattleEntry, random: () => number): { report: unknown; events: WorldEvent[] } {
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

  const result = resolveBattle(
    { attackerForce, defenderForce, attackerEdge: entry.attacker_edge ?? 0, defenderEdge: entry.defender_edge ?? 0 },
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

  const captured = region !== undefined && result.winner === 'attacker' && region.ownerId !== attacker.id;
  if (captured) events.push(changeHands(board, region, attacker.id));

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
        const fought = fightBattle(board, entry, ctx.random);
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

// --- what characters know of it -----------------------------------------------

/** The balance of power as anyone in the world would know it, plus the books of the faction this character leads. */
function commonKnowledge(world: WorldState, characterId: string): unknown {
  const board = world.modules.sandbox;
  if (!board || Object.keys(board.factions).length === 0) return undefined;
  const factions = Object.values(board.factions);
  const regions = Object.values(board.regions);
  const resourceName = (resourceId: string) => board.resources.find((entry) => entry.id === resourceId)?.name ?? resourceId;
  const named = (amounts: Record<string, number>) =>
    Object.fromEntries(Object.entries(amounts).map(([resourceId, amount]) => [resourceName(resourceId), amount]));
  const led = factions.find((faction) => faction.leaderId === characterId);

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
  };
}

// --- what the game master is told ---------------------------------------------

const en = `## Sandbox

You have a sandbox: a board of regions, the factions that hold them, and what each faction has. It is for stories about powers contending over territory: kingdoms and warlords, sects, gangs, trading houses. In any other story, leave it alone.

Set the board up in the opening record, under sandbox: the resources factions count (two to five: treasury, grain, troops, stability), the factions (three to eight, the player's own marked is_player), the regions (six to twenty) and how the factions stand toward each other. Place every region on the map grid (x from 0 to ${SANDBOX_GRID.columns - 1} west to east, y from 0 to ${SANDBOX_GRID.rows - 1} north to south) so that the map resembles the geography, neighbours side by side, and list which regions border which. Give each faction its starting holdings and its income per round. Give factions leaders from the cast (leader_id), so the player can speak with them.

The board is the player's view of the balance of power, and it is what you are handed back next turn. Keep it in step with the story: whenever territory, holdings or relations change, write the change to record.sandbox in the same turn you tell it.

simulate settles what should not be yours to decide. Call it before you narrate, and tell the story as it came out:
- battles: say who attacks whom, with what force and what edge, and the dice settle who wins, by how much, and what each side loses. Never decide a battle yourself.
- advance: lets a round pass (a season, a month: whatever span suits the story) and applies every faction's income. Do it when that time passes in the story, not every turn.

The other factions are not waiting for the player. Each round, have one or two of them act on their own goals: raise troops, strike a neighbour, offer or break a pact. Record what that changes.`;

const zh = `## 沙盘

你有一个沙盘：一张由若干地区组成的地图、占据这些地区的各方势力，以及每方势力的家底。它用于讲述各方势力争夺地盘的故事：王朝与诸侯、宗门、帮派、商行。其他类型的故事不要动它。

在开场的 record 里，于 sandbox 下把沙盘搭好：各势力要统计的资源（二到五种：国库、粮草、兵力、民心之类）、各方势力（三到八个，玩家所在的一方标 is_player）、各个地区（六到二十个），以及势力之间的关系。把每个地区摆到地图网格上（x 从 0 到 ${SANDBOX_GRID.columns - 1}，自西向东；y 从 0 到 ${SANDBOX_GRID.rows - 1}，自北向南），让地图大致符合地理，相邻的地区挨在一起，并写明哪些地区彼此接壤。写上每方势力的初始家底和每轮的收支。用登场人物担任势力首领（leader_id），这样玩家可以直接与他们对话。

沙盘是玩家看到的势力格局，也是下一回合交还给你的依据。让它与剧情保持同步：凡是地盘、家底或关系有变，就在讲述的同一回合写进 record.sandbox。

不该由你拍板的事，交给 simulate。先调用它，再按结果叙述：
- battles：说明谁攻打谁、各投入多少兵力、各占什么优势，由骰子裁定胜负、胜负悬殊的程度和双方的损失。不要自己决定一场仗的输赢。
- advance：让一轮时间过去（一季、一月，按故事合适的跨度），并结算每方势力的收支。故事里确实过了这段时间才调用，不必每回合都调用。

其他势力不会站着等玩家。每一轮，让其中一两方按各自的目标行动：征兵、攻打邻居、提出或撕毁盟约，并把由此带来的变化记录下来。`;

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
  guide: { en, zh },
  shownToCharacter: { tag: 'the_board', of: commonKnowledge },
};
