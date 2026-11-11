import type {
  BreakthroughOutcome,
  ProgressionAbility,
  ProgressionState,
  WorldEvent,
  WorldState,
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
 * Progression & Cultivation: major/minor realms or class tiers, ordered realm
 * ladder, cultivation/XP gauge, bottleneck requirements, qi-deviation/strain
 * risk, learned techniques/abilities, and server-rolled realm breakthroughs.
 */

export const BREAKTHROUGH = 'breakthrough';

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const die100 = (random: () => number) => Math.floor(random() * 100) + 1;

function ensureProgression(world: WorldState): ProgressionState {
  return (world.modules.progression ??= {
    systemName: '',
    realm: '',
    subRealm: '',
    ladder: [],
    xp: 0,
    xpMax: 100,
    bottleneck: '',
    deviation: 0,
    abilities: {},
  });
}

const OUTCOME_MEANING: Record<BreakthroughOutcome, string> = {
  transcendent:
    'Flawless breakthrough! The player ascends cleanly into the new realm with surplus foundation and cleansed inner strain.',
  success:
    'Breakthrough achieved! The bottleneck shatters and the player enters the new realm.',
  stalled:
    'The attempt falls short of shattering the barrier; part of accumulated progress is spent and inner strain rises slightly.',
  backlash:
    'Tribulation or qi-deviation backlash! The breakthrough fails violently, costing accumulated progress and spiking inner deviation.',
};

// --- breakthrough tool --------------------------------------------------------

const breakthroughInput = z.strictObject({
  target_realm: z.string().min(1).describe('Major realm or tier being attempted ("筑基期", "金丹期", "四品宗师").'),
  target_sub_realm: z.string().optional().describe('Sub-stage after advancing ("初期", "一层", "圆满").'),
  catalyst_bonus: z
    .number()
    .int()
    .min(-30)
    .max(50)
    .optional()
    .describe('Modifier (-30 to +50) from spirit pills, formations, enlightenment, or hostile environment.'),
  next_xp_max: z
    .number()
    .int()
    .min(10)
    .max(1_000_000)
    .optional()
    .describe('New XP cap after advancing; defaults to 1.5x current cap on a new major realm.'),
  reason: z.string().min(1).describe('What triggers or supports this breakthrough attempt.'),
});

const breakthroughTool: GameTool = {
  name: BREAKTHROUGH,
  silent: false,
  records: true,
  endsTurn: false,
  run(world: WorldState, raw: unknown, ctx: ToolContext) {
    const parsed = breakthroughInput.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error, raw);
    const input = parsed.data;

    const state = ensureProgression(world);
    const prevMajor = state.realm;
    const fromLabel = [state.realm, state.subRealm].filter(Boolean).join(' · ') || '—';
    const targetMajor = input.target_realm.trim();
    const targetSub = input.target_sub_realm?.trim() ?? '';
    const toLabel = [targetMajor, targetSub].filter(Boolean).join(' · ');

    const ratio = state.xpMax > 0 ? Math.min(1.2, state.xp / state.xpMax) : 1;
    const baseChance =
      Math.round(ratio * 70) -
      Math.round(state.deviation * 0.45) +
      (input.catalyst_bonus ?? 0);
    const chance = clamp(baseChance, 5, 95);
    const roll = die100(ctx.random);

    let outcome: BreakthroughOutcome;
    if (roll <= Math.max(5, Math.floor(chance / 5))) outcome = 'transcendent';
    else if (roll <= chance) outcome = 'success';
    else if (roll <= Math.min(96, chance + 22)) outcome = 'stalled';
    else outcome = 'backlash';

    if (outcome === 'transcendent' || outcome === 'success') {
      const sameMajor = targetMajor === prevMajor;
      const nextCap =
        input.next_xp_max ??
        (sameMajor ? state.xpMax : Math.max(100, Math.round(state.xpMax * 1.5)));
      const carry = outcome === 'transcendent' ? Math.round(state.xpMax * 0.15) : 0;
      state.realm = targetMajor;
      state.subRealm = targetSub;
      state.xpMax = nextCap;
      state.xp = clamp(carry, 0, nextCap);
      state.bottleneck = '';
      state.deviation = clamp(state.deviation - (outcome === 'transcendent' ? 25 : 10), 0, 100);
      if (state.ladder.length > 0 && !state.ladder.includes(targetMajor)) {
        state.ladder.push(targetMajor);
      }
    } else if (outcome === 'stalled') {
      state.xp = Math.max(0, state.xp - Math.round(state.xp * 0.25));
      state.deviation = clamp(state.deviation + 10, 0, 100);
    } else {
      state.xp = Math.max(0, state.xp - Math.round(state.xp * 0.5));
      state.deviation = clamp(state.deviation + 25, 0, 100);
    }

    const finalRealm = [state.realm, state.subRealm].filter(Boolean).join(' · ') || toLabel;
    const event: WorldEvent = {
      type: 'realm_breakthrough',
      fromRealm: fromLabel,
      toRealm: outcome === 'transcendent' || outcome === 'success' ? toLabel : fromLabel,
      roll,
      chance,
      outcome,
      deviation: state.deviation,
      reason: input.reason.trim(),
    };

    return {
      content: JSON.stringify({
        from_realm: fromLabel,
        attempted_realm: toLabel,
        current_realm: finalRealm,
        roll,
        chance,
        outcome,
        xp: state.xp,
        xp_max: state.xpMax,
        deviation: state.deviation,
        means: OUTCOME_MEANING[outcome],
      }),
      isError: false,
      events: [event],
    };
  },
};

// --- record.progression -------------------------------------------------------

const abilityEntry = z.strictObject({
  id,
  name: z.string().optional().describe('Technique, art, or skill name ("太上感应篇", "青莲剑歌"). Required when creating.'),
  category: z.string().optional().describe('Category ("心法", "神通", "剑诀", "帝王术", "专长").'),
  rank: z.string().optional().describe('Mastery stage ("初窥", "小成", "大成", "圆满", "Lv.3").'),
  equipped: z.boolean().optional().describe('Whether actively equipped/practiced; defaults to true.'),
  cost: z.string().optional().describe('Resource cost or passive note ("消耗20灵力", "常驻心法").'),
  description: z.string().optional(),
  remove: z.boolean().optional(),
});

const progressionSection = z
  .strictObject({
    system_name: z.string().optional().describe('Path name ("修真大道", "武道九品", "帝王心术").'),
    realm: z.string().optional().describe('Current major realm/tier ("炼气期", "筑基期").'),
    sub_realm: z.string().optional().describe('Current minor stage ("初期", "中期", "圆满").'),
    ladder: z
      .array(z.string().min(1))
      .max(16)
      .optional()
      .describe('Ordered list of major realms in this setting, lowest to highest.'),
    xp: z.number().int().min(0).optional().describe('Set current cultivation/XP directly.'),
    xp_delta: z.number().int().optional().describe('Or add/subtract cultivation/XP earned this turn.'),
    xp_max: z.number().int().min(1).optional().describe('XP threshold for the current realm.'),
    bottleneck: z.string().optional().describe('Condition or tribulation needed before breaking through.'),
    deviation: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe('Inner demon / qi deviation / strain risk, 0 to 100.'),
    abilities: z.array(abilityEntry).max(24).optional().describe('Techniques, spells, arts, or class skills.'),
  })
  .describe('Progression & Cultivation: realm ladder, XP gauge, bottleneck, inner deviation, and abilities.');

function upsertAbility(state: ProgressionState, entry: z.infer<typeof abilityEntry>): WorldEvent[] {
  const existing = state.abilities[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is no ability with id "${entry.id}".`);
    delete state.abilities[entry.id];
    return [];
  }
  const name = entry.name?.trim();
  if (!existing && !name) {
    throw new WorldOpError(`Ability "${entry.id}" needs "name" when created.`);
  }
  const ability: ProgressionAbility = existing ?? {
    id: entry.id,
    name: name ?? '',
    category: '',
    rank: '初窥',
    equipped: entry.equipped ?? true,
    cost: '',
    description: '',
  };
  if (existing && name) ability.name = name;
  if (entry.category !== undefined) ability.category = entry.category.trim();
  if (entry.rank !== undefined) ability.rank = entry.rank.trim();
  if (entry.equipped !== undefined) ability.equipped = entry.equipped;
  if (entry.cost !== undefined) ability.cost = entry.cost.trim();
  if (entry.description !== undefined) ability.description = entry.description;

  state.abilities[ability.id] = ability;

  if (!existing) {
    return [
      {
        type: 'ability_learned',
        id: ability.id,
        name: ability.name,
        category: ability.category,
        rank: ability.rank,
      },
    ];
  }
  return [];
}

function applyProgression(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'progression', errors);
  if (!parts) return [];

  const state = ensureProgression(world);
  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'progression.', errors, events);
  reader.rejectUnknown(
    ['system_name', 'realm', 'sub_realm', 'ladder', 'xp', 'xp_delta', 'xp_max', 'bottleneck', 'deviation', 'abilities'],
    'progression field',
  );
  reader.one('system_name', z.string(), (value) => {
    state.systemName = value.trim();
    return [];
  });
  reader.one('realm', z.string(), (value) => {
    state.realm = value.trim();
    return [];
  });
  reader.one('sub_realm', z.string(), (value) => {
    state.subRealm = value.trim();
    return [];
  });
  reader.one('ladder', z.array(z.string().min(1)).max(16), (value) => {
    state.ladder = value.map((item) => item.trim()).filter(Boolean);
    return [];
  });
  reader.one('xp_max', z.number().int().min(1), (value) => {
    state.xpMax = value;
    return [];
  });
  reader.one('xp', z.number().int().min(0), (value) => {
    state.xp = value;
    return [];
  });
  reader.one('xp_delta', z.number().int(), (value) => {
    state.xp = Math.max(0, state.xp + value);
    return [];
  });
  reader.one('bottleneck', z.string(), (value) => {
    state.bottleneck = value.trim();
    return [];
  });
  reader.one('deviation', z.number().int().min(0).max(100), (value) => {
    state.deviation = value;
    return [];
  });
  reader.each('abilities', abilityEntry, (entry) => upsertAbility(state, entry));
  return events;
}

const en = `## Progression and realms

You have a realm/skill progression sheet under record.progression and the breakthrough tool for xianxia cultivation, martial arts ranks, arcane circles, or class advancement.

Set up system_name, ladder (ordered list of major realms), current realm and sub_realm, xp and xp_max, any bottleneck requirement, deviation (0–100 inner demon / qi-deviation / strain risk), and learned techniques or skills in abilities (category, mastery rank, equipped, cost). Grant xp_delta as the player trains, battles, or gains insights.

Never advance a major bottleneck by fiat: when the player attempts to break through to a higher stage or overcome a tribulation, call breakthrough before narrating. The server calculates odds from XP saturation, inner deviation, and any catalyst_bonus (pills, formations, enlightenment), rolls a d100, and returns transcendent, success, stalled, or backlash.`;

const zh = `## 境界功法与晋升体系

你在 record.progression 下拥有境界修为与功法面板，并配有 breakthrough 工具，适用于修仙问道、高武品阶、奥术环位或帝王心术等成长晋升故事。

在开局时设定体系名称（system_name）、境界序列（ladder，如 ["炼气", "筑基", "金丹", "元婴", "化神"]）、当前大境界（realm）与小境界（sub_realm）、修为经验（xp / xp_max）、突破瓶颈条件（bottleneck）、心魔/走火入魔隐患（deviation 0–100），并在 abilities 中记录所修习的心法、神通与武学（标注类别 category、火候 rank、是否主修装备 equipped 与消耗 cost）。日常吐纳、实战顿悟时用 xp_delta 增长修为。

冲击瓶颈或渡劫晋升时，切勿直接口头拍板：先调用 breakthrough 传入目标境界与灵丹/阵法/顿悟加成（catalyst_bonus），再叙述冲关经过。服务端会根据修为圆满度与心魔隐患投掷 d100，结算圆满破境（transcendent）、成功晋升（success）、冲关受阻（stalled）或走火入魔反噬（backlash）。`;

export const progressionModule: GameModule = {
  id: 'progression',
  keptWhenUnused: false,
  hasPanel: true,
  tools: [
    {
      tool: breakthroughTool,
      spec: {
        name: BREAKTHROUGH,
        description:
          'Attempt a realm breakthrough or tier promotion. Rolls a d100 based on XP saturation, inner deviation penalty, and catalyst bonus, updating the realm or applying backlash. Call before narrating the attempt.',
        inputSchema: toJsonSchema(breakthroughInput),
      },
    },
  ],
  record: { schema: progressionSection, apply: applyProgression },
  guide: { en, zh },
};
