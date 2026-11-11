import type { Character, Locale, WorldState } from '@roleplay/shared';
import { AppError } from '../errors';
import { BOARD_PREMISE, boardOrders, boardOutcome, openBoard } from './mockBoard';
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
 * A scripted stand-in for the models that needs no API key. It plays a small
 * fixed story through the same tools the real ones use: the game master's
 * turns, and characters answering for themselves. That makes it the reference
 * for how a turn is meant to look, and lets the whole stack run offline in
 * development and tests.
 *
 * It uses whatever play modules the story has: a check where there are dice,
 * and for a premise about contending powers a second story told on the sandbox
 * board (mockBoard.ts).
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
  memories?: { character_id: string; text: string; about?: string[]; importance?: number }[];
  pictures?: Record<string, unknown>[];
  /** Sections of the play modules the story has. */
  dice?: Record<string, unknown>;
  clocks?: Record<string, unknown>[];
  bonds?: Record<string, unknown>[];
  calendar?: Record<string, unknown>;
  combat?: Record<string, unknown>;
  /** The modules the story keeps, on the turn that choice is the game master's. */
  modules?: string[];
  suggestions: string[];
}

/** The input of a character's `respond` call. */
interface RespondInput {
  text: string;
  memory?: string;
  importance?: number;
  attitude?: string;
  changes?: string;
  /** The bonds module's part: how the exchange moved them. */
  bond?: { change: number; reason: string };
}

interface ScriptedStep {
  roll?: { notation: string; reason: string };
  /** A check against the player's sheet, where the story has dice. */
  check?: Record<string, unknown>;
  /** A question put to the oracle. */
  fate?: Record<string, unknown>;
  /** Time passing, on the calendar. */
  pass?: Record<string, unknown>;
  /** A round of blows, in the combat tracker. */
  fight?: Record<string, unknown>;
  /** Battles and rounds, handed to the sandbox. */
  simulate?: Record<string, unknown>;
  /** Told through `narrate`. */
  text?: string;
  record?: RecordInput | Record<string, unknown>;
  /** A character's answer, through `respond`. */
  respond?: RespondInput;
}

/** How one character talks: a few lines, taken in turn as the conversation goes on. */
interface Part {
  lines: string[];
  /** Their feeling toward the player after each of those lines. */
  attitudes: string[];
  remember(said: string): string;
}

interface Script {
  hp: string;
  gold: string;
  /** The stat the player's attempts are checked against. */
  wits: string;
  /** The danger the inn's one progress clock counts toward. */
  clock: { name: string; description: string };
  /** Why Mara's bond with the player moves. */
  bond: { earned: string; lost: string; talked: string };
  /** The fight the player can pick with what waits outside. */
  combat: {
    /** Matches an action that starts it. */
    words: RegExp;
    foe: string;
    playerStrikes: string;
    foeStrikes: string;
    /** Told after a round that settled nothing, when the player's side won, and when it lost. */
    ongoing: string;
    won: string;
    lost: string;
    /** How it ended, for the tracker. */
    outcomeWon: string;
    outcomeLost: string;
  };
  /** What the calendar holds: a deadline the player knows of, and an arrival they do not. */
  calendar: {
    deadline: { title: string; description: string };
    arrival: { title: string; description: string };
    /** What fills the two hours each action takes. */
    passing: string;
    /** Told when the hidden arrival comes due. */
    arrives: string;
  };
  times: string[];
  opening(meta: TurnMeta): { text: string; record: RecordInput };
  rollReason: string;
  outcome(meta: TurnMeta, success: boolean): string;
  /** What Mara makes of watching the player act. */
  witnessed(meta: TurnMeta, success: boolean): string;
  stranger: { text: string; character: Record<string, unknown>; firstMemory: string; seenByMara: string };
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
  /** Characters answering for themselves, by id; anyone else gets `anyone`. */
  parts: Record<string, Part>;
  anyone(character: Character): Part;
  /** Mentioning the cellar to Mara makes her act, which brings the game master in to rule on it. */
  cellar: {
    word: string;
    line: string;
    remember: string;
    intent: string;
    outcome: string;
    key: { name: string; description: string };
    progress: string;
  };
}

const PLAYER = 'pc_player';
const MARA = 'npc_mara';
const STRANGER = 'npc_stranger';
const QUEST = 'quest_missing_courier';
const CLOCK = 'clock_marsh';

const en: Script = {
  hp: 'HP',
  gold: 'Gold',
  wits: 'Wits',
  clock: { name: 'The marsh closes in', description: 'Whatever walks the causeway with a lantern reaches the inn door.' },
  bond: { earned: 'You did what you said you would', lost: 'You made a mess of it under her roof', talked: 'You asked, and listened to the answer' },
  combat: {
    words: /\b(attack|fight|strike|stab|kill)\b|\bdraw (my|a|the) (knife|blade|sword|weapon)\b/i,
    foe: 'The lantern-bearer',
    playerStrikes: 'You go for it with your knife',
    foeStrikes: 'It swings the lantern at your head',
    ongoing: 'Steel and brass ring in the dark of the yard. Neither of you gives ground, and the green light swings wildly between you.',
    won: 'The lantern hits the mud and gutters. Whatever carried it folds up around the wound like wet cloth, and is still.',
    lost: 'The lantern catches you across the temple. The yard tilts, the mud comes up to meet you, and the pale light bends over where you lie.',
    outcomeWon: 'The lantern-bearer fell in the inn yard.',
    outcomeLost: 'You went down in the yard, under the pale light.',
  },
  calendar: {
    deadline: { title: 'The road closes', description: 'At first light on the third day the causeway floods, and nobody leaves the inn for a week.' },
    arrival: { title: 'The lantern reaches the yard', description: 'Whatever carries the light on the causeway comes as far as the inn yard.' },
    passing: 'The evening wears on',
    arrives: '*Outside, a pale light has stopped in the yard. It is not moving on.*',
  },
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
            { name: 'Wits', value: 2 },
            { name: 'Nerve', value: 'Steady' },
          ],
        },
        {
          id: MARA,
          name: 'Mara Venn',
          role: 'Innkeeper',
          description: 'Broad-shouldered, grey-braided, with a scar that pulls one eyebrow into permanent doubt.',
          personality: 'Dry, watchful, generous only once she has decided about you.',
          status: 'Polishing a mug, sizing you up',
          attitude: 'Wary',
          location_id: 'loc_inn',
          voice: 'Short sentences, dry as kindling. Answers a question with a price or another question. "Questions cost extra after dark."',
          goals: 'Keep the inn standing and the courier hidden until she knows who is hunting him.',
          secrets: 'The courier is alive in her cellar. She has told no one.',
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
      memories: [
        {
          character_id: MARA,
          text: 'A traveller came in off the marsh road at dusk, soaked through, the first since the courier. I mentioned him to see what their face did. It did nothing useful.',
          about: [PLAYER],
          importance: 3,
        },
      ],
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
  witnessed: ({ playerText }, success) =>
    success
      ? `The traveller set about this: "${playerText}". They carried it off better than I expected. I paid them a few coins for it.`
      : `The traveller tried this: "${playerText}". They made a mess of it and got hurt. Not careful enough for the marsh.`,
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
      voice: 'Breathless, half-finished sentences, keeps glancing at the door. "I didn\'t— it wasn\'t me they were after. Was it?"',
      goals: 'Find out whether his brother, the courier, reached this inn.',
      secrets: 'He was following his brother and saw him dragged off the causeway by something with a lantern.',
    },
    firstMemory:
      'I made it to the inn. A traveller by the bar looked straight at me when I came in. I do not know whose side they are on.',
    seenByMara: 'A man in what is left of a courier\'s livery came in, clutching a satchel. Not my courier. Too like him to be chance.',
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
  parts: {
    [MARA]: {
      lines: [
        '*She sets the mug down and looks you over.* "Questions cost extra after dark. Ask one, and I\'ll decide what it\'s worth."',
        '"You again." *The scarred eyebrow climbs.* "He was due three nights back. That\'s all the road has told me, and all I\'m telling you."',
        '*She leans on the bar, voice low.* "You keep asking. Either someone pays you to, or you care. I haven\'t decided which is worse."',
      ],
      attitudes: ['Wary', 'Wary, but curious', 'Grudgingly interested'],
      remember: (said) => `The traveller asked me: "${said}" I gave little away and watched how they took it.`,
    },
    [STRANGER]: {
      lines: [
        '"I— I don\'t know you." *He pulls the satchel tighter.* "Is that her? The one behind the bar. Is that Mara?"',
        '*He wipes mud from his mouth with a shaking hand.* "My brother carried letters on this road. He said this inn was safe. He said that."',
        '"There was a light on the causeway. Not a lamp. It walked." *His voice drops.* "Don\'t make me say the rest in here."',
      ],
      attitudes: ['Desperate', 'Desperate, clinging to you', 'Beginning to trust you'],
      remember: (said) => `The traveller by the bar spoke to me: "${said}" I said more than I meant to.`,
    },
  },
  anyone: (character) => ({
    lines: [`*${character.name} looks at you for a long moment.* "I've nothing to say about that."`],
    attitudes: [character.attitude],
    remember: (said) => `Someone asked me: "${said}" I kept my answer short.`,
  }),
  cellar: {
    word: 'cellar',
    line: '*Her hand goes to the key at her belt and stays there a breath too long.* "The cellar. So you know." *She unhooks the key.* "Then you carry the lantern, and you go down first."',
    remember: 'The traveller asked about the cellar outright. No use pretending. I gave them the key; if they mean him harm I will know soon enough.',
    intent: 'Mara unhooks the cellar key from her belt and hands it to the traveller.',
    outcome:
      'The key is cold and heavier than it looks, its bow worn smooth by one thumb. Behind the bar, the cellar door waits. *The green flame leans toward it, as if drawn.*',
    key: { name: 'Cellar key', description: 'Iron, cold, worn smooth where a thumb has rested for years.' },
    progress: 'Mara has given you the key to her cellar.',
  },
};

const zh: Script = {
  hp: '生命',
  gold: '铜钱',
  wits: '机敏',
  clock: { name: '大泽合围', description: '栈道上那个提灯的东西走到客栈门口。' },
  bond: { earned: '你说到做到', lost: '你在她的屋檐下把事情搞砸了', talked: '你问了，也听进去了' },
  combat: {
    words: /攻击|动手|拔刀|出刀|挥刀|砍|刺向|开打|杀/,
    foe: '提灯者',
    playerStrikes: '你挺刀刺了过去',
    foeStrikes: '它抡起铜灯砸向你的头',
    ongoing: '院子的黑暗里，铁器和铜器撞得铮铮作响。谁也不肯退半步，那点青光在你们之间乱晃。',
    won: '铜灯落进泥里，闪了几下灭了。提着它的那个东西像一块湿布，裹着伤口缩成一团，不动了。',
    lost: '铜灯砸在你的太阳穴上。院子一歪，泥地迎面扑来，那点惨白的光俯在你倒下的地方。',
    outcomeWon: '提灯者倒在了客栈的院子里。',
    outcomeLost: '你倒在院子里，倒在那点惨白的灯光下。',
  },
  calendar: {
    deadline: { title: '古道封路', description: '第三天破晓时栈道会被水淹没，一个礼拜之内谁也离不开客栈。' },
    arrival: { title: '灯火进了院子', description: '栈道上提着那盏灯的东西，一直走到了客栈的院子里。' },
    passing: '夜一点点深了',
    arrives: '*门外，一点惨白的光停在了院子里，不再往前走。*',
  },
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
            { name: '机敏', value: 2 },
            { name: '胆气', value: '尚稳' },
          ],
        },
        {
          id: MARA,
          name: '温玛',
          role: '客栈掌柜',
          description: '肩宽背厚，花白的辫子，一道旧疤把一边眉毛永远吊成了不信的样子。',
          personality: '话少，眼尖，认准了人才肯掏心。',
          status: '擦着陶碗，暗中打量你',
          attitude: '提防',
          location_id: 'loc_inn',
          voice: '句子短，干巴巴的。别人问话，她先开价，或者反问一句。“天黑以后，问话要加钱。”',
          goals: '保住这间客栈；在弄清是谁在追那个信使之前，把他藏好。',
          secrets: '信使还活着，就在她的地窖里。这事她谁也没告诉。',
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
      memories: [
        {
          character_id: MARA,
          text: '黄昏时有个过路客从沼泽古道上进来，浑身湿透，是那个信使之后的头一个。我故意提了一句信使，想看看这人的脸色。什么也没看出来。',
          about: [PLAYER],
          importance: 3,
        },
      ],
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
  witnessed: ({ playerText }, success) =>
    success
      ? `那个过路客去做了这件事：“${playerText}”。办得比我料想的利落。我给了几枚铜钱当辛苦钱。`
      : `那个过路客想做这件事：“${playerText}”。搞砸了，还伤了自己。这点小心，在大泽边上不够用。`,
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
      voice: '上气不接下气，话说一半就咽回去，老往门口瞟。“我没……他们要找的不是我。是吧？”',
      goals: '弄清他当信使的哥哥到底有没有走到这间客栈。',
      secrets: '他一路跟着哥哥，亲眼看见哥哥被一个提灯的东西从栈道上拖走。',
    },
    firstMemory: '我总算摸到了客栈。一进门，柜台边有个过路客直直地看着我。不知道这人是哪一边的。',
    seenByMara: '进来一个男人，穿着信使号衣的残片，死抱着一只挎包。不是我那个信使。可像成这样，不会是凑巧。',
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
  parts: {
    [MARA]: {
      lines: [
        '*她放下陶碗，把你从头看到脚。*“天黑以后，问话要加钱。你问，值多少我说了算。”',
        '“又是你。”*吊着的那边眉毛挑了挑。*“他三天前就该到。路上只捎来这一句，我也只告诉你这一句。”',
        '*她撑着柜台，压低了声音。*“你问个没完。要么是有人出钱让你问，要么是你真上心。哪个更糟，我还没想好。”',
      ],
      attitudes: ['提防', '提防，却也好奇', '勉强有了点兴趣'],
      remember: (said) => `那个过路客问我：“${said}”我没多说，只看这人怎么接话。`,
    },
    [STRANGER]: {
      lines: [
        '“我……我不认识你。”*他把挎包抱得更紧。*“那是她吗？柜台后面那个。那就是温玛？”',
        '*他用发抖的手抹掉嘴边的泥。*“我哥在这条道上送信。他说这间客栈靠得住。他是这么说的。”',
        '“栈道上有一盏灯。不是人提的灯。它自己会走。”*他的声音低下去。*“剩下的，别让我在这儿说。”',
      ],
      attitudes: ['走投无路', '走投无路，把你当成救命稻草', '开始信你了'],
      remember: (said) => `柜台边那个过路客对我说：“${said}”我说得比我想说的多。`,
    },
  },
  anyone: (character) => ({
    lines: [`*${character.name}看了你好一会儿。*“这事，我没什么可说的。”`],
    attitudes: [character.attitude],
    remember: (said) => `有人问我：“${said}”我只答了一句。`,
  }),
  cellar: {
    word: '地窖',
    line: '*她的手摸到腰间的钥匙，停得久了那么一瞬。*“地窖。这么说你知道了。”*她解下钥匙。*“那灯你来提，你走前头。”',
    remember: '那个过路客直接问起了地窖。再装也没用。我把钥匙给了这人；要是存心害他，我很快就会知道。',
    intent: '温玛从腰间解下地窖的钥匙，交给了过路客。',
    outcome: '钥匙冰凉，比看上去沉，钥匙柄被一根拇指磨得发亮。柜台后面，地窖的门静静等着。*青色的灯焰朝那边偏了偏，像是被什么牵着。*',
    key: { name: '地窖钥匙', description: '铁的，冰凉，常年被拇指按着的地方磨得光滑。' },
    progress: '温玛把地窖的钥匙交给了你。',
  },
};

const SCRIPTS: Record<Locale, Script> = { en, zh };

function numericStat(world: WorldState, name: string, fallback: number): number {
  const player = world.playerId ? world.characters[world.playerId] : undefined;
  const value = player?.stats.find((s) => s.name === name)?.value;
  return typeof value === 'number' ? value : fallback;
}

/** Whether the attempt came off: by the outcome of a check, or by the total of a plain roll. Without dice it simply does. */
function succeeded(results: ToolResult[]): boolean {
  try {
    const parsed = JSON.parse(results[0]?.content ?? '') as { outcome?: unknown; total?: unknown; answer?: unknown };
    if (typeof parsed.outcome === 'string') return ['critical', 'success', 'partial'].includes(parsed.outcome);
    // The oracle's word: any kind of yes.
    if (typeof parsed.answer === 'string') return parsed.answer.startsWith('yes');
    return typeof parsed.total === 'number' ? parsed.total >= 10 : true;
  } catch {
    return true;
  }
}

const FOE = 'foe_lantern';

/** A round of the fight in the yard: the player's blow, then the foe's. The first round also begins the fight. */
function fightRound(meta: TurnMeta, script: Script): Record<string, unknown> {
  const begun = meta.world.modules.combat?.active === true;
  return {
    ...(begun
      ? {}
      : {
          begin: {
            combatants: [
              // The player's health is the stat on their sheet: the blows land there.
              { id: PLAYER, side: 'player', defense: 13, character_id: PLAYER, hp_stat: script.hp, initiative_bonus: 2 },
              { id: FOE, side: 'enemy', defense: 11, name: script.combat.foe, hp: 9 },
            ],
          },
        }),
    attacks: [
      { attacker_id: PLAYER, target_id: FOE, bonus: 4, damage: '1d8+1', reason: script.combat.playerStrikes },
      { attacker_id: FOE, target_id: PLAYER, bonus: 3, damage: '1d6', reason: script.combat.foeStrikes },
    ],
    next_round: true,
  };
}

/** Tells the round as it fell, and ends the fight in the record once one of the two is down. */
function resolveFight(script: Script, results: ToolResult[]): ScriptedStep {
  let standing: { id: string; down: boolean }[] = [];
  try {
    standing = (JSON.parse(results[0]?.content ?? '{}') as { standing?: typeof standing }).standing ?? [];
  } catch {
    // An unreadable result is told as a round that settled nothing.
  }
  const down = (combatantId: string) => standing.find((combatant) => combatant.id === combatantId)?.down === true;
  const outcome = down(FOE) ? 'won' : down(PLAYER) ? 'lost' : 'ongoing';
  const ended = { won: script.combat.outcomeWon, lost: script.combat.outcomeLost, ongoing: undefined }[outcome];
  return {
    text: script.combat[outcome],
    record: {
      ...(ended ? { combat: { end: { outcome: ended } } } : {}),
      scene: { summary: ended ?? script.combat.ongoing },
      suggestions: script.suggestions,
    },
  };
}

/** What `pass_time` said came due, if time was passed this turn. */
function dueOnCalendar(results: ToolResult[]): { id: string }[] {
  for (const result of results) {
    try {
      const parsed = JSON.parse(result.content) as { came_due?: { id: string }[] };
      if (Array.isArray(parsed.came_due)) return parsed.came_due;
    } catch {
      // Not a calendar result.
    }
  }
  return [];
}

/** The opening, with a picture of the first scene when the game master can paint. */
function openGame(meta: TurnMeta, script: Script, canDraw: boolean, story: StoryModules): ScriptedStep {
  const { text, record } = script.opening(meta);
  if (story.has('dice')) record.dice = { system: 'd20' };
  if (story.has('clocks')) record.clocks = [{ id: CLOCK, ...script.clock, segments: 6, filled: 1 }];
  if (story.has('calendar')) {
    record.calendar = {
      now: { day: 1, hour: 18 },
      schedule: [
        { id: 'sched_road_closes', ...script.calendar.deadline, day: 3, hour: 6 },
        // Known to the game master only: it comes due a few actions in.
        { id: 'sched_lantern', ...script.calendar.arrival, in_hours: 6, hidden: true },
      ],
    };
  }
  // An inn story has no use for a board of warring powers; everything else on offer it keeps.
  if (story.choosing) record.modules = story.offered.filter((id) => id !== 'sandbox');
  if (canDraw) {
    record.world = { ...record.world, art_style: script.art.style };
    record.pictures = [{ subject: 'scene', ...script.art.scene }];
  }
  return { text, record };
}

/** The second step of an action turn: tell how the roll went and record what changed. */
function resolveAction(
  meta: TurnMeta,
  script: Script,
  results: ToolResult[],
  canDraw: boolean,
  story: StoryModules,
): ScriptedStep {
  const { world, turn } = meta;
  const success = succeeded(results);
  const paragraphs = [script.outcome(meta, success)];
  const cameDue = dueOnCalendar(results);

  const player: Record<string, unknown> = { id: PLAYER };
  const record: RecordInput = {
    characters: [player],
    quests: [{ id: QUEST, progress: script.questProgress(turn - 1) }],
    scene: { time: script.times[(turn - 1) % script.times.length], summary: script.sceneSummary(success) },
    // Mara was there and saw it; she will remember it her way.
    memories: [{ character_id: MARA, text: script.witnessed(meta, success), about: [PLAYER] }],
    suggestions: script.suggestions,
  };

  // Mara watched: she thinks better or worse of the player for it, and a failure costs time the marsh uses.
  if (story.has('bonds')) {
    record.bonds = [{ character_id: MARA, change: success ? 4 : -2, reason: success ? script.bond.earned : script.bond.lost }];
  }
  if (story.has('clocks') && !success && world.modules.clocks?.clocks[CLOCK]) record.clocks = [{ id: CLOCK, tick: 1 }];
  // What came due while the time passed happens now, and is then settled.
  if (cameDue.length > 0) {
    record.calendar = { schedule: cameDue.map((entry) => ({ id: entry.id, status: 'done' })) };
    if (cameDue.some((entry) => entry.id === 'sched_lantern')) paragraphs.push(script.calendar.arrives);
  }

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
    record.memories?.push(
      { character_id: STRANGER, text: script.stranger.firstMemory, about: [PLAYER], importance: 3 },
      { character_id: MARA, text: script.stranger.seenByMara, about: [STRANGER], importance: 4 },
    );
    if (canDraw) record.pictures = [{ subject: 'character', id: STRANGER, ...script.art.stranger }];
  }

  return { text: paragraphs.join('\n\n'), record };
}

/**
 * A character answering the player. Which line they give depends on how much
 * history they have with the player, read from their own memories: the more
 * they have seen of you, the further they open up, and the same question asked
 * twice does not get the same answer.
 */
function answer(meta: TurnMeta, script: Script, feelsBond: boolean): ScriptedStep {
  const character = meta.characterId ? meta.world.characters[meta.characterId] : undefined;
  if (!character) return {};
  const said = meta.playerText;
  // Being asked, and heard out, draws anyone a little closer.
  const bond = feelsBond ? { bond: { change: 2, reason: script.bond.talked } } : {};

  if (character.id === MARA && said.toLowerCase().includes(script.cellar.word)) {
    const { line, remember, intent } = script.cellar;
    return { respond: { text: line, memory: remember, importance: 4, changes: intent, ...bond } };
  }

  const part = script.parts[character.id] ?? script.anyone(character);
  const history = character.memories.filter((memory) => memory.about.includes(PLAYER)).length;
  const index = Math.min(Math.max(history - 1, 0), part.lines.length - 1);
  return {
    respond: {
      text: part.lines[index] ?? '',
      memory: part.remember(said),
      importance: 2,
      attitude: part.attitudes[Math.min(index, part.attitudes.length - 1)],
      ...bond,
    },
  };
}

/** The game master's ruling after Mara hands over the key. */
function rule(script: Script): ScriptedStep {
  return {
    text: script.cellar.outcome,
    record: {
      items: [{ id: 'item_cellar_key', ...script.cellar.key }],
      quests: [{ id: QUEST, progress: script.cellar.progress }],
      suggestions: script.suggestions,
    },
  };
}

/** What the script can tell of the story's modules from the tools it was handed. */
interface StoryModules {
  /** Whether the story has this module: by its section of the record, or by one of its tools. */
  has(id: string): boolean;
  /** True on the turn the game master is asked which modules the story keeps. */
  choosing: boolean;
  /** The modules it may choose among. */
  offered: string[];
}

const MODULE_TOOLS: Record<string, string> = {
  oracle: 'ask_fate',
  sandbox: 'simulate',
  combat: 'fight',
  calendar: 'pass_time',
  court: 'hold_court',
  lineage: 'nurture_heir',
  domain: 'develop_domain',
  espionage: 'run_operation',
  progression: 'breakthrough',
};

function readModules(init: ConversationInit): StoryModules {
  const names = new Set(init.tools.map((tool) => tool.name));
  const record = init.tools.find((tool) => tool.name === 'record');
  const sections = (record?.inputSchema.properties ?? {}) as Record<string, { items?: { enum?: string[] } }>;
  return {
    has: (id) => id in sections || names.has(MODULE_TOOLS[id] ?? ''),
    choosing: 'modules' in sections,
    offered: sections.modules?.items?.enum ?? [],
  };
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
  /** Names of the tools on offer, which is how the script knows the story's modules. */
  private readonly offered: Set<string>;
  private readonly story: StoryModules;
  /** Whether a character's reply may say how the exchange moved them (the bonds module). */
  private readonly feelsBond: boolean;
  private readonly onBoard: boolean;
  private stepIndex = 0;
  private results: ToolResult[] = [];

  constructor(init: ConversationInit, delayMs: number) {
    this.meta = init.meta;
    this.delayMs = delayMs;
    // Pictures are a section of `record` only when something can paint.
    const record = init.tools.find((tool) => tool.name === 'record');
    const sections = (record?.inputSchema.properties as object | undefined) ?? {};
    this.canDraw = 'pictures' in sections;
    this.offered = new Set(init.tools.map((tool) => tool.name));
    this.story = readModules(init);
    const respond = init.tools.find((tool) => tool.name === 'respond');
    this.feelsBond = 'bond' in ((respond?.inputSchema.properties as object | undefined) ?? {});
    // The board story is told once a board exists. It is begun when a board is
    // on offer and the premise asks for one (or there are no dice, so the board
    // is all the story has).
    const { world, seed } = init.meta;
    this.onBoard =
      world.modules.sandbox !== undefined ||
      (world.turn === 0 && this.offered.has('simulate') && (BOARD_PREMISE.test(seed.premise) || !this.offered.has('roll_dice')));
  }

  private script(): ScriptedStep {
    const script = SCRIPTS[this.meta.locale];
    const first = this.stepIndex === 0;
    switch (this.meta.kind) {
      case 'start':
        if (!first) return {};
        return this.onBoard ? openBoard(this.meta, this.story) : openGame(this.meta, script, this.canDraw, this.story);
      case 'talk':
        return first ? answer(this.meta, script, this.feelsBond) : {};
      case 'referee':
        return first ? rule(script) : {};
      case 'action':
        return this.act(script, first);
      case 'summary':
        return {};
    }
  }

  /**
   * An action turn takes two steps, like a real one: first whatever is not the
   * storyteller's to decide, then the telling. Without an instrument to wait
   * for, the telling is the first step.
   */
  private act(script: Script, first: boolean): ScriptedStep {
    if (this.onBoard) {
      // With the sandbox switched off mid-story there is nothing to hand over: the season is simply told.
      const sandbox = this.offered.has('simulate');
      if (first && sandbox) return { simulate: boardOrders(this.meta) };
      return this.stepIndex === (sandbox ? 1 : 0) ? boardOutcome(this.meta, this.results, sandbox) : {};
    }
    // A fight, once on, is fought to the end; one begins when the player goes for a weapon.
    const fighting = this.offered.has('fight') && (this.meta.world.modules.combat?.active === true || script.combat.words.test(this.meta.playerText));
    if (fighting) {
      if (first) return { fight: fightRound(this.meta, script) };
      return this.stepIndex === 1 ? resolveFight(script, this.results) : {};
    }
    // Something the player wonders about is a question for the oracle; anything else they attempt is a check.
    const wonders = /[?？]/.test(this.meta.playerText) && this.offered.has('ask_fate');
    const instrument: ScriptedStep | undefined = wonders
      ? { fate: { question: this.meta.playerText, odds: 'even' } }
      : this.offered.has('check')
        ? // The number is passed along for stories begun before the sheet had this stat.
          { check: { stat: script.wits, value: 2, difficulty: 'normal', reason: script.rollReason } }
        : this.offered.has('roll_dice')
          ? { roll: { notation: 'd20', reason: script.rollReason } }
          : undefined;
    // Whatever the player does takes a couple of hours of the evening.
    const passing: ScriptedStep = this.offered.has('pass_time') ? { pass: { hours: 2, reason: script.calendar.passing } } : {};
    const instruments: ScriptedStep | undefined = instrument || passing.pass ? { ...instrument, ...passing } : undefined;
    if (first && instruments) return instruments;
    return this.stepIndex === (instruments ? 1 : 0)
      ? resolveAction(this.meta, script, this.results, this.canDraw, this.story)
      : {};
  }

  async step(handlers: StepHandlers): Promise<StepResult> {
    const step = this.script();
    const index = this.stepIndex++;

    // In the order a real model is asked to work: dice, then the telling, then the record.
    const calls: { name: string; input: unknown }[] = [];
    if (step.roll) calls.push({ name: 'roll_dice', input: step.roll });
    if (step.check) calls.push({ name: 'check', input: step.check });
    if (step.fate) calls.push({ name: 'ask_fate', input: step.fate });
    if (step.pass) calls.push({ name: 'pass_time', input: step.pass });
    if (step.fight) calls.push({ name: 'fight', input: step.fight });
    if (step.simulate) calls.push({ name: 'simulate', input: step.simulate });
    if (step.respond) calls.push({ name: 'respond', input: step.respond });
    if (step.text) calls.push({ name: 'narrate', input: { text: step.text } });
    if (step.record) calls.push({ name: 'record', input: step.record });
    const toolCalls = calls.map((call, i) => ({ id: `mock_${index}_${i}`, ...call }));

    // Stream what the player reads the way a real model does: as fragments of
    // the tool call's JSON input, a few characters at a time.
    const spoken = toolCalls.find((call) => call.name === 'narrate' || call.name === 'respond');
    if (spoken) {
      const json = JSON.stringify(spoken.input);
      for (let i = 0; i < json.length; i += 5) {
        if (handlers.signal.aborted) throw new AppError('aborted', 'The request was cancelled.');
        if (this.delayMs > 0) await sleep(this.delayMs, handlers.signal);
        handlers.onToolInput({ id: spoken.id, name: spoken.name }, json.slice(i, i + 5));
      }
    }

    return { text: '', toolCalls, stop: toolCalls.length > 0 ? 'tool_use' : 'end', usage: { ...NO_USAGE } };
  }

  submitToolResults(results: ToolResult[]): void {
    this.results = results;
  }

  addUserMessage(): void {
    // The script always tells and records, so it is never reminded to.
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
