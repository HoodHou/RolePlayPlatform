import {
  CHECK_DIFFICULTIES,
  DICE_SYSTEMS,
  type Character,
  type CheckDifficulty,
  type CheckOutcome,
  type DiceSystem,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { rollDice } from '../dice';
import { asParts, entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool } from '../toolKit';
import type { GameModule } from './types';

/**
 * Dice, for tabletop-style play: plain rolls, and checks against a character's
 * sheet that the server rolls and judges under one of a few familiar rule sets.
 * The game master says what is attempted and how hard it is; it does not get
 * to pick the number.
 */

export const ROLL_DICE = 'roll_dice';
export const CHECK = 'check';

const DEFAULT_SYSTEM: DiceSystem = 'd20';

// --- the rules ----------------------------------------------------------------

export interface CheckInput {
  /** The stat tested: a bonus under d20 and 2d6, a percentage under d100. */
  value: number;
  difficulty: CheckDifficulty;
  /** A one-off adjustment for the circumstances. */
  modifier: number;
  edge?: 'advantage' | 'disadvantage';
}

export interface CheckResult {
  rolls: number[];
  kept: number[];
  bonus: number;
  total: number;
  target: number;
  outcome: CheckOutcome;
}

const D20_TARGET: Record<CheckDifficulty, number> = { easy: 8, normal: 12, hard: 16, extreme: 20 };
const TWO_D6_SHIFT: Record<CheckDifficulty, number> = { easy: 1, normal: 0, hard: -1, extreme: -2 };

const die = (sides: number, random: () => number) => Math.floor(random() * sides) + 1;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function d20(input: CheckInput, random: () => number): CheckResult {
  const rolls = input.edge ? [die(20, random), die(20, random)] : [die(20, random)];
  const natural = input.edge === 'disadvantage' ? Math.min(...rolls) : Math.max(...rolls);
  const bonus = input.value + input.modifier;
  const total = natural + bonus;
  const target = D20_TARGET[input.difficulty];
  const outcome = natural === 20 ? 'critical' : natural === 1 ? 'fumble' : total >= target ? 'success' : 'failure';
  return { rolls, kept: [natural], bonus, total, target, outcome };
}

function d100(input: CheckInput, random: () => number): CheckResult {
  const rolls = input.edge ? [die(100, random), die(100, random)] : [die(100, random)];
  // Rolling under: the lower die is the better one.
  const roll = input.edge === 'advantage' ? Math.min(...rolls) : Math.max(...rolls);
  const chance = {
    easy: input.value + 20,
    normal: input.value,
    hard: Math.floor(input.value / 2),
    extreme: Math.floor(input.value / 5),
  }[input.difficulty];
  const target = Math.min(Math.max(chance + input.modifier, 1), 99);
  // A fumble is harder to avoid for the unskilled.
  const fumbled = roll === 100 || (roll >= 96 && target < 50);
  const outcome = roll === 1 ? 'critical' : fumbled ? 'fumble' : roll <= target ? 'success' : 'failure';
  return { rolls, kept: [roll], bonus: 0, total: roll, target, outcome };
}

function twoD6(input: CheckInput, random: () => number): CheckResult {
  const rolls = Array.from({ length: input.edge ? 3 : 2 }, () => die(6, random));
  const sorted = [...rolls].sort((a, b) => a - b);
  const kept = input.edge === 'disadvantage' ? sorted.slice(0, 2) : sorted.slice(-2);
  const natural = sum(kept);
  const bonus = input.value + input.modifier + TWO_D6_SHIFT[input.difficulty];
  const total = natural + bonus;
  const outcome =
    natural === 12 ? 'critical' : natural === 2 ? 'fumble' : total >= 10 ? 'success' : total >= 7 ? 'partial' : 'failure';
  return { rolls, kept, bonus, total, target: 10, outcome };
}

const SYSTEMS: Record<DiceSystem, (input: CheckInput, random: () => number) => CheckResult> = {
  d20,
  d100,
  '2d6': twoD6,
};

/** Rolls one check under the given rules and judges it. */
export function resolveCheck(system: DiceSystem, input: CheckInput, random: () => number): CheckResult {
  return SYSTEMS[system](input, random);
}

// --- roll_dice ----------------------------------------------------------------

const rollDiceSchema = z.strictObject({
  notation: z.string().describe('Dice notation such as "d20", "2d6" or "3d8+2".'),
  reason: z.string().describe('What the roll decides, in the story language. Shown to the player.'),
});

const rollDiceTool: GameTool = {
  name: ROLL_DICE,
  silent: false,
  records: false,
  endsTurn: false,
  run(_world, input, ctx) {
    const parsed = rollDiceSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error, input);
    const roll = rollDice(parsed.data.notation, ctx.random);
    if (!roll) {
      const content = `Cannot read dice notation "${parsed.data.notation}". Use NdM, NdM+K or NdM-K.`;
      return { content, isError: true, events: [] };
    }
    return {
      content: JSON.stringify({ rolls: roll.rolls, modifier: roll.modifier, total: roll.total }),
      isError: false,
      events: [{ type: 'dice_rolled', ...roll, reason: parsed.data.reason }],
    };
  },
};

// --- check --------------------------------------------------------------------

const checkSchema = z.strictObject({
  character_id: id.optional().describe('Who makes the attempt. Defaults to the player character.'),
  stat: z
    .string()
    .optional()
    .describe('The stat on their sheet that is being tested, by the name it is recorded under, e.g. "Stealth", "侦查". Its number is what the dice are rolled against.'),
  value: z
    .number()
    .optional()
    .describe('The number to use when the sheet has no such stat: a bonus under d20 or 2d6, a percentage under d100.'),
  difficulty: z.enum(CHECK_DIFFICULTIES).optional().describe('How hard the attempt is. Defaults to normal.'),
  modifier: z
    .number()
    .int()
    .min(-50)
    .max(50)
    .optional()
    .describe('A one-off bonus or penalty for the circumstances: added to the roll under d20 and 2d6, to the percentage under d100.'),
  edge: z
    .enum(['advantage', 'disadvantage'])
    .optional()
    .describe('Rolls an extra die and keeps the better (advantage) or the worse (disadvantage).'),
  reason: z.string().describe('What is being attempted, in the story language. Shown to the player.'),
});

/** The numeric stat of that name on the sheet, however the game master capitalised it. */
function numericStat(character: Character, name: string): { name: string; value: number } | undefined {
  const wanted = name.trim().toLowerCase();
  const stat = character.stats.find((entry) => entry.name.trim().toLowerCase() === wanted);
  return typeof stat?.value === 'number' ? { name: stat.name, value: stat.value } : undefined;
}

const checkTool: GameTool = {
  name: CHECK,
  silent: false,
  records: false,
  endsTurn: false,
  run(world, input, ctx) {
    const parsed = checkSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error, input);
    const { stat, reason } = parsed.data;
    const fail = (content: string) => ({ content, isError: true, events: [] });

    const characterId = parsed.data.character_id ?? world.playerId;
    const character = characterId ? world.characters[characterId] : undefined;
    if (!character) {
      return fail(
        characterId
          ? `There is no character with id "${characterId}".`
          : 'There is no player character yet. Record them first, or pass character_id.',
      );
    }

    const system = world.modules.dice?.system ?? DEFAULT_SYSTEM;
    const onSheet = stat ? numericStat(character, stat) : undefined;
    const value = onSheet?.value ?? parsed.data.value;
    if (value === undefined && (stat || system === 'd100')) {
      const numeric = character.stats.filter((entry) => typeof entry.value === 'number').map((entry) => entry.name);
      return fail(
        `${character.name} has no numeric stat${stat ? ` "${stat}"` : ''} to roll against under ${system}. Their numeric stats: ${numeric.join(', ') || 'none'}. Name one of those, or pass value.`,
      );
    }

    const difficulty = parsed.data.difficulty ?? 'normal';
    const check = { value: value ?? 0, difficulty, modifier: parsed.data.modifier ?? 0, edge: parsed.data.edge };
    const result = resolveCheck(system, check, ctx.random);
    // The first check fixes the rules for the story, so the badge the player sees is true.
    world.modules.dice ??= { system };

    return {
      content: JSON.stringify({ system, ...result }),
      isError: false,
      events: [
        {
          type: 'check_rolled',
          characterId: character.id,
          characterName: character.name,
          isPlayer: character.isPlayer,
          stat: onSheet?.name ?? stat?.trim() ?? '',
          system,
          difficulty,
          ...result,
          reason,
        },
      ],
    };
  },
};

// --- record.dice --------------------------------------------------------------

const system = z.enum(DICE_SYSTEMS).describe(
  'The dice rules checks are rolled by. d20: d20 + stat against a difficulty, for heroic adventure; stats are bonuses from -1 to +6. d100: roll at or under the stat, for investigation and horror; stats are percentages from 1 to 99. 2d6: 2d6 + stat, 10 or more succeeds and 7 to 9 succeeds at a cost, for drama-driven stories; stats run from -1 to +3.',
);

const diceSection = z
  .strictObject({ system: system.optional() })
  .describe('The rules of the dice. Set the system when the story begins, together with stats that fit it; leave it alone afterwards.');

function applyDice(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'dice', errors);
  if (!parts) return [];
  const reader = entryReader(parts, 'dice.', errors, []);
  reader.one('system', system, (chosen) => {
    world.modules.dice = { system: chosen };
    return [];
  });
  reader.rejectUnknown(['system'], 'field');
  return [];
}

// --- what the game master is told ---------------------------------------------

const en = `## Dice and checks

You have dice, for tabletop-style play. When the outcome of an action is genuinely uncertain and failing would matter, let the dice decide instead of deciding yourself. Routine and impossible actions need no roll. Roll before you narrate: the result comes back to you, and then you tell what it means.

- check tests one of a character's stats under this story's dice rules and judges the result for you: critical, success, partial (success at a cost), failure or fumble. Use it whenever a stat on the sheet applies, and name the stat exactly as it is recorded.
- roll_dice rolls plain dice for everything else: damage, a chance event, how many guards are on the wall.

Choose the dice rules in the opening record (dice.system) and give characters stats that fit them:
- d20, for heroic adventure. Stats are bonuses from -1 to +6. d20 + stat must meet 8 (easy), 12 (normal), 16 (hard) or 20 (extreme).
- d100, for investigation and horror. Stats are percentages from 1 to 99, and the roll must come in at or under. Hard halves the chance; extreme leaves a fifth.
- 2d6, for drama-driven stories. Stats run from -1 to +3. 10 or more succeeds, 7 to 9 succeeds at a cost, 6 or less fails.

Honour the result. A failure takes the story somewhere worse or sideways; it is never just "nothing happens".`;

const zh = `## 骰子与检定

你手里有骰子，可以像跑团那样主持。当一个行动的结果确实说不准、而且失败会带来后果时，交给骰子，不要自己拍板。稀松平常的事和根本做不到的事都不用掷。先掷骰再叙述：结果会先回到你手里，再由你讲出它意味着什么。

- check：按本故事的骰子规则检定人物的某项属性，并替你判定结果：大成功（critical）、成功（success）、勉强成功即成功但有代价（partial）、失败（failure）、大失败（fumble）。只要人物卡上有对应的属性就用它，属性名要与记录的写法完全一致。
- roll_dice：其余情况掷普通骰子：伤害、偶发事件、城墙上有几个守卫。

在开场的 record 里选定骰子规则（dice.system），并给人物配上与之相称的属性：
- d20，适合英雄冒险。属性是加值，-1 到 +6。d20 + 属性需要达到 8（简单）、12（普通）、16（困难）或 20（极难）。
- d100，适合调查与恐怖。属性是百分比，1 到 99，掷出的点数不超过它才算成功。困难时成功率减半，极难时只剩五分之一。
- 2d6，适合重剧情的故事。属性在 -1 到 +3 之间。10 及以上成功，7 到 9 成功但有代价，6 及以下失败。

尊重骰子的结果。失败应当把故事带向更糟或意想不到的方向，而不是“什么也没发生”。`;

export const diceModule: GameModule = {
  id: 'dice',
  // Any story can come to a moment that wants a roll.
  keptWhenUnused: true,
  hasPanel: false,
  tools: [
    {
      tool: rollDiceTool,
      spec: {
        name: ROLL_DICE,
        description:
          'Roll plain dice to decide something uncertain that no stat covers: damage, a chance event, a number. Call it before narrating the result and let the roll decide. The result comes back to you and is shown to the player.',
        inputSchema: toJsonSchema(rollDiceSchema),
      },
    },
    {
      tool: checkTool,
      spec: {
        name: CHECK,
        description:
          'Test one of a character\'s stats when they attempt something uncertain. The server rolls under this story\'s dice rules and judges the result: critical, success, partial (success at a cost), failure or fumble. Call it before narrating the attempt and tell the story from the outcome. The roll is shown to the player.',
        inputSchema: toJsonSchema(checkSchema),
      },
    },
  ],
  record: { schema: diceSection, apply: applyDice },
  guide: { en, zh },
};
