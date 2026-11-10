import type { Locale, WorldState } from '@roleplay/shared';
import { AppError } from '../errors';
import {
  NO_USAGE,
  type Conversation,
  type ConversationInit,
  type LLMProvider,
  type StepHandlers,
  type StepResult,
  type ToolResult,
  type TurnMeta,
} from './types';

/**
 * A scripted game master that needs no API key. It plays a small fixed story
 * through the same tools a real model uses, which makes it the reference for
 * how a turn is meant to look, and lets the whole stack run offline in
 * development and tests.
 */

/** The input of one `record` call, as the tool schema defines it. */
interface RecordInput {
  world?: Record<string, unknown>;
  locations?: Record<string, unknown>[];
  characters?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  quests?: Record<string, unknown>[];
  lore?: Record<string, unknown>[];
  scene?: Record<string, unknown>;
  pictures?: Record<string, unknown>[];
  suggestions: string[];
}

interface ScriptedStep {
  /** Told through `narrate`. Empty for a step that only rolls dice. */
  text: string;
  roll?: { notation: string; reason: string };
  record?: RecordInput;
}

interface Script {
  hp: string;
  gold: string;
  times: string[];
  opening(meta: TurnMeta): { text: string; record: RecordInput };
  rollReason: string;
  outcome(meta: TurnMeta, success: boolean): string;
  stranger: { text: string; character: Record<string, unknown> };
  letter: { name: string; description: string };
  questProgress(leads: number): string;
  sceneSummary(success: boolean): string;
  suggestions: string[];
  /** Used only when pictures are on offer. */
  art: {
    style: string;
    scene: { prompt: string; caption: string };
    stranger: { prompt: string; caption: string };
  };
}

const PLAYER = 'pc_player';
const QUEST = 'quest_missing_courier';
const STRANGER = 'npc_stranger';

const en: Script = {
  hp: 'HP',
  gold: 'Gold',
  times: ['Dusk', 'Nightfall', 'Late evening', 'Midnight', 'The small hours', 'First light'],
  opening: ({ seed }) => ({
    text: [
      'Rain has followed you for three days along the marsh road, and it follows you still as you push open the door of the Drowned Lantern. Heat, woodsmoke and the smell of onion stew close around you. A single brass lantern hangs over the bar, burning a steady, greenish flame.',
      'The innkeeper looks up from the mug she is polishing. "You\'re the first off the road since the courier," she says. "And he never arrived." She nods at an empty stool. *Outside, something that is not the wind moves through the reeds.*',
      'Your purse is light, your boots are soaked, and every eye in the room has already slid away from you.',
    ].join('\n\n'),
    record: {
      world: {
        title: 'The Lantern Road',
        premise:
          'A lonely inn on the edge of a great marsh, where travellers go missing and pale lights drift over the water at night. Low fantasy, quiet dread, small stakes that grow. (Demo story: a real model would build the world from your premise.)',
      },
      locations: [
        {
          id: 'loc_inn',
          name: 'The Drowned Lantern',
          description: 'A low-beamed common room, warm and smoky. The green-flamed lantern over the bar never goes out.',
          connections: ['loc_marsh_road', 'loc_cellar'],
        },
        {
          id: 'loc_marsh_road',
          name: 'Marsh Road',
          description: 'A raised causeway of rotting planks, reeds crowding in from both sides.',
        },
        {
          id: 'loc_cellar',
          name: 'Cellar',
          description: 'Behind a locked door at the back of the bar. Mara keeps the key on her belt.',
        },
      ],
      characters: [
        {
          id: PLAYER,
          name: seed.playerName || 'Wanderer',
          is_player: true,
          role: 'Traveller',
          description: seed.playerConcept || 'A road-worn stranger with more questions than coin.',
          status: 'Soaked and tired',
          location_id: 'loc_inn',
          stats: [
            { name: 'HP', value: 20, max: 20 },
            { name: 'Gold', value: 12 },
            { name: 'Nerve', value: 'Steady' },
          ],
        },
        {
          id: 'npc_mara',
          name: 'Mara Venn',
          role: 'Innkeeper',
          description: 'Broad-shouldered, grey-braided, with a scar that pulls one eyebrow into permanent doubt.',
          personality: 'Dry, watchful, generous only once she has decided about you.',
          status: 'Polishing a mug, sizing you up',
          attitude: 'Wary',
          location_id: 'loc_inn',
        },
      ],
      items: [
        { id: 'item_travel_cloak', name: 'Travel cloak', description: 'Heavy wool, still dripping.' },
        { id: 'item_ration', name: 'Trail ration', description: 'Hard bread and harder cheese.', quantity: 2 },
      ],
      quests: [
        {
          id: QUEST,
          title: 'The Missing Courier',
          description: 'A courier bound for the Drowned Lantern vanished on the marsh road. Find out what became of him.',
          progress: 'Just heard about it.',
        },
      ],
      lore: [
        {
          id: 'lore_marsh_lights',
          title: 'The Marsh Lights',
          content: 'Locals say the pale lights over the water are lanterns carried by those the marsh has kept.',
        },
        {
          id: 'lore_mara_secret',
          title: 'What Mara knows',
          content: 'The courier did arrive. Mara hid him in the cellar; he is carrying something the marsh wants back.',
          hidden: true,
        },
      ],
      scene: { location_id: 'loc_inn', time: 'Dusk', weather: 'Steady rain', summary: 'You have just come in from the rain.' },
      suggestions: ['Ask Mara about the courier', 'Order a bowl of stew', 'Study the green lantern'],
    },
  }),
  rollReason: 'Does it go your way?',
  outcome: ({ playerText }, success) =>
    success
      ? [
          `"${playerText}" — you commit to it, and for once the marsh seems to be on your side. It goes better than you had any right to expect.`,
          'Mara watches from behind the bar, one eyebrow raised. "Well," she says, "that\'s more than the last one managed." She slides a few coins across the counter. "For your trouble. Now, about that courier..."',
        ].join('\n\n')
      : [
          `"${playerText}" — you commit to it, but something slips. A sharp sting, a muttered curse, and you come away bruised and no closer than before.`,
          '"Careful," Mara says without looking up. "The marsh takes its due from the clumsy first." *The green flame over the bar gutters, then steadies.*',
        ].join('\n\n'),
  stranger: {
    text: 'The door bangs open. A mud-spattered man stumbles in, clutching a satchel to his chest as if it might be taken from him. His eyes find yours and hold there a moment too long.',
    character: {
      id: STRANGER,
      name: 'Tobin Ashe',
      role: 'Mud-spattered stranger',
      description: 'Thin, hollow-eyed, wearing the remains of a courier\'s livery.',
      personality: 'Frightened and evasive; talks too fast.',
      status: 'Catching his breath by the door',
      attitude: 'Desperate',
    },
  },
  letter: { name: 'Sealed letter', description: 'Wax seal unbroken, addressed in a hurried hand. It is faintly warm.' },
  questProgress: (leads) => `Leads followed: ${leads}.`,
  sceneSummary: (success) => (success ? 'Things are going your way, for now.' : 'A setback. The room is watching.'),
  suggestions: ['Press on with the search', 'Talk to whoever is nearest', 'Step outside and listen to the marsh'],
  art: {
    style: 'Moody storybook watercolour, muted greens and amber lamplight',
    scene: {
      prompt:
        'Interior of a low-beamed roadside inn at dusk. A brass lantern with a steady green flame hangs over a worn wooden bar; a broad-shouldered innkeeper with a grey braid polishes a mug. Rain streaks the small windows. Warm smoke, deep shadows.',
      caption: 'The Drowned Lantern',
    },
    stranger: {
      prompt:
        'Portrait of a thin, hollow-eyed man in the torn remains of a courier\'s livery, spattered with marsh mud, clutching a leather satchel to his chest. Lit from one side by lamplight, a dark doorway behind him.',
      caption: 'Tobin Ashe',
    },
  },
};

const zh: Script = {
  hp: '生命',
  gold: '铜钱',
  times: ['黄昏', '入夜', '夜深', '子时', '后半夜', '破晓'],
  opening: ({ seed }) => ({
    text: [
      '雨已经跟了你三天。你推开“沉灯居”的木门时，它还在身后的沼泽古道上下个不停。热气、柴烟和葱炖肉的味道一下子裹了上来。柜台上方悬着一盏铜灯，灯焰青幽幽的，一动不动。',
      '掌柜从手里的陶碗上抬起眼。“自打那个信使之后，你是头一个从道上下来的。”她说，“可他压根没到。”她朝一张空凳子抬了抬下巴。*门外，有什么东西正穿过芦苇，那不是风。*',
      '你的钱袋很轻，靴子湿透，而满屋子的目光都已经从你身上悄悄挪开。',
    ].join('\n\n'),
    record: {
      world: {
        title: '灯影古道',
        premise:
          '大泽边缘一间孤零零的客栈。过路人时有失踪，入夜后水面上飘着惨白的灯火。低魔、阴郁，从小事一步步牵出大事。（演示剧本：接入真实模型后，世界会按你的设定生成。）',
      },
      locations: [
        {
          id: 'loc_inn',
          name: '沉灯居',
          description: '梁木低矮的大堂，暖和，烟气缭绕。柜台上那盏青焰铜灯从不熄灭。',
          connections: ['loc_marsh_road', 'loc_cellar'],
        },
        { id: 'loc_marsh_road', name: '沼泽古道', description: '朽木铺成的栈道，两侧芦苇挤得密不透风。' },
        { id: 'loc_cellar', name: '地窖', description: '柜台后一扇上了锁的门。钥匙挂在温玛腰间。' },
      ],
      characters: [
        {
          id: PLAYER,
          name: seed.playerName || '旅人',
          is_player: true,
          role: '过路客',
          description: seed.playerConcept || '风尘仆仆的外乡人，心里的疑问比身上的盘缠多。',
          status: '浑身湿透，疲惫不堪',
          location_id: 'loc_inn',
          stats: [
            { name: '生命', value: 20, max: 20 },
            { name: '铜钱', value: 12 },
            { name: '胆气', value: '尚稳' },
          ],
        },
        {
          id: 'npc_mara',
          name: '温玛',
          role: '客栈掌柜',
          description: '肩宽背厚，花白的辫子，一道旧疤把一边眉毛永远吊成了不信的样子。',
          personality: '话少，眼尖，认准了人才肯掏心。',
          status: '擦着陶碗，暗中打量你',
          attitude: '提防',
          location_id: 'loc_inn',
        },
      ],
      items: [
        { id: 'item_travel_cloak', name: '旅行斗篷', description: '厚羊毛，还在滴水。' },
        { id: 'item_ration', name: '干粮', description: '硬饼子，配更硬的奶酪。', quantity: 2 },
      ],
      quests: [
        {
          id: QUEST,
          title: '失踪的信使',
          description: '一名赶往沉灯居的信使在沼泽古道上不见了。查清他的下落。',
          progress: '刚刚听说此事。',
        },
      ],
      lore: [
        { id: 'lore_marsh_lights', title: '泽上灯火', content: '本地人说，水面上那些惨白的光，是被大泽留下的人提着的灯。' },
        {
          id: 'lore_mara_secret',
          title: '温玛知道的事',
          content: '信使其实到了。温玛把他藏在地窖里；他身上带着大泽想要讨回去的东西。',
          hidden: true,
        },
      ],
      scene: { location_id: 'loc_inn', time: '黄昏', weather: '雨势不歇', summary: '你刚从雨里进来。' },
      suggestions: ['向温玛打听信使的事', '要一碗炖肉', '细看那盏青焰铜灯'],
    },
  }),
  rollReason: '这一步顺不顺？',
  outcome: ({ playerText }, success) =>
    success
      ? [
          `“${playerText}”——你拿定主意就去做了。这一回，大泽像是站在你这边，事情比你敢想的还要顺。`,
          '温玛在柜台后看着，吊起的那边眉毛又高了一分。“行啊，”她说，“比上一个强。”她把几枚铜钱推过柜面。“辛苦钱。那么，说回那个信使……”',
        ].join('\n\n')
      : [
          `“${playerText}”——你拿定主意就去做了，可偏偏出了岔子。一阵刺痛，一声低骂，你落了一身淤青，却半点没往前走。`,
          '“当心点。”温玛头也不抬，“大泽先收笨手笨脚的人。”*柜台上的青焰晃了一晃，又稳住了。*',
        ].join('\n\n'),
  stranger: {
    text: '门“砰”地被撞开。一个满身泥浆的男人跌进来，把一只挎包死死抱在胸前，像是怕人抢走。他的目光落在你身上，多停了那么一瞬。',
    character: {
      id: STRANGER,
      name: '阿烬',
      role: '满身泥浆的陌生人',
      description: '瘦削，眼窝深陷，身上是信使号衣的残片。',
      personality: '惊惶，躲闪，说话又急又快。',
      status: '靠在门边喘气',
      attitude: '走投无路',
    },
  },
  letter: { name: '火漆密信', description: '封蜡完好，字迹潦草。摸上去微微发烫。' },
  questProgress: (leads) => `已追查线索：${leads} 条。`,
  sceneSummary: (success) => (success ? '眼下一切还算顺利。' : '吃了个亏。满屋子的人都在看。'),
  suggestions: ['继续追查', '找最近的人搭话', '出门听听沼泽的动静'],
  art: {
    style: '阴郁的绘本水彩，灰绿色调，琥珀色灯光',
    scene: {
      prompt:
        '黄昏时分一间梁木低矮的路边客栈内景。磨旧的木柜台上方悬着一盏铜灯，灯焰青幽而稳定；一位肩宽背厚、梳着花白辫子的女掌柜正在擦陶碗。雨水划过小窗。暖烟弥漫，阴影深重。',
      caption: '沉灯居',
    },
    stranger: {
      prompt:
        '一名瘦削、眼窝深陷的男子的半身像，身穿破烂的信使号衣，溅满沼泽泥浆，把一只皮挎包紧抱在胸前。灯光从一侧照来，身后是幽暗的门洞。',
      caption: '阿烬',
    },
  },
};

const SCRIPTS: Record<Locale, Script> = { en, zh };

function numericStat(world: WorldState, name: string, fallback: number): number {
  const player = world.playerId ? world.characters[world.playerId] : undefined;
  const value = player?.stats.find((s) => s.name === name)?.value;
  return typeof value === 'number' ? value : fallback;
}

function rollTotal(results: ToolResult[]): number {
  try {
    const parsed = JSON.parse(results[0]?.content ?? '') as { total?: unknown };
    return typeof parsed.total === 'number' ? parsed.total : 10;
  } catch {
    return 10;
  }
}

/** The opening, with a picture of the first scene when the game master can paint. */
function openGame(meta: TurnMeta, script: Script, canDraw: boolean): ScriptedStep {
  const { text, record } = script.opening(meta);
  if (canDraw) {
    record.world = { ...record.world, art_style: script.art.style };
    record.pictures = [{ subject: 'scene', ...script.art.scene }];
  }
  return { text, record };
}

/** The second step of an action turn: tell how the roll went and record what changed. */
function resolveAction(meta: TurnMeta, script: Script, results: ToolResult[], canDraw: boolean): ScriptedStep {
  const { world, turn } = meta;
  const success = rollTotal(results) >= 10;
  const paragraphs = [script.outcome(meta, success)];

  const player: Record<string, unknown> = { id: PLAYER };
  const record: RecordInput = {
    characters: [player],
    quests: [{ id: QUEST, progress: script.questProgress(turn - 1) }],
    scene: { time: script.times[(turn - 1) % script.times.length], summary: script.sceneSummary(success) },
    suggestions: script.suggestions,
  };

  if (success) {
    player.stats = [{ name: script.gold, value: numericStat(world, script.gold, 12) + 3 }];
    if (!world.items['item_letter']) record.items = [{ id: 'item_letter', ...script.letter }];
  } else {
    player.stats = [{ name: script.hp, value: Math.max(numericStat(world, script.hp, 20) - 2, 1) }];
  }

  // The first action also brings a new face through the door.
  if (!world.characters[STRANGER]) {
    paragraphs.push(script.stranger.text);
    record.characters?.push(script.stranger.character);
    if (canDraw) record.pictures = [{ subject: 'character', id: STRANGER, ...script.art.stranger }];
  }

  return { text: paragraphs.join('\n\n'), record };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AppError('aborted', 'The request was cancelled.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

class MockConversation implements Conversation {
  private readonly meta: TurnMeta;
  private readonly delayMs: number;
  private readonly canDraw: boolean;
  private stepIndex = 0;
  private results: ToolResult[] = [];

  constructor(init: ConversationInit, delayMs: number) {
    this.meta = init.meta;
    this.delayMs = delayMs;
    // Pictures are a section of `record` only when something can paint.
    const record = init.tools.find((tool) => tool.name === 'record');
    this.canDraw = 'pictures' in ((record?.inputSchema.properties as object | undefined) ?? {});
  }

  private script(): ScriptedStep {
    const script = SCRIPTS[this.meta.locale];
    const nothing: ScriptedStep = { text: '' };
    if (this.meta.kind === 'start') {
      return this.stepIndex === 0 ? openGame(this.meta, script, this.canDraw) : nothing;
    }
    // An action turn takes two steps, like a real one: roll first, then tell the result.
    if (this.stepIndex === 0) return { text: '', roll: { notation: 'd20', reason: script.rollReason } };
    return this.stepIndex === 1 ? resolveAction(this.meta, script, this.results, this.canDraw) : nothing;
  }

  async step(handlers: StepHandlers): Promise<StepResult> {
    const step = this.script();
    const index = this.stepIndex++;

    // In the order a real model is asked to work: dice, then the story, then the record.
    const calls: { name: string; input: unknown }[] = [];
    if (step.roll) calls.push({ name: 'roll_dice', input: step.roll });
    if (step.text) calls.push({ name: 'narrate', input: { text: step.text } });
    if (step.record) calls.push({ name: 'record', input: step.record });
    const toolCalls = calls.map((call, i) => ({ id: `mock_${index}_${i}`, ...call }));

    // Stream the narration the way a real model does: as fragments of the
    // narrate call's JSON input, a few characters at a time.
    const narration = toolCalls.find((call) => call.name === 'narrate');
    if (narration) {
      const json = JSON.stringify(narration.input);
      for (let i = 0; i < json.length; i += 5) {
        if (handlers.signal.aborted) throw new AppError('aborted', 'The request was cancelled.');
        if (this.delayMs > 0) await sleep(this.delayMs, handlers.signal);
        handlers.onToolInput({ id: narration.id, name: narration.name }, json.slice(i, i + 5));
      }
    }

    return { text: '', toolCalls, stop: toolCalls.length > 0 ? 'tool_use' : 'end', usage: { ...NO_USAGE } };
  }

  submitToolResults(results: ToolResult[]): void {
    this.results = results;
  }

  addUserMessage(): void {
    // The script always narrates and records, so it is never reminded to.
  }
}

export class MockProvider implements LLMProvider {
  readonly kind = 'mock';
  private readonly delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 12;
  }

  startConversation(init: ConversationInit): Conversation {
    return new MockConversation(init, this.delayMs);
  }
}
