import { FATE_CHANCE, FATE_ODDS, FATE_TWISTS, type FateAnswer, type FateOdds, type FateTwist } from '@roleplay/shared';
import { z } from 'zod';
import { invalidInput, toJsonSchema, type GameTool } from '../toolKit';
import type { GameModule } from './types';

/**
 * The oracle, borrowed from solo role-playing: when the story turns on a
 * question that nothing recorded settles and no character's skill decides (is
 * the bridge still standing? does the patrol come this way?), the game master
 * asks fate instead of picking the answer it finds most convenient. Now and
 * then fate also throws in something nobody asked for.
 */

export const ASK_FATE = 'ask_fate';

export interface FateReading {
  chance: number;
  roll: number;
  answer: FateAnswer;
  twist: FateTwist | null;
}

/**
 * Asks once. A d100 at or under the chance is a yes. The fifth of each band
 * furthest from the line is the answer "and then some"; the fifth nearest the
 * line is the answer "with a catch". A double (11, 22, ... 99) adds a twist.
 */
export function readFate(odds: FateOdds, random: () => number): FateReading {
  const chance = FATE_CHANCE[odds];
  const roll = Math.floor(random() * 100) + 1;
  const yesEdge = Math.max(Math.floor(chance / 5), 1);
  const noEdge = Math.max(Math.floor((100 - chance) / 5), 1);

  let answer: FateAnswer;
  if (roll <= chance) answer = roll <= yesEdge ? 'yes_and' : roll > chance - yesEdge ? 'yes_but' : 'yes';
  else answer = roll > 100 - noEdge ? 'no_and' : roll <= chance + noEdge ? 'no_but' : 'no';

  const double = roll < 100 && roll % 11 === 0;
  const twist = double ? (FATE_TWISTS[Math.floor(random() * FATE_TWISTS.length)] ?? null) : null;
  return { chance, roll, answer, twist };
}

// Told to the game master with the answer, so that a model that has never met
// an oracle still knows what to do with one.
const ANSWER_MEANS: Record<FateAnswer, string> = {
  yes_and: 'Yes, and more than hoped: something extra goes the asker\'s way.',
  yes: 'Yes.',
  yes_but: 'Yes, but with a catch, a cost or a limit.',
  no_but: 'No, but something softens it or opens another way.',
  no: 'No.',
  no_and: 'No, and it is worse than feared.',
};

const TWIST_MEANS: Record<FateTwist, string> = {
  new_arrival: 'Someone or something new enters the scene.',
  old_thread: 'Something from earlier in the story comes back.',
  loss: 'Something is lost, broken or used up.',
  windfall: 'An unlooked-for piece of luck.',
  betrayal: 'Someone turns out not to be on the side they seemed.',
  escalation: 'The danger or the stakes grow.',
  reversal: 'The situation flips: the strong are weak, the hunter is hunted.',
  revelation: 'A secret or a hidden fact comes to light.',
  delay: 'Something takes longer or is held up.',
  omen: 'A sign of what is coming, unsettling or hopeful.',
  rival_moves: 'Someone working against the player makes a move of their own.',
  respite: 'A moment of calm, shelter or kindness.',
};

const askSchema = z.strictObject({
  question: z.string().min(1).describe('A yes-or-no question about the world, in the story language. Shown to the player.'),
  odds: z
    .enum(FATE_ODDS)
    .optional()
    .describe('How likely a yes is, judged from what is already established. Defaults to even.'),
});

const askTool: GameTool = {
  name: ASK_FATE,
  silent: false,
  records: false,
  endsTurn: false,
  run(_world, input, ctx) {
    const parsed = askSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error, input);
    const odds = parsed.data.odds ?? 'even';
    const reading = readFate(odds, ctx.random);
    return {
      content: JSON.stringify({
        roll: reading.roll,
        chance: reading.chance,
        answer: reading.answer,
        means: ANSWER_MEANS[reading.answer],
        ...(reading.twist ? { twist: reading.twist, twist_means: `${TWIST_MEANS[reading.twist]} Work it into this turn.` } : {}),
      }),
      isError: false,
      events: [{ type: 'fate_asked', question: parsed.data.question, odds, ...reading }],
    };
  },
};

const en = `## Oracle

You have an oracle. When the story turns on a yes-or-no question about the world that nothing recorded settles and that is nobody's skill to decide (is the bridge still standing? does the patrol pass this way? is the letter still in the drawer?), put it to fate with ask_fate instead of choosing the answer yourself. Say how likely a yes is from what is already established, and tell the story from the answer you get.

The answer may come with "and" (more than asked) or "but" (with a catch). Now and then it comes with a twist: something nobody asked for, which you work into the same turn.

Keep it for questions whose answer would change what happens next. What a character attempts is a matter for the dice, if this story has them; what you have already recorded is simply true.`;

const zh = `## 命运神谕

你有一位神谕。当故事的走向取决于一个关于世界的是非问题，而已有的记录定不了它、也轮不到谁的本事来决定时（桥还在不在？巡逻队会不会从这儿过？那封信还在抽屉里吗？），用 ask_fate 去问命运，不要自己挑答案。按已经确立的情况说明“是”的可能性有多大，然后按得到的答案讲故事。

答案可能带“而且”（比所问的更进一步），也可能带“但是”（附带条件或代价）。偶尔还会附上一个转折：谁也没问到的事，由你编进同一回合。

只在答案会改变接下来发生的事时才问。人物尝试做什么，由骰子决定（如果本故事配了骰子）；你已经记录下来的事，就是事实。`;

export const oracleModule: GameModule = {
  id: 'oracle',
  // It keeps nothing and its one tool is small.
  keptWhenUnused: true,
  hasPanel: false,
  tools: [
    {
      tool: askTool,
      spec: {
        name: ASK_FATE,
        description:
          'Put a yes-or-no question about the world to fate when nothing recorded settles it and it is no character\'s skill to decide. The server rolls against the odds you give and answers yes or no, sometimes with "and" or "but", sometimes with a twist to weave in. Call it before narrating what depends on the answer. The question and the answer are shown to the player.',
        inputSchema: toJsonSchema(askSchema),
      },
    },
  ],
  guide: { en, zh },
};
