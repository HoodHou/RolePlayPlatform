import {
  CHECK_DIFFICULTIES,
  COURT_DOMAINS,
  MEMORIAL_STATUSES,
  MEMORIAL_URGENCIES,
  type CheckDifficulty,
  type CourtDomain,
  type CourtEdict,
  type CourtFaction,
  type CourtMemorial,
  type CourtMetric,
  type CourtOfficial,
  type CourtOutcome,
  type CourtState,
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
 * Court & Ministers: imperial or council governance with a roster of registered
 * officials (`world.characters` entries holding offices, ranks, capabilities,
 * factional alignment, and loyalty), court factions, memorials awaiting the
 * sovereign's rescript ("朱批"), active edicts, and state metrics.
 */

export const HOLD_COURT = 'hold_court';

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const die20 = (random: () => number) => Math.floor(random() * 20) + 1;

const DIFFICULTY_TARGET: Record<CheckDifficulty, number> = {
  easy: 10,
  normal: 13,
  hard: 16,
  extreme: 19,
};

function ensureCourt(world: WorldState): CourtState {
  return (world.modules.court ??= {
    regimeName: '',
    rulerTitle: '',
    sessionsHeld: 0,
    metrics: [],
    factions: {},
    officials: {},
    memorials: {},
    edicts: {},
  });
}

const OUTCOME_MEANING: Record<CourtOutcome, string> = {
  smooth: 'The court carries out the decree swiftly and in full; authority strengthens.',
  compromise: 'The measure passes only after concessions to court opposition; positive gains are tempered.',
  deadlock: 'Factional wrangling stalls the decree in council; nothing moves on the ground yet.',
  backlash: 'Open resistance or administrative sabotage turns the measure awry, incurring political and material costs.',
};

// --- hold_court tool ----------------------------------------------------------

const metricDeltaInput = z.strictObject({
  id: id.describe('Metric id in `world.modules.court.metrics`.'),
  delta: z.number().int().min(-100_000).max(100_000).describe('Intended change if the decree succeeds smoothly.'),
});

const holdCourtInput = z.strictObject({
  agenda: z.string().min(1).describe('The decree, reform, campaign, or dispute put before the court.'),
  domain: z
    .enum(COURT_DOMAINS)
    .optional()
    .describe('Capability tested: governance, military, or intrigue. Defaults to governance.'),
  lead_official_id: id
    .optional()
    .describe('Character id of the registered official spearheading execution or debate.'),
  opposing_faction_id: id
    .optional()
    .describe('Faction id in `court.factions` resisting or complicating the measure.'),
  difficulty: z
    .enum(CHECK_DIFFICULTIES)
    .optional()
    .describe('easy, normal, hard, or extreme. Defaults to normal.'),
  metric_changes: z
    .array(metricDeltaInput)
    .max(8)
    .optional()
    .describe('Intended shifts to court metrics if carried out; scaled automatically by the court outcome.'),
});

const holdCourtTool: GameTool = {
  name: HOLD_COURT,
  silent: false,
  records: true,
  endsTurn: false,
  run(world: WorldState, raw: unknown, ctx: ToolContext) {
    const parsed = holdCourtInput.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error, raw);
    const input = parsed.data;

    try {
      const state = ensureCourt(world);
      const domain: CourtDomain = input.domain ?? 'governance';
      const difficulty: CheckDifficulty = input.difficulty ?? 'normal';

      const lead = input.lead_official_id ? state.officials[input.lead_official_id] : undefined;
      if (input.lead_official_id && !lead) {
        throw new WorldOpError(
          `Character "${input.lead_official_id}" is not registered in court.officials.`,
        );
      }
      const opposition = input.opposing_faction_id ? state.factions[input.opposing_faction_id] : undefined;
      if (input.opposing_faction_id && !opposition) {
        throw new WorldOpError(`There is no court faction with id "${input.opposing_faction_id}".`);
      }

      const statBonus = lead ? Math.round((lead[domain] - 50) / 10) : 0;
      const loyaltyMod = lead ? (lead.loyalty >= 75 ? 1 : lead.loyalty <= 30 ? -2 : 0) : 0;
      const bonus = statBonus + loyaltyMod;
      const oppositionMod = opposition ? Math.round(opposition.influence / 20) : 0;
      const target = DIFFICULTY_TARGET[difficulty] + oppositionMod;

      const roll = die20(ctx.random);
      const total = roll + bonus;

      let outcome: CourtOutcome;
      if (roll === 20 || total >= target + 4) outcome = 'smooth';
      else if (roll === 1 || total <= target - 5) outcome = 'backlash';
      else if (total >= target) outcome = 'compromise';
      else outcome = 'deadlock';

      state.sessionsHeld += 1;

      if (lead) {
        if (outcome === 'smooth') lead.influence = clamp(lead.influence + 2, 0, 100);
        else if (outcome === 'backlash') lead.influence = clamp(lead.influence - 2, 0, 100);
      }
      if (opposition) {
        if (outcome === 'compromise') opposition.influence = clamp(opposition.influence + 2, 0, 100);
        else if (outcome === 'deadlock') opposition.influence = clamp(opposition.influence + 1, 0, 100);
        else if (outcome === 'backlash') opposition.influence = clamp(opposition.influence + 4, 0, 100);
        else if (outcome === 'smooth') opposition.influence = clamp(opposition.influence - 2, 0, 100);
      }

      const changes: { metric: string; from: number; to: number }[] = [];
      for (const patch of input.metric_changes ?? []) {
        const metric = state.metrics.find((m) => m.id === patch.id);
        if (!metric) continue;
        let applied = 0;
        if (outcome === 'smooth') {
          applied = patch.delta;
        } else if (outcome === 'compromise') {
          applied =
            patch.delta > 0
              ? Math.max(1, Math.round(patch.delta * 0.6))
              : patch.delta;
        } else if (outcome === 'deadlock') {
          applied = 0;
        } else {
          applied =
            patch.delta > 0
              ? -Math.max(1, Math.round(patch.delta * 0.35))
              : Math.round(patch.delta * 1.25);
        }
        if (applied === 0) continue;
        const from = metric.value;
        const rawNext = from + applied;
        const to = metric.max !== undefined ? clamp(rawNext, 0, metric.max) : rawNext;
        if (to !== from) {
          metric.value = to;
          metric.delta = to - from;
          changes.push({ metric: metric.name, from, to });
        }
      }

      const leadName = lead ? (world.characters[lead.characterId]?.name ?? lead.characterId) : '';
      const oppositionName = opposition?.name ?? '';

      const event: WorldEvent = {
        type: 'court_session',
        agenda: input.agenda.trim(),
        domain,
        leadName,
        oppositionName,
        roll,
        bonus,
        total,
        target,
        outcome,
        changes,
      };

      return {
        content: JSON.stringify({
          agenda: input.agenda.trim(),
          domain,
          lead: leadName || null,
          opposition: oppositionName || null,
          roll,
          bonus,
          total,
          target,
          outcome,
          changes,
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

// --- record.court -------------------------------------------------------------

const metricEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Display name ("国库银两", "民心", "边防军备"). Required when creating.'),
  value: z.number().optional().describe('Set the metric value directly.'),
  delta: z.number().optional().describe('Or adjust the current value by this delta.'),
  max: z.number().nullable().optional().describe('Optional upper bound for gauge metrics (e.g. 100 for stability).'),
  remove: z.boolean().optional(),
});

const factionEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Faction name ("清流党", "勋贵集团"). Required when creating.'),
  description: z.string().optional(),
  leader_id: id.nullable().optional().describe('Character id of the faction leader, or null.'),
  influence: z.number().int().min(0).max(100).optional().describe('Political influence at court, 0 to 100.'),
  stance: z.string().optional().describe('Political agenda or current posture.'),
  remove: z.boolean().optional(),
});

const officialEntry = z.strictObject({
  character_id: id.describe('Character id in `world.characters`. Create the character in `record.characters` first.'),
  office: z.string().optional().describe('Official post/title ("内阁首辅", "户部尚书"). Required when registering.'),
  department: z.string().optional().describe('Ministry or organ ("内阁", "六部", "都察院", "封疆").'),
  rank: z.string().optional().describe('Rank label ("正一品", "从二品").'),
  faction_id: id.nullable().optional().describe('Faction id in `court.factions`, or null for non-partisan.'),
  loyalty: z.number().int().min(0).max(100).optional().describe('True allegiance to the ruler, 0 to 100.'),
  influence: z.number().int().min(0).max(100).optional().describe('Court clout, 0 to 100.'),
  governance: z.number().int().min(0).max(100).optional().describe('Civil administration skill, 0 to 100.'),
  military: z.number().int().min(0).max(100).optional().describe('Military strategy skill, 0 to 100.'),
  intrigue: z.number().int().min(0).max(100).optional().describe('Political scheming skill, 0 to 100.'),
  assignment: z.string().optional().describe('Current duty or commission.'),
  remove: z.boolean().optional().describe('True when dismissed from office.'),
});

const memorialEntry = z.strictObject({
  id,
  author_id: id.nullable().optional().describe('Character id of the petitioner, if in the cast.'),
  author_name: z.string().optional().describe('Display name when outside the cast, or mirrored automatically.'),
  title: z.string().optional().describe('Memorial title ("《请开海禁疏》"). Required when creating.'),
  summary: z.string().optional().describe('Core report and situation described in the memorial.'),
  proposal: z.string().optional().describe('What course of action the petitioner asks for.'),
  urgency: z.enum(MEMORIAL_URGENCIES).optional().describe('routine, urgent, or secret. Defaults to routine.'),
  status: z
    .enum(MEMORIAL_STATUSES)
    .optional()
    .describe('pending, approved, rejected, or shelved. Defaults to pending.'),
  ruling: z.string().optional().describe('The ruler\'s rescript ("朱批") once decided.'),
  remove: z.boolean().optional(),
});

const edictEntry = z.strictObject({
  id,
  title: z.string().optional().describe('Name of the edict or state policy ("摊丁入亩诏"). Required when creating.'),
  description: z.string().optional(),
  effect: z.string().optional().describe('Ongoing effect on the realm while active.'),
  active: z.boolean().optional().describe('Defaults to true; set false when repealed.'),
  remove: z.boolean().optional(),
});

const courtSection = z
  .strictObject({
    regime_name: z.string().optional().describe('Name of the court or regime ("大乾朝廷", "帝国枢密院").'),
    ruler_title: z.string().optional().describe('How the player ruler is styled ("皇帝", "摄政王", "女皇").'),
    metrics: z.array(metricEntry).max(12).optional().describe('Realm indicators: treasury, grain, stability, military readiness.'),
    factions: z.array(factionEntry).max(12).optional().describe('Court cliques, blocs, and power groups.'),
    officials: z
      .array(officialEntry)
      .max(30)
      .optional()
      .describe('Registered ministers and officials on the court roll.'),
    memorials: z
      .array(memorialEntry)
      .max(20)
      .optional()
      .describe('Memorials and petitions submitted to the throne or ruled upon.'),
    edicts: z.array(edictEntry).max(16).optional().describe('Imperial edicts and standing decrees.'),
  })
  .describe('Court & Ministers: registered officials, factions, memorials, active edicts, and realm metrics.');

function upsertMetric(state: CourtState, entry: z.infer<typeof metricEntry>): WorldEvent[] {
  const idx = state.metrics.findIndex((m) => m.id === entry.id);
  const existing = idx >= 0 ? state.metrics[idx] : undefined;
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no court metric with id "${entry.id}".`);
    state.metrics.splice(idx, 1);
    return [];
  }
  const name = entry.name?.trim();
  if (!existing && !name) {
    throw new WorldOpError(`Court metric "${entry.id}" does not exist yet. Include "name" to create it.`);
  }
  const metric: CourtMetric = existing ?? {
    id: entry.id,
    name: name ?? '',
    value: 0,
    delta: 0,
  };
  if (existing && name) metric.name = name;
  if (entry.max !== undefined) {
    if (entry.max === null) delete metric.max;
    else metric.max = entry.max;
  }
  const prev = metric.value;
  let next = prev;
  if (entry.value !== undefined) next = entry.value;
  else if (entry.delta !== undefined) next = prev + entry.delta;
  if (metric.max !== undefined) next = clamp(next, 0, metric.max);
  if (existing && next !== prev) metric.delta = next - prev;
  metric.value = next;
  if (!existing) state.metrics.push(metric);
  return [];
}

function upsertFaction(world: WorldState, state: CourtState, entry: z.infer<typeof factionEntry>): WorldEvent[] {
  const existing = state.factions[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no court faction with id "${entry.id}".`);
    delete state.factions[entry.id];
    for (const off of Object.values(state.officials)) {
      if (off.factionId === entry.id) off.factionId = null;
    }
    return [];
  }
  const name = entry.name?.trim();
  if (!existing && !name) {
    throw new WorldOpError(`Court faction "${entry.id}" does not exist yet. Include "name" to create it.`);
  }
  if (entry.leader_id && !world.characters[entry.leader_id]) {
    throw new WorldOpError(`Character "${entry.leader_id}" does not exist.`);
  }
  const faction: CourtFaction = existing ?? {
    id: entry.id,
    name: name ?? '',
    description: '',
    leaderId: null,
    influence: 30,
    stance: '',
  };
  if (existing && name) faction.name = name;
  if (entry.description !== undefined) faction.description = entry.description;
  if (entry.leader_id !== undefined) faction.leaderId = entry.leader_id;
  if (entry.influence !== undefined) faction.influence = clamp(entry.influence, 0, 100);
  if (entry.stance !== undefined) faction.stance = entry.stance.trim();
  state.factions[faction.id] = faction;
  return [];
}

function upsertOfficial(world: WorldState, state: CourtState, entry: z.infer<typeof officialEntry>): WorldEvent[] {
  const character = world.characters[entry.character_id];
  if (!character) {
    throw new WorldOpError(
      `Character "${entry.character_id}" does not exist. Create them in record.characters too.`,
    );
  }
  if (character.isPlayer) {
    throw new WorldOpError('The player ruler cannot be registered as a subordinate court official.');
  }
  const existing = state.officials[entry.character_id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`"${character.name}" is not on the court roll.`);
    delete state.officials[entry.character_id];
    return [];
  }
  const office = entry.office?.trim();
  if (!existing && !office) {
    throw new WorldOpError(`Official "${entry.character_id}" needs an "office" title when registered.`);
  }
  if (entry.faction_id && !state.factions[entry.faction_id]) {
    throw new WorldOpError(`Court faction "${entry.faction_id}" does not exist. Create it in court.factions.`);
  }

  const prevOffice = existing?.office ?? '';
  const official: CourtOfficial = existing ?? {
    characterId: entry.character_id,
    office: office ?? '',
    department: '',
    rank: '',
    factionId: null,
    loyalty: 60,
    influence: 40,
    governance: 60,
    military: 50,
    intrigue: 50,
    assignment: '',
  };
  if (office) official.office = office;
  if (entry.department !== undefined) official.department = entry.department.trim();
  if (entry.rank !== undefined) official.rank = entry.rank.trim();
  if (entry.faction_id !== undefined) official.factionId = entry.faction_id;
  if (entry.loyalty !== undefined) official.loyalty = clamp(entry.loyalty, 0, 100);
  if (entry.influence !== undefined) official.influence = clamp(entry.influence, 0, 100);
  if (entry.governance !== undefined) official.governance = clamp(entry.governance, 0, 100);
  if (entry.military !== undefined) official.military = clamp(entry.military, 0, 100);
  if (entry.intrigue !== undefined) official.intrigue = clamp(entry.intrigue, 0, 100);
  if (entry.assignment !== undefined) official.assignment = entry.assignment.trim();

  state.officials[official.characterId] = official;

  if (!existing || official.office !== prevOffice) {
    return [
      {
        type: 'official_appointed',
        characterId: character.id,
        characterName: character.name,
        office: official.office,
        department: official.department,
        rank: official.rank,
      },
    ];
  }
  return [];
}

function upsertMemorial(world: WorldState, state: CourtState, entry: z.infer<typeof memorialEntry>): WorldEvent[] {
  const existing = state.memorials[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no memorial with id "${entry.id}".`);
    delete state.memorials[entry.id];
    return [];
  }
  const title = entry.title?.trim();
  if (!existing && !title) {
    throw new WorldOpError(`Memorial "${entry.id}" does not exist yet. Include "title" to create it.`);
  }
  if (entry.author_id && !world.characters[entry.author_id]) {
    throw new WorldOpError(`Character "${entry.author_id}" does not exist.`);
  }

  const prevStatus = existing?.status;
  const authorId = entry.author_id !== undefined ? entry.author_id : (existing?.authorId ?? null);
  const castName = authorId ? world.characters[authorId]?.name : undefined;
  const memorial: CourtMemorial = existing ?? {
    id: entry.id,
    authorId,
    authorName: entry.author_name?.trim() || castName || '',
    title: title ?? '',
    summary: '',
    proposal: '',
    urgency: entry.urgency ?? 'routine',
    status: entry.status ?? 'pending',
    ruling: '',
    turn: world.turn,
  };
  memorial.authorId = authorId;
  if (entry.author_name !== undefined) memorial.authorName = entry.author_name.trim();
  else if (castName) memorial.authorName = castName;
  if (existing && title) memorial.title = title;
  if (entry.summary !== undefined) memorial.summary = entry.summary;
  if (entry.proposal !== undefined) memorial.proposal = entry.proposal;
  if (entry.urgency !== undefined) memorial.urgency = entry.urgency;
  if (entry.status !== undefined) memorial.status = entry.status;
  if (entry.ruling !== undefined) memorial.ruling = entry.ruling;

  state.memorials[memorial.id] = memorial;

  if (!existing && memorial.status === 'pending') {
    return [
      {
        type: 'memorial_submitted',
        id: memorial.id,
        title: memorial.title,
        authorName: memorial.authorName,
        urgency: memorial.urgency,
      },
    ];
  }
  if (memorial.status !== 'pending' && prevStatus !== memorial.status) {
    return [
      {
        type: 'memorial_ruled',
        id: memorial.id,
        title: memorial.title,
        status: memorial.status,
        ruling: memorial.ruling,
      },
    ];
  }
  return [];
}

function upsertEdict(world: WorldState, state: CourtState, entry: z.infer<typeof edictEntry>): WorldEvent[] {
  const existing = state.edicts[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no edict with id "${entry.id}".`);
    delete state.edicts[entry.id];
    return [];
  }
  const title = entry.title?.trim();
  if (!existing && !title) {
    throw new WorldOpError(`Edict "${entry.id}" does not exist yet. Include "title" to create it.`);
  }
  const wasActive = existing?.active ?? false;
  const edict: CourtEdict = existing ?? {
    id: entry.id,
    title: title ?? '',
    description: '',
    effect: '',
    active: entry.active ?? true,
    turnIssued: world.turn,
  };
  if (existing && title) edict.title = title;
  if (entry.description !== undefined) edict.description = entry.description;
  if (entry.effect !== undefined) edict.effect = entry.effect;
  if (entry.active !== undefined) edict.active = entry.active;
  state.edicts[edict.id] = edict;

  if (edict.active && !wasActive) {
    return [{ type: 'edict_issued', id: edict.id, title: edict.title, effect: edict.effect }];
  }
  return [];
}

function applyCourt(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'court', errors);
  if (!parts) return [];

  const state = ensureCourt(world);
  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'court.', errors, events);
  reader.rejectUnknown(
    ['regime_name', 'ruler_title', 'metrics', 'factions', 'officials', 'memorials', 'edicts'],
    'court field',
  );
  reader.one('regime_name', z.string(), (value) => {
    state.regimeName = value.trim();
    return [];
  });
  reader.one('ruler_title', z.string(), (value) => {
    state.rulerTitle = value.trim();
    return [];
  });
  reader.each('metrics', metricEntry, (entry) => upsertMetric(state, entry));
  reader.each('factions', factionEntry, (entry) => upsertFaction(world, state, entry));
  reader.each('officials', officialEntry, (entry) => upsertOfficial(world, state, entry));
  reader.each('memorials', memorialEntry, (entry) => upsertMemorial(world, state, entry));
  reader.each('edicts', edictEntry, (entry) => upsertEdict(world, state, entry));
  return events;
}

/**
 * Public court context and an official's own post. Other officials' hidden
 * disloyalty and secret memorials are never revealed to an NPC.
 */
function courtStandingView(world: WorldState, characterId: string): unknown {
  const state = world.modules.court;
  if (!state) return undefined;
  const own = state.officials[characterId];
  const hasPublic =
    Object.keys(state.officials).length > 0 ||
    Object.keys(state.edicts).length > 0 ||
    state.metrics.length > 0;
  if (!own && !hasPublic) return undefined;

  return {
    regime: state.regimeName,
    ruler_title: state.rulerTitle,
    metrics: state.metrics.map((m) => ({ name: m.name, value: m.value, ...(m.max !== undefined ? { max: m.max } : {}) })),
    factions: Object.values(state.factions).map((f) => ({
      name: f.name,
      leader: f.leaderId ? (world.characters[f.leaderId]?.name ?? null) : null,
      influence: f.influence,
      stance: f.stance,
    })),
    active_edicts: Object.values(state.edicts)
      .filter((e) => e.active)
      .map((e) => ({ title: e.title, effect: e.effect })),
    ...(own
      ? {
          your_office: {
            office: own.office,
            department: own.department,
            rank: own.rank,
            faction: own.factionId ? (state.factions[own.factionId]?.name ?? null) : null,
            influence: own.influence,
            assignment: own.assignment,
          },
          memorials_known_to_you: Object.values(state.memorials)
            .filter((m) => m.authorId === characterId || m.urgency !== 'secret')
            .slice(-8)
            .map((m) => ({
              title: m.title,
              author: m.authorName,
              status: m.status,
              ...(m.ruling ? { ruling: m.ruling } : {}),
            })),
        }
      : {}),
  };
}

const en = `## Court and ministers

You have an imperial/council court roster under record.court and the hold_court tool for stories of sovereignty, statecraft, dynastic politics, and factional intrigue.

Every minister or official on the roll must also exist in record.characters (with their concrete appearance, voice, goals, and secrets) and be registered in record.court.officials with their office, department, rank, faction_id, loyalty (0–100), influence (0–100), capabilities (governance, military, intrigue), and current assignment. Track realm indicators in record.court.metrics (e.g. Treasury, Grain, Popular Support, Border Readiness, Imperial Authority), court blocs in factions, petitions awaiting the ruler's rescript in memorials (pending -> approved, rejected, or shelved with ruling), and promulgated decrees in edicts.

When the ruler pushes a contested decree, reform, or state campaign through council or delegates execution to a minister, call hold_court before narrating the outcome. Pass the lead_official_id, domain, any opposing_faction_id, and intended metric_changes; the server rolls a d20 modified by the minister's skill and loyalty against court opposition, adjusts factional influence and realm metrics, and returns smooth, compromise, deadlock, or backlash.`;

const zh = `## 朝堂与百官

你在 record.court 下拥有百官官籍与中枢政务面板，并配有 hold_court 工具，适用于皇帝模拟、王朝治世、内阁党争与权谋执政类故事。

凡记录在案的臣子，都应先在 record.characters 中创建人物（写明具体的外貌特征 appearance、说话口吻 voice、抱负 goals 与隐秘 secrets），再登记到 record.court.officials，标明官职（office，如“内阁首辅”“兵部尚书”）、衙署（department）、品级（rank）、所属党派（faction_id）、忠诚（loyalty 0–100）、权势（influence 0–100）、三围能力（治政 governance、军略 military、权术 intrigue）与当前差遣（assignment）。用 metrics 记录国库、粮储、民心、军备、皇权等社稷指标，用 factions 记录朝堂朋党，用 memorials 提交待朱批的奏折或密折（玩家批阅后将 status 更新为 approved、rejected 或 shelved 并写明 ruling 朱批），用 edicts 记录现行诏令与国策。

当君主推行变法诏令、廷议军国大事或委派大臣督办政务时，先调用 hold_court 传入主理大臣（lead_official_id）、检定维度（domain）、阻挠党派（opposing_faction_id）及预期国力变化（metric_changes），再叙述廷议与施政经过。服务端会结合大臣能力、忠心与党争阻力投掷 d20，自动结算党派势力消长与社稷指标增减（smooth 政令畅行、compromise 折冲妥协、deadlock 廷议僵持、backlash 阳奉阴违/朝野反噬）。`;

export const courtModule: GameModule = {
  id: 'court',
  keptWhenUnused: false,
  hasPanel: true,
  tools: [
    {
      tool: holdCourtTool,
      spec: {
        name: HOLD_COURT,
        description:
          'Convene court or execute a state policy through a minister against factional opposition. Rolls a d20 modified by capability and loyalty, adjusts faction clout and realm metrics, and returns smooth, compromise, deadlock, or backlash. Call before narrating the result.',
        inputSchema: toJsonSchema(holdCourtInput),
      },
    },
  ],
  record: { schema: courtSection, apply: applyCourt },
  guide: { en, zh },
  shownToCharacter: { tag: 'court_standing', of: courtStandingView },
};
