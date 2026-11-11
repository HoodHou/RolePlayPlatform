import { CLOCK_SEGMENTS, type Clock, type WorldEvent, type WorldState } from '@roleplay/shared';
import { z } from 'zod';
import { eachEntry, id, type EntryError } from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * Progress clocks: a circle cut into segments that fills as something
 * approaches. The guards closing in, the ritual nearing completion, the bridge
 * being rebuilt. They make "how close is it?" something the player can see and
 * the game master cannot quietly forget. Bookkeeping only: there is nothing
 * here for the server to work out, so the module has no tool of its own.
 */

const DEFAULT_SEGMENTS = 6;

const clockEntry = z.strictObject({
  id,
  name: z.string().optional().describe('What is approaching, as the player reads it, e.g. "The guards close in". Required when creating.'),
  description: z.string().optional().describe('What happens when it fills.'),
  segments: z
    .number()
    .int()
    .min(CLOCK_SEGMENTS.min)
    .max(CLOCK_SEGMENTS.max)
    .optional()
    .describe('How many steps until it happens: 4 for something close, 6 or 8 for something that builds. Set when creating; defaults to 6.'),
  tick: z
    .number()
    .int()
    .min(-CLOCK_SEGMENTS.max)
    .max(CLOCK_SEGMENTS.max)
    .optional()
    .describe('Fill this many more segments; negative to undo progress.'),
  filled: z.number().int().min(0).max(CLOCK_SEGMENTS.max).optional().describe('Or set how many segments are filled outright.'),
  hidden: z.boolean().optional().describe('True keeps the clock from the player: a countdown of your own. Set it to false to reveal it.'),
  remove: z.boolean().optional().describe('True when the clock no longer applies: averted, or filled and dealt with.'),
});

const clocksSection = z
  .array(clockEntry)
  .max(12)
  .describe('Progress clocks to start, advance or put away. Start one when something begins to approach; tick it each time the story brings it closer; when the last segment fills, what it was counting toward happens this turn.');

function upsertClock(world: WorldState, entry: z.infer<typeof clockEntry>): WorldEvent[] {
  const state = world.modules.clocks;
  const existing = state?.clocks[entry.id];

  if (entry.remove) {
    if (!existing || !state) throw new WorldOpError(`There is no clock with id "${entry.id}".`);
    delete state.clocks[entry.id];
    return [];
  }

  const name = entry.name?.trim();
  if (!existing && !name) throw new WorldOpError(`Clock "${entry.id}" does not exist yet. Include "name" to start it.`);

  const clock: Clock = existing ?? {
    id: entry.id,
    name: name ?? '',
    description: '',
    segments: entry.segments ?? DEFAULT_SEGMENTS,
    filled: 0,
    hidden: false,
  };
  const before = { filled: clock.filled, hidden: clock.hidden };

  if (existing && name) clock.name = name;
  if (entry.description !== undefined) clock.description = entry.description;
  // A clock's size is part of what it means, so it only grows or shrinks on purpose.
  if (existing && entry.segments !== undefined) clock.segments = entry.segments;
  if (entry.hidden !== undefined) clock.hidden = entry.hidden;
  const wanted = entry.filled ?? clock.filled + (entry.tick ?? 0);
  clock.filled = Math.min(Math.max(wanted, 0), clock.segments);

  (world.modules.clocks ??= { clocks: {} }).clocks[clock.id] = clock;

  // The player is told nothing of a clock they cannot see.
  if (clock.hidden) return [];
  // New to the player: just started, or just revealed.
  if (!existing || before.hidden) {
    return [{ type: 'clock_started', id: clock.id, name: clock.name, segments: clock.segments, filled: clock.filled }];
  }
  if (clock.filled === before.filled) return [];
  return [{ type: 'clock_ticked', id: clock.id, name: clock.name, from: before.filled, to: clock.filled, segments: clock.segments }];
}

function applyClocks(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  return eachEntry(section, 'clocks', clockEntry, errors, (entry) => upsertClock(world, entry));
}

const en = `## Progress clocks

You have progress clocks: circles cut into segments that fill as something approaches. Use one whenever "how close is it?" matters and should not be left to feel: a danger closing in (the guards find the trail, the fever worsens), a rival's plan ripening, a long task the player is working at (forging the blade, winning the guild's trust).

Start a clock under clocks in the record with a name and a size: 4 segments for something near, 6 for the usual, 8 or more for something slow. Tick it whenever the story brings it closer: a failed attempt, time wasted, a deliberate step taken. When the last segment fills, what the clock was counting toward happens in that same turn; then put the clock away with remove.

The player sees every clock that is not hidden, and seeing it fill is the point: it tells them what their choices are costing. Keep a clock hidden only when the player's character could not know the thing is coming.`;

const zh = `## 进度钟

你有进度钟：分成若干格的圆，随着某件事的逼近一格格填满。凡是“还有多近”这件事要紧、不该只凭感觉时就用它：步步逼近的危险（守卫循迹而来、热病加重），对手正在成熟的计划，或者玩家正在下功夫的长期事务（打造一把剑、取得行会的信任）。

在 record 的 clocks 里开一个钟，写上名字和格数：近在眼前的用 4 格，一般用 6 格，慢慢酝酿的用 8 格或更多。每当剧情让它更近一步就填格：一次失败、白白耗掉的时间、有意迈出的一步。最后一格填满时，它所指向的事就在这一回合发生；之后用 remove 把钟收起来。

没有隐藏的钟玩家都看得见，让玩家看着它填满正是用意所在：这让他们知道自己的选择付出了什么。只有当玩家的角色不可能知道这件事正在逼近时，才把钟隐藏起来。`;

const tickClockOpSchema = z.strictObject({
  id,
  delta: z.number().int().min(-CLOCK_SEGMENTS.max).max(CLOCK_SEGMENTS.max).optional(),
  remove: z.boolean().optional(),
});

function operateClocks(
  world: WorldState,
  op: string,
  params: Record<string, unknown>,
): { events: WorldEvent[]; summary: string } {
  if (op === 'tick_clock') {
    const parsed = tickClockOpSchema.safeParse(params);
    if (!parsed.success) throw new WorldOpError(z.prettifyError(parsed.error));
    const existing = world.modules.clocks?.clocks[parsed.data.id];
    if (!existing) throw new WorldOpError(`There is no clock with id "${parsed.data.id}".`);
    const name = existing.name;
    const events = upsertClock(world, {
      id: parsed.data.id,
      tick: parsed.data.delta,
      remove: parsed.data.remove,
    });
    if (parsed.data.remove) return { events, summary: `结案移除进度钟【${name}】` };
    const updated = world.modules.clocks?.clocks[parsed.data.id];
    return {
      events,
      summary: `调整进度钟【${name}】（${updated?.filled ?? existing.filled}/${updated?.segments ?? existing.segments}）`,
    };
  }
  throw new WorldOpError(`Unknown clocks operation "${op}".`);
}

export const clocksModule: GameModule = {
  id: 'clocks',
  // A list in the record and a few lines of instruction: cheap enough to carry in any story.
  keptWhenUnused: true,
  hasPanel: true,
  tools: [],
  record: { schema: clocksSection, apply: applyClocks },
  guide: { en, zh },
  operate: operateClocks,
};
