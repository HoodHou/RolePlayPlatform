import {
  createEmptyWorld,
  MODULE_IDS,
  type Locale,
  type ModuleId,
  type ScenarioArchitectRequest,
  type ScenarioBlueprint,
  type ScenarioStreamEvent,
  type TokenUsage,
} from '@roleplay/shared';
import { z } from 'zod';
import { AppError, toAppError } from '../errors';
import { NO_USAGE, type ChatTurn, type ConversationInit, type LLMProvider } from '../llm/types';
import { allModuleIds, normalizeModules } from './modules';
import { StreamingStringField } from './streamingField';
import { toJsonSchema } from './tools';

export const PROPOSE_SCENARIO = 'propose_scenario';

const blueprintInputSchema = z.object({
  title: z.string().min(1).describe('Evocative scenario title.'),
  premise: z
    .string()
    .min(1)
    .describe(
      'Rich 2–4 paragraph opening scenario premise in the story language: world backdrop, major factions/ministers/forces, core tensions, visual atmosphere, and the immediate opening scene hook.',
    ),
  player_name: z.string().min(1).describe('Fitting protagonist name in the story language.'),
  player_concept: z
    .string()
    .min(1)
    .describe('Protagonist identity, position, temperament, strengths, and initial dilemma or trump card.'),
  modules: z
    .array(z.string())
    .max(24)
    .optional()
    .describe('Recommended play module IDs chosen from <available_modules> that best serve this scenario.'),
});

const proposeScenarioSchema = z.object({
  reply: z
    .string()
    .min(1)
    .describe(
      'Conversational reply to the player in the story language: highlight what you crafted or refined, and briefly mention angles they can tweak next.',
    ),
  blueprint: blueprintInputSchema
    .optional()
    .describe(
      'Complete, ready-to-play scenario blueprint. Always include whenever creating or updating the scenario (omit only if asking a pure clarification question before any idea exists).',
    ),
  suggestions: z
    .array(z.string().min(1))
    .max(4)
    .optional()
    .describe('3 short one-click follow-up prompts the player can tap to further customize the scenario.'),
});

const MODULE_DESCRIPTIONS: Record<string, { en: string; zh: string }> = {
  court: {
    en: 'court — Imperial/council governance: registered ministers, factions, memorials ("朱批"), edicts, realm metrics, hold_court debates.',
    zh: 'court — 朝堂与百官：在案臣子官籍、朋党派系、待批奏折朱批、现行诏令、国库民心等社稷指标与早朝廷议。',
  },
  lineage: {
    en: 'lineage — Inner court & royal bloodline: consorts, royal heirs & aptitudes, grand tutors, crown designation, clan relatives.',
    zh: 'lineage — 后宫内廷与宗室皇嗣：妃嫔位份圣眷、皇嗣四维资质与太傅授业、东宫册立与宗亲外戚。',
  },
  domain: {
    en: 'domain — Domain & construction: capital/fief/sect stockpiles, per-cycle yields, upgradable facilities, assigned NPC stewards.',
    zh: 'domain — 领地营造与驻守：都城/封地/山门资源收支、设施建造升级与委派在案臣属驻守主理。',
  },
  espionage: {
    en: 'espionage — Secret police & spy network: covert operatives, infiltration & exposure heat, blackmail dossiers, covert ops.',
    zh: 'espionage — 锦衣密探与暗桩：特务机构、暗桩渗透度与暴露热度、百官把柄黑料密档与秘密侦缉行动。',
  },
  progression: {
    en: 'progression — Cultivation & realm ladder: major/minor realms, XP bar, bottlenecks, qi-deviation risk, techniques & breakthroughs.',
    zh: 'progression — 境界功法与晋升：修真/武道境界阶梯、修为进度、破境瓶颈、心魔隐患与功法装配。',
  },
  dice: {
    en: 'dice — Tabletop attribute & skill checks (d20 / d100 / 2d6).',
    zh: 'dice — 跑团属性检定与掷骰（d20 / d100 / 2d6）。',
  },
  combat: {
    en: 'combat — Turn-by-turn tactical combat tracker with initiative, defense, and HP.',
    zh: 'combat — 回合制战斗追踪（先攻、命中防御与生命值结算）。',
  },
  oracle: {
    en: 'oracle — Solo-RPG fate oracle answering uncertain world questions with twists.',
    zh: 'oracle — 命运神谕（裁决悬而未决的局势变数与意外转折）。',
  },
  clocks: {
    en: 'clocks — Segmented progress & danger countdown clocks.',
    zh: 'clocks — 进度钟与危机倒计时。',
  },
  calendar: {
    en: 'calendar — World day/hour clock and scheduled deadlines/events.',
    zh: 'calendar — 世界日历时辰与到期日程事件。',
  },
  bonds: {
    en: 'bonds — Character relationship affinity (-100 to +100) and trust stages.',
    zh: 'bonds — 人物关系好感羁绊（-100 至 +100 与亲疏阶段）。',
  },
  sandbox: {
    en: 'sandbox — Strategic faction map with territories, resources, diplomacy, and wars.',
    zh: 'sandbox — 天下势力沙盘（疆域版图、兵力钱粮、邦交与战事推演）。',
  },
  market: {
    en: 'market — Shops, wares, currency balance, and 2d6 haggling.',
    zh: 'market — 集市商铺、物价库存与讨价还价。',
  },
  clues: {
    en: 'clues — Investigation clue board with linked evidence and deductions.',
    zh: 'clues — 悬疑探案线索板与推论印证。',
  },
  travel: {
    en: 'travel — Overland routes, travel pace, road hazards, and encounters.',
    zh: 'travel — 远行路线图、险度与旅途奇遇。',
  },
  deck: {
    en: 'deck — Major Arcana fate deck & weighted random encounter tables.',
    zh: 'deck — 命运塔罗牌堆与随机奇遇表。',
  },
  reputation: {
    en: 'reputation — Faction/city standing, public titles, and wanted heat.',
    zh: 'reputation — 各方声望、公开头衔与通缉热度。',
  },
};

function buildSystemPrompt(locale: Locale, available: readonly ModuleId[]): string {
  const moduleCatalog = available
    .map((id) => `- ${MODULE_DESCRIPTIONS[id]?.[locale] ?? `${id} — Custom play module.`}`)
    .join('\n');

  if (locale === 'zh') {
    return `你是一位精通互动叙事、历史权谋、修仙奇幻与桌面角色扮演设计的「开局剧本总设计师」。
玩家正在新建一局文字角色扮演游戏，通过与你对话来共创、打磨开局剧本。

请始终调用 \`${PROPOSE_SCENARIO}\` 工具作答（只调用一次）：
1. \`reply\`：用简练有感染力的中文回应玩家的构想，点出本次设计的戏剧冲突亮点，并提示可以继续调整的方向。
2. \`blueprint\`：给出完整、可直接开局的结构化剧本蓝图：
   - \`title\`：富有张力的剧本标题（如「永宁惊雷 · 少年天子亲政」）。
   - \`premise\`：详实生动的开局设定（2～4 段）：包含世界观时代背景、核心矛盾与各方派系/关键登场人物（写明一两位核心臣属或对手的名号与立场，方便游戏开始后主持人直接立档）、美术氛围基调，以及**具体的第一幕开场瞬间**。若玩家此前已有草稿（见 <current_draft>），请在其基础上精准增删打磨，保留玩家满意的设定。
   - \`player_name\`：贴合题材的主角姓名（若玩家已起名则优先沿用）。
   - \`player_concept\`：鲜明立体的主角身份、处境、性格特质与手中底牌/隐患。
   - \`modules\`：从下方 <available_modules> 中精选最契合本剧本的 4～9 个系统模块 ID（例如皇帝/权谋局优先搭配 court, lineage, domain, espionage, bonds, calendar, reputation, clocks；修仙宗门搭配 progression, domain, combat, dice, market, bonds 等）。
3. \`suggestions\`：提供 3 条简短具体的一键追问/微调指令（每条 8～18 字，如「加入手握重兵的摄政皇叔」「融合修真国运与灵脉体系」「调高开局财政与边关危机」）。

<available_modules>
${moduleCatalog}
</available_modules>`;
  }

  return `You are the Lead Scenario Architect for an interactive tabletop & narrative role-playing platform.
The player is conversing with you to co-create and refine an opening scenario before starting a new campaign.

Always answer by calling the \`${PROPOSE_SCENARIO}\` tool exactly once:
1. \`reply\`: Respond conversationally in English—highlight the dramatic hooks you crafted or refined and note what they can tweak next.
2. \`blueprint\`: Provide a complete, ready-to-play scenario blueprint:
   - \`title\`: Evocative scenario title.
   - \`premise\`: Rich 2–4 paragraph opening setting covering world backdrop, core factions & 2–3 named key NPCs/rivals with clear agendas, visual tone, and the immediate opening scene moment. When <current_draft> is present, refine it faithfully rather than discarding established details the player liked.
   - \`player_name\`: Fitting protagonist name (preserve the player's chosen name if already set).
   - \`player_concept\`: Vivid protagonist identity, role, temperament, leverage, and dilemma.
   - \`modules\`: Pick 4–9 synergistic module IDs from <available_modules> (e.g. imperial statecraft pairs court, lineage, domain, espionage, bonds, calendar, reputation, clocks; xianxia pairs progression, domain, combat, dice, market, bonds).
3. \`suggestions\`: 3 short, specific one-click refinement prompts (e.g. "Add a scheming Regent Uncle", "Blend in dragon-vein cultivation", "Raise opening treasury & border stakes").

<available_modules>
${moduleCatalog}
</available_modules>`;
}

function buildArchitectInit(request: ScenarioArchitectRequest): {
  init: ConversationInit;
  allowedModules: ModuleId[];
} {
  const known = allModuleIds();
  const allowedModules =
    request.availableModules && request.availableModules.length > 0
      ? normalizeModules(request.availableModules)
      : [...known];

  const messages = request.messages.filter((m) => m.text.trim().length > 0);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text.trim() ?? '';
  const history: ChatTurn[] = messages.slice(0, -1).map((m) => ({
    role: m.role,
    text: m.text.trim(),
  }));

  const draft = request.currentDraft;
  const hasDraft = Boolean(
    draft &&
      (draft.title?.trim() || draft.premise?.trim() || draft.playerName?.trim() || draft.playerConcept?.trim()),
  );

  const draftXml = hasDraft
    ? `<current_draft>\n${JSON.stringify(
        {
          title: draft?.title ?? '',
          premise: draft?.premise ?? '',
          player_name: draft?.playerName ?? '',
          player_concept: draft?.playerConcept ?? '',
          modules: draft?.modules ?? [],
        },
        null,
        2,
      )}\n</current_draft>\n\n`
    : '';

  const prompt = `${draftXml}<player_request>\n${lastUser}\n</player_request>`;

  const spec = {
    name: PROPOSE_SCENARIO,
    description:
      'Reply to the player and return the structured opening scenario blueprint and follow-up tweak suggestions. Call once.',
    inputSchema: toJsonSchema(proposeScenarioSchema),
  };

  const turnCount = messages.filter((m) => m.role === 'user').length;

  return {
    allowedModules,
    init: {
      system: buildSystemPrompt(request.language, allowedModules.length > 0 ? allowedModules : MODULE_IDS),
      history,
      prompt,
      tools: [spec],
      meta: {
        locale: request.language,
        kind: 'architect',
        turn: Math.max(1, turnCount),
        playerText: lastUser,
        seed: {
          premise: draft?.premise ?? '',
          playerName: draft?.playerName ?? '',
          playerConcept: draft?.playerConcept ?? '',
        },
        world: createEmptyWorld(),
      },
    },
  };
}

export interface ScenarioArchitectDeps {
  provider: LLMProvider;
  emit: (event: ScenarioStreamEvent) => void;
  signal: AbortSignal;
}

const MAX_ATTEMPTS = 2;

export async function runScenarioArchitect(
  request: ScenarioArchitectRequest,
  deps: ScenarioArchitectDeps,
): Promise<void> {
  const usage: TokenUsage = { ...NO_USAGE };
  try {
    const { init, allowedModules } = buildArchitectInit(request);
    const conversation = deps.provider.startConversation(init);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let field = new StreamingStringField('reply');
      let streamed = false;
      const reset = () => {
        if (streamed) deps.emit({ type: 'reply_reset' });
        streamed = false;
        field = new StreamingStringField('reply');
      };

      const result = await conversation.step({
        signal: deps.signal,
        onTextDelta: () => {},
        onToolInput: (call, fragment) => {
          if (call.name !== PROPOSE_SCENARIO) return;
          const delta = field.push(fragment);
          if (!delta) return;
          streamed = true;
          deps.emit({ type: 'reply_delta', text: delta });
        },
        onStepReset: reset,
      });

      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.cachedInputTokens += result.usage.cachedInputTokens;

      if (result.stop === 'refusal') {
        throw new AppError('refused', 'The model declined to draft this scenario.');
      }

      const call = result.toolCalls.find((c) => c.name === PROPOSE_SCENARIO);
      if (call && result.stop !== 'max_tokens') {
        const parsed = proposeScenarioSchema.safeParse(call.input);
        if (parsed.success) {
          const reply = parsed.data.reply.trim();
          if (!streamed && reply) deps.emit({ type: 'reply_delta', text: reply });

          let blueprint: ScenarioBlueprint | null = null;
          if (parsed.data.blueprint) {
            const rawMods = parsed.data.blueprint.modules ?? [];
            const filteredMods = normalizeModules(rawMods).filter(
              (id) => allowedModules.length === 0 || allowedModules.includes(id),
            );
            blueprint = {
              title: parsed.data.blueprint.title.trim(),
              premise: parsed.data.blueprint.premise.trim(),
              playerName: parsed.data.blueprint.player_name.trim(),
              playerConcept: parsed.data.blueprint.player_concept.trim(),
              modules: filteredMods,
            };
          }

          const suggestions = (parsed.data.suggestions ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4);
          deps.emit({ type: 'done', reply, blueprint, suggestions, usage });
          return;
        }

        reset();
        conversation.submitToolResults(
          result.toolCalls.map((other) => ({
            id: other.id,
            isError: true,
            content:
              other.id === call.id
                ? JSON.stringify({ error: 'invalid_input', issues: z.prettifyError(parsed.error) })
                : `Unknown tool "${other.name}".`,
          })),
        );
        continue;
      }

      reset();
      const plain = result.text.trim();
      if (plain && result.toolCalls.length === 0) {
        deps.emit({ type: 'reply_delta', text: plain });
        deps.emit({ type: 'done', reply: plain, blueprint: null, suggestions: [], usage });
        return;
      }

      const reminder =
        request.language === 'zh'
          ? `请调用 ${PROPOSE_SCENARIO} 工具返回回复与剧本蓝图。`
          : `Please call ${PROPOSE_SCENARIO} with your reply and scenario blueprint.`;
      if (result.toolCalls.length > 0) {
        conversation.submitToolResults(
          result.toolCalls.map((other) => ({ id: other.id, isError: true, content: reminder })),
        );
      } else {
        conversation.addUserMessage(reminder);
      }
    }

    throw new AppError('empty_response', 'The scenario architect returned no answer.');
  } catch (err) {
    const error = toAppError(err);
    deps.emit({ type: 'error', error: error.toApiError() });
  }
}
