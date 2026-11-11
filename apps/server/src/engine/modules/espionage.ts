import {
  CHECK_DIFFICULTIES,
  ESPIONAGE_OPERATIONS,
  SPY_STATUSES,
  type CheckDifficulty,
  type EspionageOperation,
  type EspionageState,
  type IntelDossier,
  type OperationOutcome,
  type SpyAgent,
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
 * Espionage & Secret Police: covert networks ("锦衣卫", "皇城司", shadow operatives),
 * agents planted on ministers/factions/locations with infiltration depth and
 * exposure heat, secret blackmail/leverage dossiers, and server-resolved covert ops.
 *
 * Intentionally omitted from `shownToCharacter`: targets never learn they are
 * being watched or what dossiers the player holds unless someone tells them in play.
 */

export const RUN_OPERATION = 'run_operation';

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const die100 = (random: () => number) => Math.floor(random() * 100) + 1;

const OP_MODIFIER: Record<EspionageOperation, number> = {
  recon: 15,
  infiltrate: 10,
  wiretap: 5,
  raid: -5,
  frame: -10,
  subvert: -10,
};

const DIFF_MODIFIER: Record<CheckDifficulty, number> = {
  easy: 15,
  normal: 0,
  hard: -15,
  extreme: -30,
};

const OUTCOME_MEANING: Record<OperationOutcome, string> = {
  triumph: 'Flawless tradecraft: objective achieved cleanly, deeper penetration gained, and tracks covered.',
  success: 'Operation succeeds: intelligence, leverage, or objective secured without blowing cover.',
  partial: 'Messy execution: objective partially met, but suspicion rises around the operative (+2 exposure).',
  blown: 'Cover rattled or trap sprung: the operation fails, exposure spikes (+4), and the target is put on guard.',
};

function ensureEspionage(world: WorldState): EspionageState {
  return (world.modules.espionage ??= {
    agencyName: '',
    commanderId: null,
    networkPower: 50,
    agents: {},
    dossiers: {},
  });
}

// --- run_operation tool -------------------------------------------------------

const runOperationInput = z.strictObject({
  agent_id: id.describe('Agent id in `world.modules.espionage.agents`.'),
  operation: z
    .enum(ESPIONAGE_OPERATIONS)
    .describe('recon (gather facts), infiltrate (deepen cover), wiretap (intercept secrets), frame (plant evidence), subvert (turn loyalty/sabotage), or raid (arrest/seize).'),
  difficulty: z.enum(CHECK_DIFFICULTIES).optional().describe('easy, normal, hard, or extreme. Defaults to normal.'),
  reason: z.string().min(1).describe('Short description of the specific target and objective.'),
});

const runOperationTool: GameTool = {
  name: RUN_OPERATION,
  silent: false,
  records: true,
  endsTurn: false,
  run(world: WorldState, raw: unknown, ctx: ToolContext) {
    const parsed = runOperationInput.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error, raw);
    const input = parsed.data;

    try {
      const state = ensureEspionage(world);
      const agent = state.agents[input.agent_id];
      if (!agent) {
        throw new WorldOpError(`There is no spy agent with id "${input.agent_id}".`);
      }
      if (agent.status === 'compromised') {
        throw new WorldOpError(
          `Agent "${agent.codename}" is already compromised (burned). Recall or extract them before running new ops.`,
        );
      }
      if (agent.status === 'recalled') {
        throw new WorldOpError(`Agent "${agent.codename}" has been recalled. Redeploy them first.`);
      }

      const difficulty: CheckDifficulty = input.difficulty ?? 'normal';
      const op = input.operation;
      const base =
        45 +
        Math.round(state.networkPower * 0.25) +
        Math.round(agent.infiltration * 0.3) -
        agent.exposure * 3 +
        OP_MODIFIER[op] +
        DIFF_MODIFIER[difficulty];
      const chance = clamp(base, 10, 95);
      const roll = die100(ctx.random);

      let outcome: OperationOutcome;
      if (roll <= Math.max(8, Math.floor(chance / 4))) outcome = 'triumph';
      else if (roll <= chance) outcome = 'success';
      else if (roll <= Math.min(95, chance + 20)) outcome = 'partial';
      else outcome = 'blown';

      if (outcome === 'triumph') {
        agent.infiltration = clamp(agent.infiltration + (op === 'infiltrate' ? 30 : 18), 0, 100);
        agent.exposure = clamp(agent.exposure - 1, 0, 10);
      } else if (outcome === 'success') {
        agent.infiltration = clamp(agent.infiltration + (op === 'infiltrate' ? 20 : 10), 0, 100);
        if (op === 'raid' || op === 'frame') agent.exposure = clamp(agent.exposure + 1, 0, 10);
      } else if (outcome === 'partial') {
        agent.infiltration = clamp(agent.infiltration + 5, 0, 100);
        agent.exposure = clamp(agent.exposure + 2, 0, 10);
      } else {
        agent.infiltration = clamp(agent.infiltration - 10, 0, 100);
        agent.exposure = clamp(agent.exposure + 4, 0, 10);
      }

      const compromised = agent.exposure >= 10;
      if (compromised) agent.status = 'compromised';

      const event: WorldEvent = {
        type: 'espionage_operation',
        agentId: agent.id,
        codename: agent.codename,
        operation: op,
        targetName: agent.targetName,
        roll,
        chance,
        outcome,
        infiltration: agent.infiltration,
        exposure: agent.exposure,
        compromised,
        reason: input.reason.trim(),
      };

      return {
        content: JSON.stringify({
          agent: agent.codename,
          operation: op,
          target: agent.targetName,
          roll,
          chance,
          outcome,
          infiltration: agent.infiltration,
          exposure: agent.exposure,
          compromised,
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

// --- record.espionage ---------------------------------------------------------

const agentEntry = z.strictObject({
  id,
  character_id: id.nullable().optional().describe('Character id when the operative is a named cast NPC, or null.'),
  codename: z.string().optional().describe('Operative codename or name ("青鸾", "夜枭"). Required when creating.'),
  cover: z.string().optional().describe('Cover identity ("礼部书办", "江南盐引商").'),
  target_id: id.nullable().optional().describe('Target characterId, factionId, or locationId.'),
  target_name: z.string().optional().describe('Display name of the person, faction, or place watched.'),
  infiltration: z.number().int().min(0).max(100).optional().describe('Penetration depth, 0 to 100.'),
  exposure: z.number().int().min(0).max(10).optional().describe('Suspicion heat, 0 to 10.'),
  status: z.enum(SPY_STATUSES).optional().describe('active, compromised, or recalled.'),
  remove: z.boolean().optional(),
});

const dossierEntry = z.strictObject({
  id,
  subject_id: id.nullable().optional().describe('Character id this intelligence or blackmail concerns.'),
  subject_name: z.string().optional().describe('Subject display name.'),
  title: z.string().optional().describe('Dossier title ("《户部亏空密账》"). Required when creating.'),
  summary: z.string().optional().describe('Intelligence findings.'),
  leverage: z.string().optional().describe('Actionable proof or blackmail leverage held by the player.'),
  verified: z.boolean().optional().describe('Whether corroborated by hard proof; defaults to true.'),
  hidden: z.boolean().optional().describe('True while kept as an unrevealed GM secret; false once in the player\'s hands.'),
  remove: z.boolean().optional(),
});

const espionageSection = z
  .strictObject({
    agency_name: z.string().optional().describe('Name of the secret service ("锦衣卫北镇抚司", "皇城司", "黑冰台").'),
    commander_id: id.nullable().optional().describe('Character id of the spymaster/commander, or null.'),
    network_power: z.number().int().min(0).max(100).optional().describe('Overall agency reach and readiness, 0 to 100.'),
    agents: z.array(agentEntry).max(24).optional().describe('Planted spies, informants, and field operatives.'),
    dossiers: z.array(dossierEntry).max(24).optional().describe('Secret intelligence files and blackmail leverage.'),
  })
  .describe('Espionage & Secret Police: covert agents, infiltration, exposure heat, and secret dossiers.');

function upsertAgent(world: WorldState, state: EspionageState, entry: z.infer<typeof agentEntry>): WorldEvent[] {
  const existing = state.agents[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no spy agent with id "${entry.id}".`);
    delete state.agents[entry.id];
    return [];
  }
  if (entry.character_id && !world.characters[entry.character_id]) {
    throw new WorldOpError(`Character "${entry.character_id}" does not exist.`);
  }
  const codename = entry.codename?.trim() || (entry.character_id ? world.characters[entry.character_id]?.name : undefined);
  if (!existing && !codename) {
    throw new WorldOpError(`Spy agent "${entry.id}" needs "codename" when created.`);
  }

  const targetNameFromId = entry.target_id
    ? (world.characters[entry.target_id]?.name ??
      world.locations[entry.target_id]?.name ??
      world.modules.court?.factions[entry.target_id]?.name)
    : undefined;

  const agent: SpyAgent = existing ?? {
    id: entry.id,
    characterId: entry.character_id ?? null,
    codename: codename ?? '',
    cover: '',
    targetId: entry.target_id ?? null,
    targetName: entry.target_name?.trim() || targetNameFromId || '',
    infiltration: entry.infiltration ?? 25,
    exposure: entry.exposure ?? 0,
    status: entry.status ?? 'active',
  };
  if (entry.character_id !== undefined) agent.characterId = entry.character_id;
  if (codename) agent.codename = codename;
  if (entry.cover !== undefined) agent.cover = entry.cover.trim();
  if (entry.target_id !== undefined) agent.targetId = entry.target_id;
  if (entry.target_name !== undefined) agent.targetName = entry.target_name.trim();
  else if (targetNameFromId && !agent.targetName) agent.targetName = targetNameFromId;
  if (entry.infiltration !== undefined) agent.infiltration = clamp(entry.infiltration, 0, 100);
  if (entry.exposure !== undefined) agent.exposure = clamp(entry.exposure, 0, 10);
  if (entry.status !== undefined) agent.status = entry.status;
  if (agent.exposure >= 10) agent.status = 'compromised';

  state.agents[agent.id] = agent;

  if (!existing) {
    return [
      {
        type: 'spy_deployed',
        id: agent.id,
        codename: agent.codename,
        targetName: agent.targetName,
        cover: agent.cover,
      },
    ];
  }
  return [];
}

function upsertDossier(world: WorldState, state: EspionageState, entry: z.infer<typeof dossierEntry>): WorldEvent[] {
  const existing = state.dossiers[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no dossier with id "${entry.id}".`);
    delete state.dossiers[entry.id];
    return [];
  }
  const title = entry.title?.trim();
  if (!existing && !title) {
    throw new WorldOpError(`Dossier "${entry.id}" needs "title" when created.`);
  }
  if (entry.subject_id && !world.characters[entry.subject_id]) {
    throw new WorldOpError(`Subject character "${entry.subject_id}" does not exist.`);
  }

  const wasHidden = existing ? existing.hidden : true;
  const subjectId = entry.subject_id !== undefined ? entry.subject_id : (existing?.subjectId ?? null);
  const castName = subjectId ? world.characters[subjectId]?.name : undefined;

  const dossier: IntelDossier = existing ?? {
    id: entry.id,
    subjectId,
    subjectName: entry.subject_name?.trim() || castName || '',
    title: title ?? '',
    summary: '',
    leverage: '',
    verified: entry.verified ?? true,
    hidden: entry.hidden ?? false,
  };
  dossier.subjectId = subjectId;
  if (entry.subject_name !== undefined) dossier.subjectName = entry.subject_name.trim();
  else if (castName) dossier.subjectName = castName;
  if (existing && title) dossier.title = title;
  if (entry.summary !== undefined) dossier.summary = entry.summary;
  if (entry.leverage !== undefined) dossier.leverage = entry.leverage;
  if (entry.verified !== undefined) dossier.verified = entry.verified;
  if (entry.hidden !== undefined) dossier.hidden = entry.hidden;

  state.dossiers[dossier.id] = dossier;

  if (!dossier.hidden && wasHidden) {
    return [
      {
        type: 'dossier_acquired',
        id: dossier.id,
        title: dossier.title,
        subjectName: dossier.subjectName,
        verified: dossier.verified,
      },
    ];
  }
  return [];
}

function applyEspionage(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'espionage', errors);
  if (!parts) return [];

  const state = ensureEspionage(world);
  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'espionage.', errors, events);
  reader.rejectUnknown(['agency_name', 'commander_id', 'network_power', 'agents', 'dossiers'], 'espionage field');
  reader.one('agency_name', z.string(), (value) => {
    state.agencyName = value.trim();
    return [];
  });
  reader.one('commander_id', id.nullable(), (value) => {
    if (value && !world.characters[value]) throw new WorldOpError(`Character "${value}" does not exist.`);
    state.commanderId = value;
    return [];
  });
  reader.one('network_power', z.number().int().min(0).max(100), (value) => {
    state.networkPower = value;
    return [];
  });
  reader.each('agents', agentEntry, (entry) => upsertAgent(world, state, entry));
  reader.each('dossiers', dossierEntry, (entry) => upsertDossier(world, state, entry));
  return events;
}

const en = `## Espionage and secret police

You have an intelligence network under record.espionage and the run_operation tool for stories of secret police, shadow operatives, surveillance on courtiers or rivals, blackmail, and covert raids.

Name the agency (agency_name), optional spymaster commander_id, and network_power (0–100). Deploy operatives in record.espionage.agents with codename, cover, target_id/target_name, infiltration (0–100), and exposure (0–10; at 10 the agent is compromised). Record uncovered secrets and blackmail proofs in record.espionage.dossiers (use hidden: true for unrevealed plots until spies uncover them).

When an operative conducts recon, infiltrates deeper, wiretaps correspondence, frames a target, subverts an enemy, or launches a secret raid/arrest, call run_operation before narrating. The server rolls a d100 against network power, infiltration, and exposure, updates infiltration and exposure, and returns triumph, success, partial, or blown. Record any newly seized proof under dossiers.`;

const zh = `## 锦衣密探与情报网

你在 record.espionage 下拥有秘密情报机构面板，并配有 run_operation 工具，用于统领锦衣卫、皇城司、东厂暗桩或江湖密探，监视百官藩王、刺探阴谋、搜集把柄与诏狱查抄。

在 record.espionage 中设定机构名号（agency_name，如“锦衣卫北镇抚司”）、掌印统领（commander_id）与情报网掌控力（network_power 0–100）。在 agents 中部署暗桩密探，记录代号（codename）、伪装身份（cover）、监视目标（target_id/target_name）、渗透度（infiltration 0–100）与暴露风险（exposure 0–10，满 10 则身份暴露 compromised）。在 dossiers 中归档掌握的黑料铁证与把柄（尚未查获的暗线可先设 hidden: true，查实后设为 false）。

当派遣密探执行刺探（recon）、潜伏渗透（infiltrate）、截获密信（wiretap）、罗织构陷（frame）、策反离间（subvert）或诏狱查抄（raid）时，先调用 run_operation 再叙述结果。服务端会按掌控力与渗透度投掷 d100 结算成败与暴露风险；查获新罪证或把柄时记得写入 dossiers。`;

const setAgentStatusOpSchema = z.strictObject({
  agent_id: id,
  status: z.enum(['active', 'recalled']),
  target_id: id.nullable().optional(),
  target_name: z.string().optional(),
  cover: z.string().optional(),
});

function operateEspionage(
  world: WorldState,
  op: string,
  params: Record<string, unknown>,
): { events: WorldEvent[]; summary: string } {
  const state = ensureEspionage(world);

  if (op === 'set_agent_status') {
    const parsed = setAgentStatusOpSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const existing = state.agents[parsed.data.agent_id];
    if (!existing) throw new WorldOpError(`There is no spy agent with id "${parsed.data.agent_id}".`);

    // Extracting or rotating an agent cools off part of their exposure heat so they aren't permanently stuck at 10.
    const nextExposure =
      parsed.data.status === 'recalled'
        ? Math.max(0, existing.exposure - 3)
        : existing.exposure >= 10
          ? 6
          : existing.exposure;

    const events = upsertAgent(world, state, {
      id: parsed.data.agent_id,
      status: parsed.data.status,
      exposure: nextExposure,
      ...(parsed.data.target_id !== undefined ? { target_id: parsed.data.target_id } : {}),
      ...(parsed.data.target_name !== undefined ? { target_name: parsed.data.target_name } : {}),
      ...(parsed.data.cover !== undefined ? { cover: parsed.data.cover } : {}),
    });
    const label = parsed.data.status === 'recalled' ? '密令撤回休整' : '重新潜伏外派';
    return { events, summary: `密探【${existing.codename}】${label}` };
  }

  throw new WorldOpError(`Unknown espionage operation "${op}".`);
}

export const espionageModule: GameModule = {
  id: 'espionage',
  keptWhenUnused: false,
  hasPanel: true,
  tools: [
    {
      tool: runOperationTool,
      spec: {
        name: RUN_OPERATION,
        description:
          'Execute a covert intelligence operation (recon, infiltrate, wiretap, frame, subvert, or raid) with a deployed spy agent. Rolls a d100 against infiltration and network power, updates infiltration and exposure heat, and returns triumph, success, partial, or blown.',
        inputSchema: toJsonSchema(runOperationInput),
      },
    },
  ],
  record: { schema: espionageSection, apply: applyEspionage },
  guide: { en, zh },
  operate: operateEspionage,
};
