import { GENERATION_DEFAULTS, type Message, type Session, type TurnRequest } from '@roleplay/shared';
import type { ChatTurn, ConversationInit } from '../llm/types';
import { gameMasterView } from './memory';
import { getPrompts, type Exchange, type PromptOptions } from './prompts';
import { getToolbox } from './tools';

/**
 * Builds what the game master sees for one turn.
 *
 * The model is not handed last turn's raw API exchange. Each turn starts fresh
 * from three things: fixed instructions, the story so far as plain text, and
 * the current world state. The world state is the source of truth, which is
 * why a turn can end the moment its tool calls are applied, and why old turns
 * can be dropped without the model losing track of the world.
 */

/** How much the models are given to work with. Set by the player in the AI settings. */
export interface Tuning {
  /** Past turns of story replayed to the game master. */
  historyTurns: number;
  /** Memories a character has in mind when they speak. */
  memoriesRecalled: number;
  /** Effective input context window of the active Game Master model in tokens (defaults to 1M). */
  contextWindow?: number;
}

export const DEFAULT_TUNING: Tuning = {
  historyTurns: GENERATION_DEFAULTS.historyTurns,
  memoriesRecalled: GENERATION_DEFAULTS.memoriesRecalled,
  contextWindow: 1_000_000,
};

/** Fast conservative token estimate across CJK (~0.65 tok/char) and Latin/JSON (~0.28 tok/char). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x3400 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    }
  }
  return Math.ceil(cjk * 0.65 + (text.length - cjk) * 0.28);
}

export type ContextOptions = PromptOptions & Tuning;

interface TurnPair {
  turn: number;
  player: string;
  told: string[];
}

function collectTurnPairs(messages: Message[], nameOf: (characterId: string) => string): TurnPair[] {
  const turns = new Map<number, { player: string; told: string[] }>();
  const at = (turn: number) => {
    let entry = turns.get(turn);
    if (!entry) turns.set(turn, (entry = { player: '', told: [] }));
    return entry;
  };

  for (const message of messages) {
    // Events and pictures are left out on purpose: their effects are already in the world state.
    if (message.kind === 'player') {
      at(message.turn).player = message.to ? `→ ${nameOf(message.to)}: ${message.text}` : message.text;
    } else if (message.kind === 'narration') {
      at(message.turn).told.push(message.text);
    } else if (message.kind === 'dialogue') {
      at(message.turn).told.push(`${message.characterName}: ${message.text}`);
    }
  }

  return [...turns.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, turn]) => turn.told.length > 0)
    .map(([turnNum, turn]) => ({ turn: turnNum, player: turn.player, told: turn.told }));
}

function historyWindowStart(
  pairs: TurnPair[],
  historyTurns: number,
  contextWindow = 1_000_000,
): number {
  const pairCount = pairs.length;
  const chunk = Math.max(1, Math.floor(historyTurns / 3));
  const excess = pairCount - historyTurns;
  let start = excess > 0 ? Math.floor(excess / chunk) * chunk : 0;

  // Guard against overflowing smaller models (e.g. 128K/200K) when historyTurns is set high for 1M models.
  const maxHistoryTokens = Math.max(8_000, Math.floor(contextWindow * 0.75));
  let totalTokens = 0;
  let minStartByBudget = start;
  for (let i = pairCount - 1; i >= start; i--) {
    const turn = pairs[i]!;
    const turnTokens = estimateTokens(turn.player) + estimateTokens(turn.told.join('\n\n')) + 8;
    if (totalTokens + turnTokens > maxHistoryTokens && i < pairCount - 2) {
      const tokenStride = Math.max(1, Math.min(chunk, 6));
      minStartByBudget = Math.min(pairCount - 2, Math.ceil((i + 1) / tokenStride) * tokenStride);
      break;
    }
    totalTokens += turnTokens;
  }
  if (minStartByBudget > start) start = minStartByBudget;
  return start;
}

/**
 * Past turns as user/assistant pairs: what the player did or said, then what
 * was told in reply. A line the player said to one character is marked with
 * who it was for, and a character's own answer with who gave it.
 *
 * At least `historyTurns` turns are replayed once there are that many (up to
 * 75% of `contextWindow`). The window moves in whole chunks rather than one
 * turn at a time, so the transcript prefix stays identical (and cached) for
 * several turns in a row.
 */
export function buildHistory(
  messages: Message[],
  openingMarker: string,
  nameOf: (characterId: string) => string = (id) => id,
  historyTurns: number = DEFAULT_TUNING.historyTurns,
  contextWindow: number = DEFAULT_TUNING.contextWindow ?? 1_000_000,
): ChatTurn[] {
  const pairs = collectTurnPairs(messages, nameOf);
  const start = historyWindowStart(pairs, historyTurns, contextWindow);

  return pairs.slice(start).flatMap((turn): ChatTurn[] => [
    { role: 'user', text: turn.player || openingMarker },
    { role: 'assistant', text: turn.told.join('\n\n') },
  ]);
}

export interface DroppedTurnsArchive {
  upToTurn: number;
  transcript: string;
  fallbackDigest: string;
}

/**
 * Finds turns that have slid out of `buildHistory`'s window and have not yet
 * been folded into `world.storySummary`.
 */
export function findDroppedTranscript(
  messages: Message[],
  openingMarker: string,
  nameOf: (characterId: string) => string = (id) => id,
  historyTurns: number = DEFAULT_TUNING.historyTurns,
  summarizedUpToTurn = 0,
  contextWindow: number = DEFAULT_TUNING.contextWindow ?? 1_000_000,
): DroppedTurnsArchive | null {
  const pairs = collectTurnPairs(messages, nameOf);
  const start = historyWindowStart(pairs, historyTurns, contextWindow);
  if (start <= 0) return null;

  const dropped = pairs.slice(0, start).filter((entry) => entry.turn > summarizedUpToTurn);
  if (dropped.length === 0) return null;

  const transcript = dropped
    .map((entry) => {
      const action = entry.player || openingMarker;
      const outcome = entry.told.join('\n');
      return `[Turn ${entry.turn}]\nPlayer: ${action}\nStory: ${outcome}`;
    })
    .join('\n\n');

  const fallbackDigest = dropped
    .map((entry) => {
      const action = (entry.player || openingMarker).replace(/\s+/g, ' ').slice(0, 80);
      const outcome = entry.told.join(' ').replace(/\s+/g, ' ').slice(0, 140);
      return `[T${entry.turn}] ${action} -> ${outcome}`;
    })
    .join('\n');

  return {
    upToTurn: dropped[dropped.length - 1]!.turn,
    transcript,
    fallbackDigest,
  };
}

export function buildSummaryInit(session: Session, droppedTranscript: string): ConversationInit {
  const prompts = getPrompts(session.language);
  const arc = session.world.storyArc;
  const milestones = (session.world.chronicle ?? [])
    .slice(-20)
    .map((e) => `[T${e.turn}${e.time ? ` · ${e.time}` : ''}] ${e.title}${e.summary ? ` — ${e.summary}` : ''}`)
    .join('\n');
  const enrichedTranscript = [
    arc && (arc.chapter || arc.summary)
      ? `<current_arc>\n${[arc.chapter, arc.summary].filter(Boolean).join(' — ')}\n</current_arc>`
      : '',
    milestones ? `<recorded_milestones>\n${milestones}\n</recorded_milestones>` : '',
    droppedTranscript,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    system: prompts.summarySystem,
    history: [],
    prompt: prompts.summarize(session.world.storySummary ?? '', enrichedTranscript),
    tools: [],
    cacheKey: `rp:${session.id}:summary`,
    meta: {
      locale: session.language,
      kind: 'summary',
      turn: session.world.turn,
      playerText: '',
      seed: session.seed,
      world: structuredClone(session.world),
    },
  };
}

export interface ExecutedDirectiveNote {
  label: string;
  summary: string;
  aiNote?: string;
  /** True when the directive was NOT pre-mutated on the server and must be scheduled & adjudicated by the AI GM. */
  scheduled?: boolean;
}

function gameMasterInit(
  session: Session,
  kind: 'start' | 'action' | 'referee',
  ask: string,
  playerText: string,
  turn: number,
  options: ContextOptions,
  characterId?: string,
  cueText?: string,
): ConversationInit {
  const prompts = getPrompts(session.language);
  const { world } = session;
  // The game master watches several characters at once, so each gets fewer memories than an actor would.
  const perCharacter = Math.max(2, Math.round((options.memoriesRecalled * 2) / 3));
  const view = gameMasterView(world, cueText ?? playerText, perCharacter, options.modules);
  const state = `<world_state>\n${JSON.stringify(view)}\n</world_state>`;
  const nameOf = (id: string) => world.characters[id]?.name ?? id;

  return {
    system: prompts.system(options),
    history: buildHistory(
      session.messages,
      prompts.openingMarker,
      nameOf,
      options.historyTurns,
      options.contextWindow ?? DEFAULT_TUNING.contextWindow ?? 1_000_000,
    ),
    prompt: `${state}\n\n${ask}`,
    tools: getToolbox(options).specs,
    cacheKey: `rp:${session.id}:gm`,
    meta: {
      locale: session.language,
      kind,
      turn,
      playerText,
      seed: session.seed,
      world: structuredClone(world),
      ...(characterId ? { characterId } : {}),
    },
  };
}

/** The game master's turn: the opening of a story, or its answer to something the player does. */
export function buildTurnInit(
  session: Session,
  request: Extract<TurnRequest, { kind: 'start' | 'action' }>,
  turn: number,
  options: ContextOptions,
  executedDirectives?: readonly ExecutedDirectiveNote[],
): ConversationInit {
  if (request.kind === 'start') {
    return gameMasterInit(session, 'start', getPrompts(session.language).opening(session.seed), '', turn, options);
  }

  const actionText = request.text.trim();
  const hasDirectives = Boolean(executedDirectives && executedDirectives.length > 0);
  if (!hasDirectives) {
    const ask = `<player_action>\n${request.text}\n</player_action>`;
    return gameMasterInit(session, 'action', ask, request.text, turn, options);
  }

  const settled = executedDirectives!.filter((item) => !item.scheduled);
  const scheduled = executedDirectives!.filter((item) => item.scheduled);
  const blocks: string[] = [];

  if (settled.length > 0) {
    const settledLines = settled.map((item) =>
      item.aiNote?.trim() ? `- ${item.summary} (${item.aiNote.trim()})` : `- ${item.summary}`,
    );
    blocks.push(
      [
        '<executed_directives>',
        session.language === 'zh'
          ? '以下模块化政令/操作已在服务端先行结算并写入上方 <world_state>（切勿回滚已变更的数值，请在此基础上推演朝野/各方反应与剧情后果）：'
          : 'The following structured module directives have already been settled on the server and reflected in <world_state> above (keep them intact and narrate/record their consequences and reactions):',
        ...settledLines,
        '</executed_directives>',
      ].join('\n'),
    );
  }

  if (scheduled.length > 0) {
    const scheduledLines = scheduled.map((item) => {
      const main = item.aiNote?.trim() || item.summary || item.label;
      return item.label && main !== item.label ? `- [${item.label}] ${main}` : `- ${main}`;
    });
    blocks.push(
      [
        '<player_directives>',
        session.language === 'zh'
          ? '玩家通过军政与系统面板下达了以下结构化指令（尚未修改世界状态），请由你作为主持人统一调度、核验并执行：'
          : 'The player issued the following structured panel directives (not yet applied to world state); schedule, validate, and adjudicate them as the game master:',
        ...scheduledLines,
        session.language === 'zh'
          ? '调度与裁定要求：(1) 结合当前局势、钱粮兵源、人物身份立场与时空距离核验合理性——例如选派守将/太傅/主理须从符合身份的我方臣将中择定并兼顾原职交接，若指令受阻、越理或遭朝野抗议，请如实演绎受阻或折中后果；(2) 凡涉及战事或回合收支（simulate）、早朝廷议（hold_court）、皇嗣考校（nurture_heir）、领地营造（develop_domain）、暗桩行动（run_operation）、破境冲关（breakthrough）、商铺交易（trade）的指令，请先调用对应规则工具结算，再把全部模块联动变化（沙盘、朝堂、宗室、领地、日历、进度钟等）同步写入 record。'
          : 'Adjudication rules: (1) Validate plausibility against treasury/manpower, character allegiance/office, and distance/time — e.g. personnel appointments must choose fitting loyal characters and handle office handovers; if an order is blocked, contested, or unrealistic, play out the real resistance or complication; (2) Call the matching rule tools (simulate, hold_court, nurture_heir, develop_domain, run_operation, breakthrough, trade) before narrating, and synchronize all affected modules in record.',
        '</player_directives>',
      ].join('\n'),
    );
  }

  const directiveBlock = blocks.join('\n\n');

  const ask = actionText
    ? `${directiveBlock}\n\n<player_action>\n${actionText}\n</player_action>`
    : `${directiveBlock}\n\n<player_action>\n${
        session.language === 'zh'
          ? '颁行上述部署并推进本回合局势。'
          : 'Promulgate the directives above and advance the turn.'
      }\n</player_action>`;

  const effectivePlayerText =
    actionText || executedDirectives!.map((item) => item.label).join(session.language === 'zh' ? '；' : '; ');
  const cueText = [
    actionText,
    ...executedDirectives!.map((item) => `${item.label} ${item.summary} ${item.aiNote ?? ''}`),
  ]
    .filter(Boolean)
    .join(' ');

  return gameMasterInit(session, 'action', ask, effectivePlayerText, turn, options, undefined, cueText);
}

/**
 * The game master ruling on what a conversation changed.
 * The exchange is already the last entry of the transcript; the ask restates
 * it together with the one thing the transcript lacks, what the character
 * says it changes.
 */
export function buildRefereeInit(
  session: Session,
  characterId: string,
  exchange: Exchange,
  turn: number,
  options: ContextOptions,
): ConversationInit {
  const ask = getPrompts(session.language).referee(exchange);
  return gameMasterInit(session, 'referee', ask, exchange.said, turn, options, characterId);
}
