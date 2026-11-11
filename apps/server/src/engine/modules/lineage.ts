import {
  HEIR_APTITUDES,
  NURTURE_INTENSITIES,
  type ClanRelative,
  type ConsortEntry,
  type HeirAptitudeKey,
  type HeirEntry,
  type LineageState,
  type NurtureIntensity,
  type NurtureOutcome,
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
 * Lineage & Inner Court: consorts/spouses with investiture ranks and residences,
 * royal heirs/scions with four aptitudes, grand tutors, crown designation, and
 * extended clan or maternal relatives.
 */

export const NURTURE_HEIR = 'nurture_heir';

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const die6 = (random: () => number) => Math.floor(random() * 6) + 1;

function ensureLineage(world: WorldState): LineageState {
  return (world.modules.lineage ??= {
    houseName: '',
    successionLaw: '',
    consorts: {},
    heirs: {},
    relatives: {},
  });
}

const OUTCOME_MEANING: Record<NurtureOutcome, string> = {
  breakthrough: 'Remarkable progress: the heir grasps the heart of the discipline and grows markedly.',
  steady: 'Solid instruction: steady improvement along the chosen path.',
  strained: 'Progress comes slowly under pressure or fatigue; small gains with lingering tension.',
  resisted: 'Overly harsh pushing backfires into defiance or distress, eroding composure and virtue.',
};

// --- nurture_heir tool --------------------------------------------------------

const nurtureHeirInput = z.strictObject({
  character_id: id.describe('Character id of the heir in `world.modules.lineage.heirs`.'),
  focus: z
    .enum(HEIR_APTITUDES)
    .describe('Aptitude being cultivated or examined: governance, martial, virtue, or learning.'),
  intensity: z
    .enum(NURTURE_INTENSITIES)
    .optional()
    .describe('gentle, strict, or harsh. Defaults to strict.'),
});

const nurtureHeirTool: GameTool = {
  name: NURTURE_HEIR,
  silent: false,
  records: true,
  endsTurn: false,
  run(world: WorldState, raw: unknown, ctx: ToolContext) {
    const parsed = nurtureHeirInput.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error, raw);
    const input = parsed.data;

    try {
      const state = ensureLineage(world);
      const heir = state.heirs[input.character_id];
      if (!heir) {
        throw new WorldOpError(`Character "${input.character_id}" is not registered in lineage.heirs.`);
      }
      const character = world.characters[heir.characterId];
      const heirName = character?.name ?? heir.characterId;
      const focus: HeirAptitudeKey = input.focus;
      const intensity: NurtureIntensity = input.intensity ?? 'strict';

      let tutorBonus = 0;
      let tutorName = '';
      if (heir.tutorId) {
        tutorName = world.characters[heir.tutorId]?.name ?? heir.tutorId;
        const official = world.modules.court?.officials[heir.tutorId];
        if (official) {
          const score =
            focus === 'martial'
              ? official.military
              : focus === 'governance'
                ? official.governance
                : Math.max(official.governance, official.intrigue);
          tutorBonus = Math.max(1, Math.round(score / 30));
        } else {
          tutorBonus = 1;
        }
      }

      const intensityMod = intensity === 'gentle' ? 0 : intensity === 'strict' ? 1 : 2;
      const rolls = [die6(ctx.random), die6(ctx.random)];
      const natural = (rolls[0] ?? 1) + (rolls[1] ?? 1);
      const bonus = tutorBonus + intensityMod;
      const total = natural + bonus;

      const from = heir.aptitude[focus];
      let outcome: NurtureOutcome;
      let gain = 0;
      if (intensity === 'harsh' && natural <= 4) {
        outcome = 'resisted';
        gain = 0;
        heir.aptitude.virtue = clamp(heir.aptitude.virtue - 2, 0, 100);
      } else if (total >= 11) {
        outcome = 'breakthrough';
        gain = 8;
      } else if (total >= 7) {
        outcome = intensity === 'harsh' && natural <= 6 ? 'strained' : 'steady';
        gain = outcome === 'strained' ? 3 : 4;
      } else {
        outcome = intensity === 'gentle' ? 'steady' : 'strained';
        gain = 1;
      }

      const to = clamp(from + gain, 0, 100);
      heir.aptitude[focus] = to;

      const event: WorldEvent = {
        type: 'heir_nurtured',
        characterId: heir.characterId,
        characterName: heirName,
        tutorName,
        focus,
        intensity,
        rolls,
        bonus,
        total,
        outcome,
        from,
        to,
      };

      return {
        content: JSON.stringify({
          heir: heirName,
          tutor: tutorName || null,
          focus,
          intensity,
          rolls,
          bonus,
          total,
          outcome,
          from,
          to,
          aptitude: heir.aptitude,
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

// --- record.lineage -----------------------------------------------------------

const consortEntry = z.strictObject({
  character_id: id.describe('Character id in `world.characters`.'),
  title: z.string().optional().describe('Investiture rank ("皇后", "皇贵妃", "贵嫔", "王夫"). Required when creating.'),
  rank_order: z.number().int().min(1).max(99).optional().describe('1 for highest rank, ascending downward.'),
  palace: z.string().optional().describe('Residence or hall ("坤宁宫", "长乐宫").'),
  favor: z.number().int().min(0).max(100).optional().describe('Sovereign favor, 0 to 100.'),
  family_background: z.string().optional().describe('Maternal house or noble clan backing them.'),
  remove: z.boolean().optional(),
});

const aptitudePatch = z.strictObject({
  governance: z.number().int().min(0).max(100).optional(),
  martial: z.number().int().min(0).max(100).optional(),
  virtue: z.number().int().min(0).max(100).optional(),
  learning: z.number().int().min(0).max(100).optional(),
});

const heirEntry = z.strictObject({
  character_id: id.describe('Character id in `world.characters`.'),
  order: z.string().optional().describe('Birth order style ("皇长子", "皇嫡次女"). Required when creating.'),
  title: z.string().optional().describe('Princely or noble title ("东宫太子", "秦王", "永宁公主").'),
  parent_ids: z.array(id).max(4).optional().describe('Character ids of known parents in the cast.'),
  tutor_id: id.nullable().optional().describe('Character id of assigned grand tutor ("太傅"), or null.'),
  is_heir_apparent: z.boolean().optional().describe('True to designate as crown successor (clears previous).'),
  aptitude: aptitudePatch.optional().describe('Aptitude scores, 0 to 100.'),
  backing: z.string().optional().describe('Court bloc or maternal clan supporting this heir.'),
  remove: z.boolean().optional(),
});

const relativeEntry = z.strictObject({
  character_id: id.describe('Character id in `world.characters`.'),
  relation: z.string().optional().describe('Kinship label ("皇叔", "皇太后", "国舅"). Required when creating.'),
  title: z.string().optional().describe('Title or fief ("宁王", "承恩公").'),
  influence: z.number().int().min(0).max(100).optional(),
  note: z.string().optional(),
  remove: z.boolean().optional(),
});

const lineageSection = z
  .strictObject({
    house_name: z.string().optional().describe('Royal house or bloodline name ("大乾萧氏宗室").'),
    succession_law: z.string().optional().describe('Succession rule ("嫡长子继承制", "秘密立储").'),
    consorts: z.array(consortEntry).max(24).optional().describe('Inner court consorts, spouses, and rank investitures.'),
    heirs: z.array(heirEntry).max(24).optional().describe('Children, heirs, tutors, aptitudes, and crown designation.'),
    relatives: z.array(relativeEntry).max(24).optional().describe('Royal clan elders, princes of the blood, and in-laws.'),
  })
  .describe('Lineage & Inner Court: consorts, royal heirs, grand tutors, succession, and clan relatives.');

function upsertConsort(world: WorldState, state: LineageState, entry: z.infer<typeof consortEntry>): WorldEvent[] {
  const character = world.characters[entry.character_id];
  if (!character) throw new WorldOpError(`Character "${entry.character_id}" does not exist.`);
  if (character.isPlayer) throw new WorldOpError('The player character cannot be listed as a consort.');

  const existing = state.consorts[entry.character_id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`"${character.name}" is not in lineage.consorts.`);
    delete state.consorts[entry.character_id];
    return [];
  }
  const title = entry.title?.trim();
  if (!existing && !title) {
    throw new WorldOpError(`Consort "${entry.character_id}" needs a "title" when registered.`);
  }
  const prevTitle = existing?.title ?? '';
  const consort: ConsortEntry = existing ?? {
    characterId: entry.character_id,
    title: title ?? '',
    rankOrder: entry.rank_order ?? 10,
    palace: '',
    favor: 50,
    familyBackground: '',
  };
  if (title) consort.title = title;
  if (entry.rank_order !== undefined) consort.rankOrder = entry.rank_order;
  if (entry.palace !== undefined) consort.palace = entry.palace.trim();
  if (entry.favor !== undefined) consort.favor = clamp(entry.favor, 0, 100);
  if (entry.family_background !== undefined) consort.familyBackground = entry.family_background.trim();
  state.consorts[consort.characterId] = consort;

  if (!existing || consort.title !== prevTitle) {
    return [
      {
        type: 'consort_invested',
        characterId: character.id,
        characterName: character.name,
        title: consort.title,
        palace: consort.palace,
      },
    ];
  }
  return [];
}

function upsertHeir(world: WorldState, state: LineageState, entry: z.infer<typeof heirEntry>): WorldEvent[] {
  const character = world.characters[entry.character_id];
  if (!character) throw new WorldOpError(`Character "${entry.character_id}" does not exist.`);
  if (character.isPlayer) throw new WorldOpError('The player character cannot be listed as their own heir.');
  if (entry.tutor_id && !world.characters[entry.tutor_id]) {
    throw new WorldOpError(`Tutor character "${entry.tutor_id}" does not exist.`);
  }

  const existing = state.heirs[entry.character_id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`"${character.name}" is not in lineage.heirs.`);
    delete state.heirs[entry.character_id];
    return [];
  }
  const order = entry.order?.trim();
  if (!existing && !order) {
    throw new WorldOpError(`Heir "${entry.character_id}" needs an "order" label (e.g. "皇长子") when registered.`);
  }

  const wasApparent = existing?.isHeirApparent ?? false;
  const heir: HeirEntry = existing ?? {
    characterId: entry.character_id,
    order: order ?? '',
    title: '',
    parentIds: [],
    tutorId: null,
    isHeirApparent: false,
    aptitude: { governance: 30, martial: 30, virtue: 40, learning: 35 },
    backing: '',
  };
  if (order) heir.order = order;
  if (entry.title !== undefined) heir.title = entry.title.trim();
  if (entry.parent_ids !== undefined) {
    heir.parentIds = entry.parent_ids.filter((pid) => Boolean(world.characters[pid]));
  }
  if (entry.tutor_id !== undefined) heir.tutorId = entry.tutor_id;
  if (entry.backing !== undefined) heir.backing = entry.backing.trim();
  if (entry.aptitude) {
    for (const key of HEIR_APTITUDES) {
      const val = entry.aptitude[key];
      if (val !== undefined) heir.aptitude[key] = clamp(val, 0, 100);
    }
  }
  if (entry.is_heir_apparent !== undefined) {
    if (entry.is_heir_apparent) {
      for (const other of Object.values(state.heirs)) {
        if (other.characterId !== heir.characterId) other.isHeirApparent = false;
      }
    }
    heir.isHeirApparent = entry.is_heir_apparent;
  }

  state.heirs[heir.characterId] = heir;

  if (heir.isHeirApparent && !wasApparent) {
    return [
      {
        type: 'heir_designated',
        characterId: character.id,
        characterName: character.name,
        title: heir.title || heir.order,
      },
    ];
  }
  return [];
}

function upsertRelative(world: WorldState, state: LineageState, entry: z.infer<typeof relativeEntry>): WorldEvent[] {
  const character = world.characters[entry.character_id];
  if (!character) throw new WorldOpError(`Character "${entry.character_id}" does not exist.`);

  const existing = state.relatives[entry.character_id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`"${character.name}" is not in lineage.relatives.`);
    delete state.relatives[entry.character_id];
    return [];
  }
  const relation = entry.relation?.trim();
  if (!existing && !relation) {
    throw new WorldOpError(`Relative "${entry.character_id}" needs a "relation" label when registered.`);
  }
  const rel: ClanRelative = existing ?? {
    characterId: entry.character_id,
    relation: relation ?? '',
    title: '',
    influence: 30,
    note: '',
  };
  if (relation) rel.relation = relation;
  if (entry.title !== undefined) rel.title = entry.title.trim();
  if (entry.influence !== undefined) rel.influence = clamp(entry.influence, 0, 100);
  if (entry.note !== undefined) rel.note = entry.note;
  state.relatives[rel.characterId] = rel;
  return [];
}

function applyLineage(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'lineage', errors);
  if (!parts) return [];

  const state = ensureLineage(world);
  const events: WorldEvent[] = [];
  const reader = entryReader(parts, 'lineage.', errors, events);
  reader.rejectUnknown(['house_name', 'succession_law', 'consorts', 'heirs', 'relatives'], 'lineage field');
  reader.one('house_name', z.string(), (value) => {
    state.houseName = value.trim();
    return [];
  });
  reader.one('succession_law', z.string(), (value) => {
    state.successionLaw = value.trim();
    return [];
  });
  reader.each('consorts', consortEntry, (entry) => upsertConsort(world, state, entry));
  reader.each('heirs', heirEntry, (entry) => upsertHeir(world, state, entry));
  reader.each('relatives', relativeEntry, (entry) => upsertRelative(world, state, entry));
  return events;
}

function royalHouseholdView(world: WorldState, characterId: string): unknown {
  const state = world.modules.lineage;
  if (!state) return undefined;
  const consort = state.consorts[characterId];
  const heir = state.heirs[characterId];
  const relative = state.relatives[characterId];
  const tutored = Object.values(state.heirs).filter((h) => h.tutorId === characterId);
  if (!consort && !heir && !relative && tutored.length === 0) return undefined;

  const crown = Object.values(state.heirs).find((h) => h.isHeirApparent);
  return {
    house: state.houseName,
    succession_law: state.successionLaw,
    heir_apparent: crown ? (world.characters[crown.characterId]?.name ?? crown.order) : null,
    ...(consort
      ? {
          your_consort_rank: {
            title: consort.title,
            palace: consort.palace,
            favor: consort.favor,
            family_background: consort.familyBackground,
          },
        }
      : {}),
    ...(heir
      ? {
          your_princely_standing: {
            order: heir.order,
            title: heir.title,
            is_heir_apparent: heir.isHeirApparent,
            tutor: heir.tutorId ? (world.characters[heir.tutorId]?.name ?? null) : null,
            aptitude: heir.aptitude,
          },
        }
      : {}),
    ...(relative ? { your_kinship: { relation: relative.relation, title: relative.title } } : {}),
    ...(tutored.length > 0
      ? {
          royal_pupils: tutored.map((h) => ({
            name: world.characters[h.characterId]?.name ?? h.order,
            order: h.order,
            aptitude: h.aptitude,
          })),
        }
      : {}),
  };
}

const en = `## Lineage and inner court

You have a dynastic household register under record.lineage and the nurture_heir tool for stories involving an inner palace, consorts, noble marriage alliances, royal heirs, and succession struggles.

Create every consort, heir, and clan elder in record.characters as well, then register them in record.lineage:
- consorts: title/rank, rank_order (1 = highest), palace/residence, favor (0–100), and maternal family_background (linking inner-court favor to outer-court factions).
- heirs: birth order, princely title, parent_ids, assigned tutor_id (can be a minister from record.court!), is_heir_apparent, four aptitudes (governance, martial, virtue, learning), and political backing.
- relatives: royal uncles, dowager empresses, princes of the blood, and powerful in-laws.

When the player personally examines an heir, sends them through a study/martial regimen, or has their grand tutor test them, call nurture_heir before narrating: the server rolls 2d6 plus the tutor's bonus, updates the heir's aptitude, and reports breakthrough, steady, strained, or resisted.`;

const zh = `## 后宫内廷与宗室皇嗣

你在 record.lineage 下拥有内廷与宗室谱系面板，并配有 nurture_heir 工具，用于包含后宫位份、外戚联姻、皇嗣教养、太傅授业与夺嫡立储的故事。

凡入册的妃嫔、皇嗣与宗亲均需同时在 record.characters 中建档，再记入 record.lineage：
- consorts（内廷妃嫔/伴侣）：位份封号（title，如“皇后”“皇贵妃”）、位次排序（rank_order，1 为尊）、居所宫苑（palace）、恩宠（favor 0–100）及母族外戚背景（family_background，可与前朝党派呼应）。
- heirs（皇嗣继承人）：排行（order，如“皇长子”）、封爵（title）、双亲（parent_ids）、指派太傅（tutor_id，可由前朝重臣兼任）、是否立为储君（is_heir_apparent）、四维资质（治国 governance、武略 martial、仁德 virtue、学识 learning）及背后支持势力（backing）。
- relatives（宗室与外戚）：皇太后、藩王皇叔、国舅勋戚等。

当君主考校皇嗣课业、督促习武修德或命太傅授业时，先调用 nurture_heir 传入皇嗣、培养方向与宽严尺度（gentle 宽仁、strict 严明、harsh 苛厉），再叙述考校情景。服务端会结合太傅能力投掷 2d6，自动结算皇嗣资质成长或逆反损耗。`;

const designateHeirOpSchema = z.strictObject({
  character_id: id,
  title: z.string().optional(),
});

const assignTutorOpSchema = z.strictObject({
  character_id: id,
  tutor_id: id.nullable(),
});

const updateConsortOpSchema = z.strictObject({
  character_id: id,
  title: z.string().optional(),
  palace: z.string().optional(),
  favor_delta: z.number().int().min(-50).max(50).optional(),
});

function operateLineage(
  world: WorldState,
  op: string,
  params: Record<string, unknown>,
): { events: WorldEvent[]; summary: string } {
  const state = ensureLineage(world);

  if (op === 'designate_heir') {
    const parsed = designateHeirOpSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const existing = state.heirs[parsed.data.character_id];
    if (!existing) throw new WorldOpError(`Character "${parsed.data.character_id}" is not registered in lineage.heirs.`);
    const events = upsertHeir(world, state, {
      character_id: parsed.data.character_id,
      is_heir_apparent: true,
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
    });
    const name = world.characters[parsed.data.character_id]?.name ?? existing.order;
    return { events, summary: `册立 ${name} 为储君` };
  }

  if (op === 'assign_tutor') {
    const parsed = assignTutorOpSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const existing = state.heirs[parsed.data.character_id];
    if (!existing) throw new WorldOpError(`Character "${parsed.data.character_id}" is not registered in lineage.heirs.`);
    const events = upsertHeir(world, state, {
      character_id: parsed.data.character_id,
      tutor_id: parsed.data.tutor_id,
    });
    const heirName = world.characters[parsed.data.character_id]?.name ?? existing.order;
    const tutorName = parsed.data.tutor_id
      ? (world.characters[parsed.data.tutor_id]?.name ?? parsed.data.tutor_id)
      : '解除太傅';
    return { events, summary: `指派 ${heirName} 授业太傅：${tutorName}` };
  }

  if (op === 'update_consort') {
    const parsed = updateConsortOpSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const existing = state.consorts[parsed.data.character_id];
    if (!existing) throw new WorldOpError(`Character "${parsed.data.character_id}" is not registered in lineage.consorts.`);
    const nextFavor =
      parsed.data.favor_delta !== undefined ? clamp(existing.favor + parsed.data.favor_delta, 0, 100) : undefined;
    const events = upsertConsort(world, state, {
      character_id: parsed.data.character_id,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.palace !== undefined ? { palace: parsed.data.palace } : {}),
      ...(nextFavor !== undefined ? { favor: nextFavor } : {}),
    });
    const name = world.characters[parsed.data.character_id]?.name ?? parsed.data.character_id;
    return { events, summary: `内廷册封/恩赏 ${name}（${state.consorts[parsed.data.character_id]?.title ?? existing.title}）` };
  }

  throw new WorldOpError(`Unknown lineage operation "${op}".`);
}

export const lineageModule: GameModule = {
  id: 'lineage',
  keptWhenUnused: false,
  hasPanel: true,
  tools: [
    {
      tool: nurtureHeirTool,
      spec: {
        name: NURTURE_HEIR,
        description:
          'Instruct or examine a registered heir in governance, martial, virtue, or learning. Rolls 2d6 plus their grand tutor\'s bonus, updates aptitude, and returns breakthrough, steady, strained, or resisted.',
        inputSchema: toJsonSchema(nurtureHeirInput),
      },
    },
  ],
  record: { schema: lineageSection, apply: applyLineage },
  guide: { en, zh },
  shownToCharacter: { tag: 'royal_household', of: royalHouseholdView },
  operate: operateLineage,
};
