import {
  dayPart,
  HOURS_PER_DAY,
  type CalendarState,
  type ScheduledEvent,
  type ScheduleStatus,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { z } from 'zod';
import { asParts, entryReader, id, invalidInput, toJsonSchema, type EntryError, type GameTool } from '../toolKit';
import { WorldOpError } from '../world';
import type { GameModule } from './types';

/**
 * The calendar, for stories where time matters: deadlines, journeys,
 * appointments, things that happen whether or not the player is there to see
 * them. It keeps a clock for the world (a day counted from 1, and an hour) and
 * a schedule of what is set to happen when. The game master keeps the schedule
 * through `record.calendar`; time passing goes through `pass_time`, which says
 * what came due along the way, because a storyteller forgets that the ship
 * sails at dawn on day 3 and the server does not.
 */

export const PASS_TIME = 'pass_time';

// Far beyond any story's span, and far short of where the arithmetic would strain.
const DAY_LIMIT = 100_000;

/** How many of the entries still ahead pass_time lists. */
const AHEAD = 5;

// --- time ---------------------------------------------------------------------

/** A reading of the clock. */
export interface Moment {
  day: number;
  hour: number;
}

/** When something falls: a day, and an hour or null for "some time that day". */
export type When = Pick<ScheduledEvent, 'day' | 'hour'>;

/** Where the clock stands when time passes before the game master ever set it. */
const START: Moment = { day: 1, hour: 8 };

/** Hours since the start of day 1: what moments are compared and subtracted by. */
const hoursOf = (moment: Moment) => (moment.day - 1) * HOURS_PER_DAY + moment.hour;

/** The moment `hours` after `from`, rolling over midnight into the days that follow. */
export function addHours(from: Moment, hours: number): Moment {
  const total = hoursOf(from) + hours;
  return { day: Math.floor(total / HOURS_PER_DAY) + 1, hour: ((total % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY };
}

/** Hours from one moment to another; negative when `to` is the earlier. */
export function hoursBetween(from: Moment, to: Moment): number {
  return hoursOf(to) - hoursOf(from);
}

/** The moment something comes due: its hour on its day, or, for "some time that day", the moment that day is over. */
export function comesDueAt(when: When): Moment {
  return when.hour === null ? { day: when.day + 1, hour: 0 } : { day: when.day, hour: when.hour };
}

/** Whether, with the clock at `now`, the time of `when` has come. */
export function isDue(when: When, now: Moment): boolean {
  return hoursBetween(comesDueAt(when), now) >= 0;
}

const byDueTime = (a: When, b: When) => hoursOf(comesDueAt(a)) - hoursOf(comesDueAt(b));

/** The pending entries whose time has come at `now`, in the order they came due. */
export function comingDue(schedule: Record<string, ScheduledEvent>, now: Moment): ScheduledEvent[] {
  return Object.values(schedule)
    .filter((entry) => entry.status === 'pending' && isDue(entry, now))
    .sort(byDueTime);
}

const clockFace = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const nowText = (now: Moment) => `day ${now.day}, ${clockFace(now.hour)}`;
const whenText = (when: When) => (when.hour === null ? `day ${when.day}, some time that day` : nowText({ day: when.day, hour: when.hour }));

// --- the calendar -------------------------------------------------------------

function freshCalendar(): CalendarState {
  return { ...START, schedule: {} };
}

const nowOf = (calendar: CalendarState): Moment => ({ day: calendar.day, hour: calendar.hour });

/**
 * Moves the clock. Forward, every pending entry whose time has come becomes
 * due, and what the player can see of it is announced. Back, whatever came due
 * in the stretch being taken back is pending again: a stretch that was cut
 * short at the ambush did not reach the caravan's arrival after all.
 */
function moveClock(calendar: CalendarState, to: Moment, reason = ''): { cameDue: ScheduledEvent[]; events: WorldEvent[] } {
  const from = nowOf(calendar);
  calendar.day = to.day;
  calendar.hour = to.hour;
  if (hoursBetween(from, to) <= 0) {
    for (const entry of Object.values(calendar.schedule)) {
      if (entry.status === 'due' && !isDue(entry, to)) entry.status = 'pending';
    }
    return { cameDue: [], events: [] };
  }

  const cameDue = comingDue(calendar.schedule, to);
  for (const entry of cameDue) entry.status = 'due';
  const events: WorldEvent[] = [
    { type: 'time_passed', fromDay: from.day, fromHour: from.hour, toDay: to.day, toHour: to.hour, reason },
    // Hidden entries come due all the same; only the player is not told.
    ...cameDue.filter((entry) => !entry.hidden).map((entry): WorldEvent => ({ type: 'schedule_due', id: entry.id, title: entry.title })),
  ];
  return { cameDue, events };
}

function setClock(calendar: CalendarState, wanted: { day?: number; hour?: number }, established: boolean): WorldEvent[] {
  const to = { day: wanted.day ?? calendar.day, hour: wanted.hour ?? calendar.hour };
  // The first setting of the clock is where the story begins, not time passing.
  if (!established) {
    calendar.day = to.day;
    calendar.hour = to.hour;
    return [];
  }
  return moveClock(calendar, to).events;
}

// --- record.calendar ----------------------------------------------------------

const day = z.number().int().min(1).max(DAY_LIMIT);
const hour = z.number().int().min(0).max(HOURS_PER_DAY - 1);

/** What the game master may set; `due` is the server's to give. */
const SETTABLE = ['pending', 'done', 'cancelled'] as const satisfies readonly ScheduleStatus[];

const scheduleEntry = z.strictObject({
  id,
  title: z.string().optional().describe('What is set to happen, as the player reads it, e.g. "The Gull sails", "交出账本的期限". Required when creating.'),
  description: z.string().optional().describe('What happens then, and what follows if nobody is there to stop it.'),
  day: day.optional().describe('The day it falls on. Give the time one way only: day, in_days or in_hours.'),
  in_days: z.number().int().min(0).max(DAY_LIMIT).optional().describe('Or the number of days from today: 0 today, 1 tomorrow.'),
  in_hours: z.number().int().min(1).max(DAY_LIMIT).optional().describe('Or the number of hours from now. This sets the hour as well.'),
  hour: hour
    .nullable()
    .optional()
    .describe('With day or in_days: the hour, 0 to 23, or null for some time that day (it then comes due when the day is over). A new entry without one is null.'),
  hidden: z.boolean().optional().describe('True keeps it from the player: a rival\'s move, an ambush, a storm on the way. Set it to false to reveal it.'),
  status: z
    .enum(SETTABLE)
    .optional()
    .describe('done once the story has dealt with it; cancelled when it will no longer happen. The server sets due when its time comes. Giving an entry a new time puts it back to pending.'),
  remove: z.boolean().optional().describe('True takes it off the calendar altogether.'),
});

type ScheduleEntry = z.infer<typeof scheduleEntry>;

const CALENDAR_PARTS = {
  now: z
    .strictObject({
      day: day.optional().describe('The day, counted from 1 when the story began.'),
      hour: hour.optional().describe('The hour, 0 to 23: 0 midnight, 6 dawn, 12 noon, 18 dusk.'),
    })
    .describe('Sets the clock outright: where the story begins, or a jump the narration made ("three years later"). What you leave out stays as it is. Forward, whatever falls in between comes due; back, it only corrects the clock. For time passing in play, call pass_time instead.'),
  schedule: z
    .array(scheduleEntry)
    .max(20)
    .describe('What is set to happen when, to add or update: deadlines, meetings, departures, and what the player does not know is coming. Only the fields you pass change.'),
};

const calendarSection = z
  .strictObject({
    now: CALENDAR_PARTS.now.optional(),
    schedule: CALENDAR_PARTS.schedule.optional(),
  })
  .describe('The calendar: set the clock when the story begins, and keep the schedule of what is set to happen when. Leave it out of stories where the exact time does not matter.');

/**
 * The time an entry asks for, if it asks for one: by day, by days from today
 * or by hours from now. An hour on its own moves an existing entry within its
 * day; a new day keeps the hour the entry had.
 */
function timeOf(entry: ScheduleEntry, existing: ScheduledEvent | undefined, now: Moment): When | undefined {
  const ways = [entry.day, entry.in_days, entry.in_hours].filter((value) => value !== undefined).length;
  if (ways > 1) throw new WorldOpError('Give the time one way only: day, in_days or in_hours.');
  if (entry.in_hours !== undefined) {
    if (entry.hour !== undefined) {
      throw new WorldOpError('in_hours sets the hour itself. Leave hour out, or give day or in_days together with the hour instead.');
    }
    return addHours(now, entry.in_hours);
  }
  const onDay = entry.day ?? (entry.in_days === undefined ? undefined : now.day + entry.in_days);
  if (onDay === undefined) {
    if (entry.hour === undefined) return undefined;
    if (!existing) throw new WorldOpError('An hour needs a day as well: add day, or in_days (0 for today), or give in_hours instead.');
    return { day: existing.day, hour: entry.hour };
  }
  return { day: onDay, hour: entry.hour !== undefined ? entry.hour : (existing?.hour ?? null) };
}

function upsertEntry(calendar: CalendarState, entry: ScheduleEntry): WorldEvent[] {
  const existing = calendar.schedule[entry.id];
  if (entry.remove) {
    if (!existing) throw new WorldOpError(`There is nothing on the calendar with id "${entry.id}".`);
    delete calendar.schedule[entry.id];
    return [];
  }

  // Everything that can be wrong with the entry is checked before anything is
  // written, so an entry that is rejected leaves no trace on the calendar.
  const now = nowOf(calendar);
  const title = entry.title?.trim();
  const when = timeOf(entry, existing, now);
  if (!existing) {
    const missing = [...(title ? [] : ['"title"']), ...(when ? [] : ['a time (day, in_days or in_hours)'])];
    if (missing.length > 0) throw new WorldOpError(`"${entry.id}" is not on the calendar yet. Include ${missing.join(' and ')} to schedule it.`);
  }
  // Sent again at the time it already has (an entry restated in full), it has not moved.
  const moved = when !== undefined && (!existing || when.day !== existing.day || when.hour !== existing.hour);
  if (when && moved && isDue(when, now)) {
    const past = when.hour === null ? `Day ${when.day} is already over` : `Day ${when.day}, ${clockFace(when.hour)} has already come`;
    throw new WorldOpError(`${past}: it is now ${nowText(now)}. Schedule only what is still ahead; what is happening now, narrate.`);
  }
  if (existing && !moved && entry.status === 'pending' && isDue(existing, now)) {
    throw new WorldOpError(
      `The time of "${entry.id}" (${whenText(existing)}) has already come: it is now ${nowText(now)}. To put it off, give it a new time; to settle it, set done or cancelled.`,
    );
  }

  const wasAnnounced = existing !== undefined && !existing.hidden && existing.status === 'pending';
  const scheduled: ScheduledEvent = existing ?? {
    id: entry.id,
    title: title ?? '',
    description: '',
    day: now.day,
    hour: null,
    hidden: false,
    status: 'pending',
  };
  if (existing && title) scheduled.title = title;
  if (entry.description !== undefined) scheduled.description = entry.description;
  if (when) {
    scheduled.day = when.day;
    scheduled.hour = when.hour;
  }
  if (entry.hidden !== undefined) scheduled.hidden = entry.hidden;
  // A new time means it is to be waited for again, whatever became of it before.
  if (entry.status) scheduled.status = entry.status;
  else if (moved) scheduled.status = 'pending';
  calendar.schedule[scheduled.id] = scheduled;

  // New to the player: just scheduled, revealed, or back on after it was over.
  if (scheduled.hidden || scheduled.status !== 'pending' || wasAnnounced) return [];
  return [{ type: 'schedule_added', id: scheduled.id, title: scheduled.title, day: scheduled.day, hour: scheduled.hour }];
}

function applyCalendar(world: WorldState, section: unknown, errors: EntryError[]): WorldEvent[] {
  const parts = asParts(section, 'calendar', errors);
  if (!parts) return [];
  const events: WorldEvent[] = [];
  const established = world.modules.calendar !== undefined;
  const calendar = world.modules.calendar ?? freshCalendar();
  let used = established;
  const reader = entryReader(parts, 'calendar.', errors, events);

  // The clock before the schedule, so that times from now count from the clock as it now stands.
  reader.one('now', CALENDAR_PARTS.now, (wanted) => {
    if (wanted.day === undefined && wanted.hour === undefined) return [];
    used = true;
    return setClock(calendar, wanted, established);
  });
  reader.each('schedule', scheduleEntry, (entry) => {
    const changed = upsertEntry(calendar, entry);
    used = true;
    return changed;
  });
  reader.rejectUnknown(Object.keys(CALENDAR_PARTS), 'part of the calendar');

  // A section where nothing went in sets no calendar up.
  if (used) world.modules.calendar = calendar;
  return events;
}

// --- pass_time ----------------------------------------------------------------

const passTimeSchema = z.strictObject({
  hours: z.number().int().min(0).max(1440).optional().describe('Hours that pass.'),
  days: z.number().int().min(0).max(60).optional().describe('Whole days that pass, on top of the hours.'),
  reason: z.string().describe('What fills the time, in the story language, e.g. "Searching the archive", "三天的山路".'),
});

const passTimeTool: GameTool = {
  name: PASS_TIME,
  silent: false,
  // It does move the clock, but the turn still owes a record: the scene, what came of what came due.
  records: false,
  endsTurn: false,
  run(world, input) {
    const parsed = passTimeSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error, input);
    const span = (parsed.data.days ?? 0) * HOURS_PER_DAY + (parsed.data.hours ?? 0);
    if (span <= 0) return { content: 'No time passed: give hours, days or both, above zero.', isError: true, events: [] };

    // Time can pass before anyone set the clock: it then starts on the morning of day 1.
    const calendar = (world.modules.calendar ??= freshCalendar());
    const stillDue = Object.values(calendar.schedule)
      .filter((entry) => entry.status === 'due')
      .sort(byDueTime);
    const { cameDue, events } = moveClock(calendar, addHours(nowOf(calendar), span), parsed.data.reason.trim());
    const now = nowOf(calendar);
    const ahead = Object.values(calendar.schedule)
      .filter((entry) => entry.status === 'pending')
      .sort(byDueTime)
      .slice(0, AHEAD);

    const note = [
      ...(cameDue.length > 0
        ? [
            'What came due happens now, whether or not the player is there to see it. Tell what it brings about in this turn, then set each entry to done in record.calendar, or cancelled if it no longer happens. The player learns of hidden ones only as the story reveals them.',
          ]
        : []),
      ...(stillDue.length > 0 ? ['still_due came due earlier and has not been settled: settle it the same way.'] : []),
      'Bring scene.time up to date when you record.',
    ].join(' ');

    const content = JSON.stringify({
      hours_passed: span,
      now: { day: now.day, hour: now.hour, part: dayPart(now.hour) },
      came_due: cameDue.map((entry) => ({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        day: entry.day,
        hour: entry.hour,
        hidden: entry.hidden,
      })),
      ...(stillDue.length > 0 ? { still_due: stillDue.map((entry) => ({ id: entry.id, title: entry.title, hidden: entry.hidden })) } : {}),
      ahead: ahead.map((entry) => ({
        id: entry.id,
        title: entry.title,
        day: entry.day,
        hour: entry.hour,
        hidden: entry.hidden,
        due_in_hours: hoursBetween(now, comesDueAt(entry)),
      })),
      note,
    });
    return { content, isError: false, events };
  },
};

// --- what the game master is told ---------------------------------------------

const en = `## Calendar

You have a calendar: a clock for the world (the day, counted from 1, and the hour) and a schedule of what is set to happen when. It is for stories where time matters: deadlines, journeys, appointments, things that happen whether or not the player is there to see them. The ship sails at dawn on day 3 even if the player is still in the tavern. In a story where "later" is all the precision anyone needs, leave it alone.

Set the clock in the opening record (calendar.now: the day, usually 1, and the hour) and keep scene.time in step with it. scene.time is the time as the player reads it, in the setting's own words ("Dusk, day 3", "the third night of the festival"); the calendar is the ledger behind it.

Put on the schedule (calendar.schedule) whatever is set to happen at a time: the deadline the player was given, the meeting at noon, the caravan due in three days. Schedule what the player does not know about too, as hidden: a rival's next move, the ambush waiting on the road, the storm coming in. Give the time by day (with an hour, or without one for "some time that day"), by in_days from today, or by in_hours from now.

Whenever the story moves the clock (an hour searching the archive, a night's sleep, three days on the road), call pass_time before you narrate that stretch. The answer may be that something came due in the middle of it, and then the stretch does not go as planned. For scale: a conversation or a search takes up to an hour, a meal one or two, a night's sleep eight, a day on the road ten to twelve. A few words or a walk across the room need no pass_time; when small moments add up to an hour or so, pass it.

What came due happens now, whether or not the player is there to see it. Tell what it brings about in that same turn, then set it to done in record.calendar (or cancelled if the story has made it moot). If it cut the stretch short (the ambush struck in the second hour of the march), tell it that way and set the clock back to that hour with calendar.now. pass_time tells you about hidden entries too; the player learns of them only when the story reveals them.

For a jump the narration makes on its own ("three years later"), set calendar.now forward instead: whatever falls due in between comes due as well, and you will find it marked due in the world state next turn.`;

const zh = `## 日历

你有一本日历：世界的时钟（第几天，从 1 数起，以及几点）和一份日程，记着什么事定在什么时候发生。它用于时间要紧的故事：期限、旅途、约定，以及不管玩家在不在场都照样会发生的事。即使玩家还泡在酒馆里，船也会在第 3 天天亮时启航。如果故事里一句“后来”就足够交代时间，就不要动它。

在开场的 record 里拨好时钟（calendar.now：第几天，通常是 1，以及几点），之后让 scene.time 始终与它对得上。scene.time 是玩家读到的时间，用这个世界自己的说法（“第三日黄昏”“庙会第三夜”）；日历是它背后的账本。

凡是定了时候要发生的事，都记进日程（calendar.schedule）：交给玩家的期限、正午的会面、三天后到的商队。玩家不知道的事也要记，标为 hidden：对手的下一步、埋伏在路上的人、正在逼近的风暴。时间用 day 给出（可以带 hour；不带则表示“那天某个时候”），或用 in_days 从今天算起，或用 in_hours 从此刻算起。

每当故事让时间往前走（在档案室里翻找一个小时、睡一夜、赶三天路），先调用 pass_time，再叙述这段时间。结果可能是中途有事到期了，那这段时间就不会照原样过去。大致的尺度：一番交谈或一次搜查不超过一小时，一顿饭一两个小时，一夜好睡八小时，赶一天路十到十二小时。说几句话、走过屋子不必调用 pass_time；零碎的工夫攒到一小时左右，再推进一次。

到期的事此刻就会发生，不管玩家在不在场。在同一回合里讲出它带来了什么，然后在 record.calendar 里把它标为 done（如果故事已经让它不会再发生，就标 cancelled）。如果它打断了这段时间（行军第二个小时就遭遇埋伏），就照这样讲，并用 calendar.now 把时钟拨回那个钟点。pass_time 也会告诉你隐藏的日程；玩家只有在故事揭开时才会知道。

叙述里自己跳过一段时间时（“三年后”），改用 calendar.now 把时钟往前拨：跳过的时间里到期的事同样会到期，下一回合你会在世界状态里看到它们标为 due。`;

function viewCalendarForGM(world: WorldState): unknown {
  const calendar = world.modules.calendar;
  if (!calendar) return undefined;
  const activeSchedule = Object.fromEntries(
    Object.entries(calendar.schedule).filter(([, entry]) => entry.status === 'pending' || entry.status === 'due'),
  );
  return {
    day: calendar.day,
    hour: calendar.hour,
    schedule: activeSchedule,
  };
}

export const calendarModule: GameModule = {
  id: 'calendar',
  // A clock and a short list: cheap to carry, and any story can come to a deadline.
  keptWhenUnused: true,
  hasPanel: true,
  tools: [
    {
      tool: passTimeTool,
      spec: {
        name: PASS_TIME,
        description:
          'Let time pass in the world: an hour\'s search, a night\'s sleep, days on the road. The server moves the clock and tells you what on the calendar came due along the way, hidden entries included, and what is still ahead. Call it before narrating that stretch of time and tell the story from the result. The new time is shown to the player, and so is whatever came due that they can see.',
        inputSchema: toJsonSchema(passTimeSchema),
      },
    },
  ],
  record: { schema: calendarSection, apply: applyCalendar },
  guide: { en, zh },
  viewForGM: viewCalendarForGM,
};
