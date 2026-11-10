import {
  ROUTE_HAZARDS,
  TRAVEL_PACES,
  type JourneyOutcome,
  type RouteHazard,
  type TravelPace,
  type TravelRoute,
  type TravelState,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { asParts, entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool, type ToolContext } from '../toolKit';
import { setScene, WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Travel & Routes: roads, sea lanes, and mountain passes between locations,
 * with travel times in hours, terrain, and hazard levels (`safe`, `watchful`,
 * `perilous`, `deadly`). The `journey` tool computes travel time by pace,
 * rolls a d100 for what happens on the road, and moves the scene on arrival.
 */

export const JOURNEY = 'journey';

const die100 = (random: () => number) => Math.floor(random() * 100) + 1;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

function ensureTravel(world: WorldState): TravelState {
  return (world.modules.travel ??= {
    routes: {},
    hoursTravelled: 0,
  });
}

export interface JourneyRollResult {
  roll: number;
  adjusted: number;
  hours: number;
  outcome: JourneyOutcome;
  arrived: boolean;
}

const OUTCOME_MEANING: Record<JourneyOutcome, string> = {
  clear: 'The road passes without trouble; the party arrives in good order.',
  discovery: 'Something noteworthy is found along the way: a landmark, a rumour, a cache, or a vantage point.',
  omen: 'A sign of danger or a shifting power is seen on the road, foreshadowing what lies ahead.',
  hazard: 'Rough terrain, weather, or a toll exacts a cost on the road, though the party pushes through to the destination.',
  ambush: 'The journey is waylaid mid-route! Resolve the encounter on the road before the party can reach the destination.',
};

/**
 * Resolves a journey along a route of `hazard` and `baseHours` at `pace`.
 *   cautious: +25% time, -15 to the hazard roll.
 *   normal:   100% time, +0 to the hazard roll.
 *   forced:   -25% time, +15 to the hazard roll.
 */
export function resolveJourney(
  hazard: RouteHazard,
  pace: TravelPace,
  baseHours: number,
  random: () => number,
): JourneyRollResult {
  const timeFactor = pace === 'cautious' ? 1.25 : pace === 'forced' ? 0.75 : 1;
  const fullHours = Math.max(1, Math.round(baseHours * timeFactor));
  const modifier = pace === 'cautious' ? -15 : pace === 'forced' ? 15 : 0;

  const roll = die100(random);
  const adjusted = clamp(roll + modifier, 1, 100);

  let outcome: JourneyOutcome;
  switch (hazard) {
    case 'safe':
      if (adjusted <= 75) outcome = 'clear';
      else if (adjusted <= 90) outcome = 'discovery';
      else if (adjusted <= 98) outcome = 'omen';
      else outcome = 'hazard';
      break;
    case 'watchful':
      if (adjusted <= 50) outcome = 'clear';
      else if (adjusted <= 65) outcome = 'discovery';
      else if (adjusted <= 82) outcome = 'omen';
      else if (adjusted <= 95) outcome = 'hazard';
      else outcome = 'ambush';
      break;
    case 'perilous':
      if (adjusted <= 30) outcome = 'clear';
      else if (adjusted <= 45) outcome = 'discovery';
      else if (adjusted <= 65) outcome = 'omen';
      else if (adjusted <= 88) outcome = 'hazard';
      else outcome = 'ambush';
      break;
    case 'deadly':
      if (adjusted <= 15) outcome = 'clear';
      else if (adjusted <= 28) outcome = 'discovery';
      else if (adjusted <= 50) outcome = 'omen';
      else if (adjusted <= 80) outcome = 'hazard';
      else outcome = 'ambush';
      break;
  }

  const arrived = outcome !== 'ambush';
  const hours = arrived ? fullHours : Math.max(1, Math.ceil(fullHours / 2));
  return { roll, adjusted, hours, outcome, arrived };
}

function findRouteBetween(state: TravelState | undefined, fromId: string, toId: string): TravelRoute | undefined {
  if (!state) return undefined;
  return Object.values(state.routes).find(
    (route) =>
      (route.fromId === fromId && route.toId === toId) ||
      (route.fromId === toId && route.toId === fromId),
  );
}

// --- the journey tool --------------------------------------------------------

const journeyInput = z.strictObject({
  to_id: id.describe('Destination location id in `world.locations`.'),
  from_id: id.optional().describe('Starting location id; defaults to the current scene location.'),
  route_id: id.optional().describe('Id of the route taken in `world.modules.travel.routes`. Looked up automatically when omitted.'),
  pace: z.enum(TRAVEL_PACES).optional().describe('cautious (slower, safer), normal, or forced (faster, riskier). Defaults to normal.'),
  hours: z.number().int().min(1).max(720).optional().describe('Base travel hours when travelling overland without a recorded route.'),
  hazard: z.enum(ROUTE_HAZARDS).optional().describe('Hazard level when travelling without a recorded route.'),
});

const journeyTool: GameTool = {
  name: JOURNEY,
  silent: false,
  records: true,
  endsTurn: false,
  run(world: WorldState, raw: unknown, ctx: ToolContext) {
    const parsed = journeyInput.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error, raw);
    const input = parsed.data;

    try {
      const fromId = input.from_id ?? world.scene.locationId;
      if (!fromId) {
        throw new WorldOpError('The scene has no current location. Pass "from_id" or set the scene first.');
      }
      const fromLocation = world.locations[fromId];
      if (!fromLocation) {
        throw new WorldOpError(`Starting location "${fromId}" does not exist.`);
      }
      const toLocation = world.locations[input.to_id];
      if (!toLocation) {
        throw new WorldOpError(`Destination location "${input.to_id}" does not exist. Create it first.`);
      }
      if (fromId === input.to_id) {
        throw new WorldOpError(`The party is already at "${toLocation.name}".`);
      }

      const state = ensureTravel(world);
      const route = input.route_id ? state.routes[input.route_id] : findRouteBetween(state, fromId, input.to_id);
      if (input.route_id && !route) {
        throw new WorldOpError(`There is no route with id "${input.route_id}".`);
      }
      if (route && route.blocked) {
        throw new WorldOpError(`Route "${route.name}" is blocked and cannot be travelled until cleared.`);
      }

      const pace: TravelPace = input.pace ?? 'normal';
      const hazard: RouteHazard = input.hazard ?? route?.hazard ?? 'watchful';
      const baseHours = input.hours ?? route?.hours ?? 4;
      const routeName = route?.name ?? `${fromLocation.name} – ${toLocation.name}`;

      const events: WorldEvent[] = [];
      if (route && !route.discovered) {
        route.discovered = true;
        events.push({
          type: 'route_discovered',
          id: route.id,
          name: route.name,
          fromName: world.locations[route.fromId]?.name ?? route.fromId,
          toName: world.locations[route.toId]?.name ?? route.toId,
          hazard: route.hazard,
        });
      }

      const resolved = resolveJourney(hazard, pace, baseHours, ctx.random);
      state.hoursTravelled += resolved.hours;

      events.push({
        type: 'journey_made',
        routeId: route?.id ?? null,
        routeName,
        fromId,
        fromName: fromLocation.name,
        toId: toLocation.id,
        toName: toLocation.name,
        pace,
        hours: resolved.hours,
        hazard,
        roll: resolved.roll,
        outcome: resolved.outcome,
        arrived: resolved.arrived,
      });

      if (resolved.arrived) {
        events.push(...setScene(world, { locationId: toLocation.id }));
      }

      return {
        content: JSON.stringify({
          route: routeName,
          from: fromLocation.name,
          to: toLocation.name,
          pace,
          hazard,
          hours_spent: resolved.hours,
          roll: resolved.roll,
          outcome: resolved.outcome,
          arrived: resolved.arrived,
          means: OUTCOME_MEANING[resolved.outcome],
        }),
        isError: false,
        events,
      };
    } catch (err) {
      if (err instanceof WorldOpError) return { content: err.message, isError: true, events: [] };
      throw err;
    }
  },
};

// --- record.travel: routes between places ------------------------------------

const routeEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Name of the road, pass, or sea lane. Required when creating.'),
  description: z.string().optional().describe('What travelling this route is like.'),
  from_id: id.optional().describe('Location id at one end of the route. Required when creating.'),
  to_id: id.optional().describe('Location id at the other end of the route. Required when creating.'),
  hours: z.number().int().min(1).max(720).optional().describe('Travel time at a normal pace, in hours. Defaults to 4.'),
  terrain: z.string().optional().describe('Terrain label: "mountain pass", "marsh road", "水路".'),
  hazard: z.enum(ROUTE_HAZARDS).optional().describe('safe, watchful, perilous, or deadly. Defaults to watchful.'),
  discovered: z.boolean().optional().describe('False for a hidden path until found; defaults to true.'),
  blocked: z.boolean().optional().describe('True when the route is impassable (flooded bridge, snowed-in pass).'),
  remove: z.boolean().optional().describe('True to remove this route.'),
});

const travelSection = z
  .strictObject({
    routes: z.array(routeEntry).max(20).optional().describe('Routes between locations to chart, open, block, or reveal.'),
  })
  .describe('Travel map: routes connecting locations, their travel hours, terrain, and hazard levels.');

function connectLocations(world: WorldState, aId: string, bId: string): void {
  const a = world.locations[aId];
  const b = world.locations[bId];
  if (a && !a.connections.includes(bId)) a.connections.push(bId);
  if (b && !b.connections.includes(aId)) b.connections.push(aId);
}

function upsertRoute(world: WorldState, entry: z.infer<typeof routeEntry>): WorldEvent[] {
  const state = ensureTravel(world);
  const existing = state.routes[entry.id];

  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no route with id "${entry.id}".`);
    delete state.routes[entry.id];
    return [];
  }

  const name = entry.name?.trim();
  if (!existing && !name) {
    throw new WorldOpError(`Route "${entry.id}" does not exist yet. Include "name" to create it.`);
  }
  const fromId = entry.from_id ?? existing?.fromId;
  const toId = entry.to_id ?? existing?.toId;
  if (!fromId || !toId) {
    throw new WorldOpError(`Route "${entry.id}" needs both "from_id" and "to_id".`);
  }
  if (fromId === toId) {
    throw new WorldOpError(`Route "${entry.id}" must connect two different locations.`);
  }
  if (!world.locations[fromId]) {
    throw new WorldOpError(`Location "${fromId}" does not exist. Create it first.`);
  }
  if (!world.locations[toId]) {
    throw new WorldOpError(`Location "${toId}" does not exist. Create it first.`);
  }

  const route: TravelRoute = existing ?? {
    id: entry.id,
    name: name ?? '',
    description: '',
    fromId,
    toId,
    hours: entry.hours ?? 4,
    terrain: '',
    hazard: entry.hazard ?? 'watchful',
    discovered: entry.discovered ?? true,
    blocked: entry.blocked ?? false,
  };
  const wasDiscovered = existing ? existing.discovered : false;

  if (existing && name) route.name = name;
  if (entry.description !== undefined) route.description = entry.description;
  route.fromId = fromId;
  route.toId = toId;
  if (entry.hours !== undefined) route.hours = entry.hours;
  if (entry.terrain !== undefined) route.terrain = entry.terrain.trim();
  if (entry.hazard !== undefined) route.hazard = entry.hazard;
  if (entry.discovered !== undefined) route.discovered = entry.discovered;
  if (entry.blocked !== undefined) route.blocked = entry.blocked;

  state.routes[route.id] = route;
  if (route.discovered) {
    connectLocations(world, route.fromId, route.toId);
  }

  if (route.discovered && !wasDiscovered) {
    return [
      {
        type: 'route_discovered',
        id: route.id,
        name: route.name,
        fromName: world.locations[route.fromId]?.name ?? route.fromId,
        toName: world.locations[route.toId]?.name ?? route.toId,
        hazard: route.hazard,
      },
    ];
  }
  return [];
}

function applyTravel(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'travel', errors);
  if (!parts) return [];

  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'travel.', errors, events);
  reader.rejectUnknown(['routes'], 'travel field');
  reader.each('routes', routeEntry, (entry) => upsertRoute(world, entry));
  return events;
}

const en = `## Travel and routes

You have a route map under record.travel and the journey tool for stories where distance, roads, and the perils between places matter.

Chart routes between locations in record.travel.routes with their travel time in hours, terrain, and hazard (safe, watchful, perilous, deadly). Use discovered: false for secret paths until found, and blocked: true when a bridge is out or a pass is sealed.

When the player travels from one place to another, call journey with the destination and pace (cautious takes +25% time and is safer; normal is standard; forced takes -25% time and is riskier) before narrating the road. The server rolls a d100 for what happens on the way (clear, discovery, omen, hazard, or ambush) and moves the scene to the destination unless an ambush halts the party mid-route. If the story also uses the calendar module, advance the calendar in record.calendar by the hours_spent reported by journey.`;

const zh = `## 行程与路线图

你在 record.travel 下有路线图，并配有 journey 工具，用于路途遥远、关山险阻至关重要的故事。

在 record.travel.routes 中绘制地点之间的路线，标明正常耗时（hours）、地形（terrain）与险度（safe 安全、watchful 戒备、perilous 凶险、deadly 绝地）。暗道在发现前可设为 discovered: false，断桥封山等无法通行的路设为 blocked: true。

当玩家动身前往另一处地点时，先调用 journey 传入目的地与行进节奏（pace：cautious 谨慎慢行更安全、normal 常规、forced 强行军省时但更冒险），再叙述旅途。服务端会投掷 d100 判定途中遭遇（clear 平安、discovery 奇遇发现、omen 征兆、hazard 路途损耗、ambush 半途遇袭），并在抵达时自动切换场景（若遭遇 ambush 则停在半途）。若故事同时启用了日历模块，请根据 journey 返回的 hours_spent 在 record.calendar 中推进相应时间。`;

export const travelModule: GameModule = {
  id: 'travel',
  keptWhenUnused: true,
  hasPanel: true,
  tools: [
    {
      tool: journeyTool,
      spec: {
        name: JOURNEY,
        description:
          'Travel along a route to another location at a chosen pace. Rolls a d100 for road encounters, computes hours spent, and moves the scene on arrival. Call before narrating the journey.',
        inputSchema: toJsonSchema(journeyInput),
      },
    },
  ],
  record: { schema: travelSection, apply: applyTravel },
  guide: { en, zh },
};
