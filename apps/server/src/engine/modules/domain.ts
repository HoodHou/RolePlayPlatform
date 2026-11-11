import {
  FACILITY_STATUSES,
  type DomainCycleOutcome,
  type DomainFacility,
  type DomainResource,
  type DomainState,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import {
  asParts,
  entryReader,
  id,
  invalidInput,
  toJsonSchema,
  type EntryError,
  type GameTool,
  type ToolContext,
} from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Domain & Construction: the player's capital, fief, sect mountain, or stronghold,
 * with stockpiled resources, per-cycle yields, upgradable facilities, construction
 * progress bars, and cast NPCs assigned as stewards/garrison commanders.
 */

export const DEVELOP_DOMAIN = 'develop_domain';

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const die20 = (random: () => number) => Math.floor(random() * 20) + 1;

function ensureDomain(world: WorldState): DomainState {
  return (world.modules.domain ??= {
    name: '',
    tier: '',
    locationId: null,
    cycles: 0,
    resources: [],
    facilities: {},
  });
}

const OUTCOME_MEANING: Record<DomainCycleOutcome, string> = {
  bountiful: 'Booming cycle: construction surges ahead (+2 segments) and domain yields increase by 50%.',
  steady: 'Orderly cycle: construction advances (+1 segment) and full domain yields are collected.',
  delayed: 'Bottlenecks and friction: construction creeps (+1 segment) while positive yields are halved.',
  setback: 'Disruption, graft, or accident stalls construction (+0 segments) and cuts yields to a quarter.',
};

// --- develop_domain tool ------------------------------------------------------

const developDomainInput = z.strictObject({
  facility_id: id
    .optional()
    .describe('Facility id in `domain.facilities` to focus construction or repair on this cycle.'),
  effort_bonus: z
    .number()
    .int()
    .min(-5)
    .max(10)
    .optional()
    .describe('Optional modifier (-5 to +10) from extra treasury investment, labor mobilization, or crisis.'),
});

const developDomainTool: GameTool = {
  name: DEVELOP_DOMAIN,
  silent: false,
  records: true,
  endsTurn: false,
  run(world: WorldState, raw: unknown, ctx: ToolContext) {
    const parsed = developDomainInput.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error, raw);
    const input = parsed.data;

    try {
      const state = ensureDomain(world);
      let focusFacility: DomainFacility | undefined;
      if (input.facility_id) {
        focusFacility = state.facilities[input.facility_id];
        if (!focusFacility) {
          throw new WorldOpError(`There is no facility with id "${input.facility_id}" in domain.facilities.`);
        }
      } else {
        focusFacility =
          Object.values(state.facilities).find((f) => f.status === 'building' || f.status === 'damaged') ??
          Object.values(state.facilities)[0];
      }

      let stewardBonus = 0;
      let stewardName = '';
      if (focusFacility?.stewardId) {
        const steward = world.characters[focusFacility.stewardId];
        if (steward) {
          stewardName = steward.name;
          const official = world.modules.court?.officials[steward.id];
          stewardBonus = official ? Math.max(1, Math.round(official.governance / 25)) : 2;
        }
      }

      const roll = die20(ctx.random);
      const bonus = stewardBonus + (input.effort_bonus ?? 0);
      const total = roll + bonus;

      let outcome: DomainCycleOutcome;
      if (roll === 20 || total >= 18) outcome = 'bountiful';
      else if (roll === 1 || total < 6) outcome = 'setback';
      else if (total >= 11) outcome = 'steady';
      else outcome = 'delayed';

      state.cycles += 1;

      let completedFacility = '';
      if (focusFacility && (focusFacility.status === 'building' || focusFacility.status === 'damaged')) {
        const ticks = outcome === 'bountiful' ? 2 : outcome === 'setback' ? 0 : 1;
        focusFacility.progress = clamp(focusFacility.progress + ticks, 0, focusFacility.segments);
        if (focusFacility.progress >= focusFacility.segments) {
          if (focusFacility.status === 'building') {
            focusFacility.level = Math.min(focusFacility.maxLevel, focusFacility.level + 1);
          }
          focusFacility.status = 'operational';
          focusFacility.progress = 0;
          completedFacility = focusFacility.name;
        }
      }

      const yieldFactor =
        outcome === 'bountiful' ? 1.5 : outcome === 'steady' ? 1 : outcome === 'delayed' ? 0.5 : 0.25;
      const changes: { resource: string; from: number; to: number }[] = [];
      for (const res of state.resources) {
        if (res.perCycle === 0) continue;
        const delta =
          res.perCycle > 0 ? Math.round(res.perCycle * yieldFactor) : res.perCycle;
        if (delta === 0) continue;
        const from = res.amount;
        const to = Math.max(0, from + delta);
        if (to !== from) {
          res.amount = to;
          changes.push({ resource: res.name, from, to });
        }
      }

      const event: WorldEvent = {
        type: 'domain_cycle',
        domainName: state.name,
        cycle: state.cycles,
        facilityName: focusFacility?.name ?? '',
        stewardName,
        roll,
        bonus,
        total,
        outcome,
        completedFacility,
        changes,
      };

      return {
        content: JSON.stringify({
          domain: state.name,
          cycle: state.cycles,
          focused_facility: focusFacility
            ? {
                id: focusFacility.id,
                name: focusFacility.name,
                level: focusFacility.level,
                status: focusFacility.status,
                progress: focusFacility.progress,
                segments: focusFacility.segments,
              }
            : null,
          completed_facility: completedFacility || null,
          steward: stewardName || null,
          roll,
          bonus,
          total,
          outcome,
          resource_changes: changes,
          means: OUTCOME_MEANING[outcome],
        }),
        isError: false,
        events: [event],
      };
    } catch (err) {
      if (err instanceof WorldOpError) return { content: err.message, isError: true, events: [] };
      throw err;
    }
  },
};

// --- record.domain ------------------------------------------------------------

const resourceEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Resource name ("白银", "灵石", "粮草", "工匠"). Required when creating.'),
  amount: z.number().int().min(0).optional().describe('Set stockpile directly.'),
  delta: z.number().int().optional().describe('Or adjust stockpile by this delta.'),
  per_cycle: z.number().int().optional().describe('Net yield per development cycle.'),
  remove: z.boolean().optional(),
});

const facilityEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Facility name ("将作监工坊", "护山大阵", "常平仓"). Required when creating.'),
  category: z.string().optional().describe('Category ("农商", "军防", "文教", "百工", "灵脉").'),
  level: z.number().int().min(0).max(20).optional().describe('Current level (0 while first being built).'),
  max_level: z.number().int().min(1).max(20).optional().describe('Maximum level; defaults to 5.'),
  status: z.enum(FACILITY_STATUSES).optional().describe('operational, building, or damaged.'),
  progress: z.number().int().min(0).max(20).optional().describe('Filled construction segments.'),
  segments: z.number().int().min(1).max(20).optional().describe('Segments required to finish building/repair; defaults to 3.'),
  steward_id: id.nullable().optional().describe('Character id of the NPC assigned to oversee this facility, or null.'),
  output: z.string().optional().describe('Short summary of yield or benefit.'),
  description: z.string().optional(),
  remove: z.boolean().optional(),
});

const domainSection = z
  .strictObject({
    name: z.string().optional().describe('Name of the capital, estate, fief, or sect seat.'),
    tier: z.string().optional().describe('Scale/rank ("九五帝京", "边陲军镇", "洞天福地").'),
    location_id: id.nullable().optional().describe('Location id in `world.locations`, if mapped.'),
    resources: z.array(resourceEntry).max(12).optional(),
    facilities: z.array(facilityEntry).max(24).optional(),
  })
  .describe('Domain & Construction: domain seat, stockpiles, upgradable facilities, and assigned NPC stewards.');

function upsertResource(state: DomainState, entry: z.infer<typeof resourceEntry>): WorldEvent[] {
  const idx = state.resources.findIndex((r) => r.id === entry.id);
  const existing = idx >= 0 ? state.resources[idx] : undefined;
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no domain resource with id "${entry.id}".`);
    state.resources.splice(idx, 1);
    return [];
  }
  const name = entry.name?.trim();
  if (!existing && !name) {
    throw new WorldOpError(`Domain resource "${entry.id}" needs "name" when created.`);
  }
  const res: DomainResource = existing ?? { id: entry.id, name: name ?? '', amount: 0, perCycle: 0 };
  if (existing && name) res.name = name;
  if (entry.amount !== undefined) res.amount = Math.max(0, entry.amount);
  else if (entry.delta !== undefined) res.amount = Math.max(0, res.amount + entry.delta);
  if (entry.per_cycle !== undefined) res.perCycle = entry.per_cycle;
  if (!existing) state.resources.push(res);
  return [];
}

function upsertFacility(world: WorldState, state: DomainState, entry: z.infer<typeof facilityEntry>): WorldEvent[] {
  const existing = state.facilities[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no facility with id "${entry.id}".`);
    delete state.facilities[entry.id];
    return [];
  }
  const name = entry.name?.trim();
  if (!existing && !name) {
    throw new WorldOpError(`Facility "${entry.id}" needs "name" when created.`);
  }
  if (entry.steward_id) {
    const steward = world.characters[entry.steward_id];
    if (!steward) {
      throw new WorldOpError(`Steward character "${entry.steward_id}" does not exist.`);
    }
    if (steward.isPlayer) {
      throw new WorldOpError('The player character cannot be assigned as a facility steward.');
    }
    const board = world.modules.sandbox;
    if (board) {
      const rivalFaction = Object.values(board.factions).find(
        (faction) => faction.leaderId === entry.steward_id && !faction.isPlayer,
      );
      if (rivalFaction) {
        throw new WorldOpError(
          `"${steward.name}" leads rival faction "${rivalFaction.name}" and cannot be appointed as a domain steward.`,
        );
      }
      const rivalPost = Object.values(board.regions).find(
        (region) =>
          region.commanderId === entry.steward_id &&
          region.ownerId !== null &&
          !board.factions[region.ownerId]?.isPlayer,
      );
      if (rivalPost) {
        throw new WorldOpError(
          `"${steward.name}" commands "${rivalPost.name}" for another faction and cannot be appointed as a domain steward.`,
        );
      }
    }
  }

  const prevLevel = existing?.level;
  const prevStatus = existing?.status;
  const prevSteward = existing?.stewardId;

  const facility: DomainFacility = existing ?? {
    id: entry.id,
    name: name ?? '',
    category: '',
    level: entry.level ?? (entry.status === 'building' ? 0 : 1),
    maxLevel: entry.max_level ?? 5,
    status: entry.status ?? 'operational',
    progress: entry.progress ?? 0,
    segments: entry.segments ?? 3,
    stewardId: null,
    output: '',
    description: '',
  };
  if (existing && name) facility.name = name;
  if (entry.category !== undefined) facility.category = entry.category.trim();
  if (entry.max_level !== undefined) facility.maxLevel = entry.max_level;
  if (entry.level !== undefined) facility.level = clamp(entry.level, 0, facility.maxLevel);
  if (entry.status !== undefined) facility.status = entry.status;
  if (entry.segments !== undefined) facility.segments = entry.segments;
  if (entry.progress !== undefined) facility.progress = clamp(entry.progress, 0, facility.segments);
  if (entry.steward_id !== undefined) facility.stewardId = entry.steward_id;
  if (entry.output !== undefined) facility.output = entry.output.trim();
  if (entry.description !== undefined) facility.description = entry.description;

  state.facilities[facility.id] = facility;

  if (
    !existing ||
    facility.level !== prevLevel ||
    facility.status !== prevStatus ||
    facility.stewardId !== prevSteward
  ) {
    const stewardName = facility.stewardId ? (world.characters[facility.stewardId]?.name ?? '') : '';
    return [
      {
        type: 'facility_updated',
        id: facility.id,
        name: facility.name,
        level: facility.level,
        status: facility.status,
        stewardName,
      },
    ];
  }
  return [];
}

function applyDomain(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'domain', errors);
  if (!parts) return [];

  const state = ensureDomain(world);
  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'domain.', errors, events);
  reader.rejectUnknown(['name', 'tier', 'location_id', 'resources', 'facilities'], 'domain field');
  reader.one('name', z.string(), (value) => {
    state.name = value.trim();
    return [];
  });
  reader.one('tier', z.string(), (value) => {
    state.tier = value.trim();
    return [];
  });
  reader.one('location_id', id.nullable(), (value) => {
    if (value && !world.locations[value]) throw new WorldOpError(`Location "${value}" does not exist.`);
    state.locationId = value;
    return [];
  });
  reader.each('resources', resourceEntry, (entry) => upsertResource(state, entry));
  reader.each('facilities', facilityEntry, (entry) => upsertFacility(world, state, entry));
  return events;
}

function domainPostView(world: WorldState, characterId: string): unknown {
  const state = world.modules.domain;
  if (!state) return undefined;
  const posts = Object.values(state.facilities).filter((f) => f.stewardId === characterId);
  if (posts.length === 0) return undefined;
  return {
    domain: state.name,
    tier: state.tier,
    overseeing: posts.map((f) => ({
      name: f.name,
      category: f.category,
      level: f.level,
      status: f.status,
      output: f.output,
    })),
  };
}

const en = `## Domain and construction

You have a domain ledger under record.domain and the develop_domain tool for building up an imperial capital, feudal fief, frontier fortress, guildhq, or cultivation sect mountain, and assigning cast NPCs as stewards.

Record the domain's name, tier, resources (stockpiles and per_cycle net yields), and facilities (level, status: operational / building / damaged, construction progress/segments, output, and steward_id pointing to a character in record.characters). When a project starts, set status: "building", progress: 0, and segments (e.g. 3), and deduct its upfront cost from resources.

When a construction season passes or the player inspects and pushes domain works, call develop_domain before narrating. The server rolls a d20 modified by the assigned steward's capability, advances construction segments (completing and leveling up the facility when full), and settles per_cycle resource yields.`;

const zh = `## 领地营造与驻守委派

你在 record.domain 下拥有领地营造与产业面板，并配有 develop_domain 工具，适用于经营帝京皇城、藩封城池、边塞军镇、商会总舵或修仙宗门驻地，并委派在案 NPC 驻守主理。

在 record.domain 中记录领地名称（name）、规模品阶（tier）、资源储备与每轮产出（resources 的 amount 与 per_cycle），以及各类建筑设施（facilities：等级 level、状态 operational/building/damaged、工期进度 progress/segments、产出效果 output，以及驻守主理官员/弟子 steward_id）。新修或扩建工程可设为 status: "building" 并扣除相应资源消耗。

当推进一轮领地营造或督办工程结算时，先调用 develop_domain 再叙述。服务端会结合驻守 NPC 的能力投掷 d20，自动推进工期进度（满格时完工升级为 operational）并结算各项资源的周期收支。`;

const assignStewardOpSchema = z.strictObject({
  facility_id: id,
  steward_id: id.nullable(),
});

const setFacilityStatusOpSchema = z.strictObject({
  facility_id: id,
  status: z.enum(FACILITY_STATUSES),
  progress: z.number().int().min(0).max(20).optional(),
});

function operateDomain(
  world: WorldState,
  op: string,
  params: Record<string, unknown>,
): { events: WorldEvent[]; summary: string } {
  const state = ensureDomain(world);

  if (op === 'assign_steward') {
    const parsed = assignStewardOpSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const facility = state.facilities[parsed.data.facility_id];
    if (!facility) throw new WorldOpError(`There is no facility with id "${parsed.data.facility_id}".`);
    const events = upsertFacility(world, state, {
      id: parsed.data.facility_id,
      steward_id: parsed.data.steward_id,
    });
    const stewardName = parsed.data.steward_id
      ? (world.characters[parsed.data.steward_id]?.name ?? parsed.data.steward_id)
      : '解除驻守';
    return { events, summary: `【${facility.name}】驻守委派：${stewardName}` };
  }

  if (op === 'set_facility_status') {
    const parsed = setFacilityStatusOpSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const facility = state.facilities[parsed.data.facility_id];
    if (!facility) throw new WorldOpError(`There is no facility with id "${parsed.data.facility_id}".`);
    const events = upsertFacility(world, state, {
      id: parsed.data.facility_id,
      status: parsed.data.status,
      ...(parsed.data.progress !== undefined
        ? { progress: parsed.data.progress }
        : parsed.data.status === 'building'
          ? { progress: 0 }
          : {}),
    });
    const label =
      parsed.data.status === 'building' ? '兴工扩建' : parsed.data.status === 'operational' ? '恢复运转' : '受损待修';
    return { events, summary: `【${facility.name}】工程状态：${label}` };
  }

  throw new WorldOpError(`Unknown domain operation "${op}".`);
}

export const domainModule: GameModule = {
  id: 'domain',
  keptWhenUnused: false,
  hasPanel: true,
  tools: [
    {
      tool: developDomainTool,
      spec: {
        name: DEVELOP_DOMAIN,
        description:
          'Advance a domain construction and harvest cycle. Rolls a d20 modified by the facility steward\'s skill, ticks building progress (upgrading completed projects), and collects per-cycle resource yields.',
        inputSchema: toJsonSchema(developDomainInput),
      },
    },
  ],
  record: { schema: domainSection, apply: applyDomain },
  guide: { en, zh },
  shownToCharacter: { tag: 'domain_post', of: domainPostView },
  operate: operateDomain,
};
