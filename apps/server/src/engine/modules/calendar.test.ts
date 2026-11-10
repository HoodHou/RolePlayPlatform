import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEmptyWorld,
  type CalendarState,
  type ScheduledEvent,
  type ScheduleStatus,
  type WorldEvent,
  type WorldState,
} from '@roleplay/shared';
import { toJsonSchema, type EntryError, type ToolContext } from '../toolKit';
import { addHours, calendarModule, comesDueAt, comingDue, hoursBetween, isDue, PASS_TIME } from './calendar';

// The module is called directly, as the turn loop would call it.

interface Reported {
  id: string;
  title: string;
  day: number;
  hour: number | null;
  hidden: boolean;
}

interface PassTimeReport {
  hours_passed: number;
  now: { day: number; hour: number; part: string };
  came_due: (Reported & { description: string })[];
  still_due?: { id: string; title: string; hidden: boolean }[];
  ahead: (Reported & { due_in_hours: number })[];
  note: string;
}

const ctx: ToolContext = { random: () => 0.5, narrate: () => {} };

function passTime(world: WorldState, input: unknown) {
  const instrument = calendarModule.tools.find(({ tool }) => tool.name === PASS_TIME);
  assert.ok(instrument);
  const outcome = instrument.tool.run(world, input, ctx);
  let report: unknown = outcome.content;
  try {
    report = JSON.parse(outcome.content);
  } catch {
    // Plain-text refusals are compared as they are.
  }
  return { ...outcome, report: report as PassTimeReport };
}

function record(world: WorldState, section: unknown) {
  const part = calendarModule.record;
  assert.ok(part);
  const errors: EntryError[] = [];
  const events = part.apply(world, section, errors, ctx);
  return { events, errors, rejected: errors.map((error) => error.at) };
}

const types = (events: WorldEvent[]) => events.map((event) => event.type);

function calendarOf(world: WorldState): CalendarState {
  const calendar = world.modules.calendar;
  assert.ok(calendar);
  return calendar;
}

const statuses = (world: WorldState) => Object.values(calendarOf(world).schedule).map((entry) => [entry.id, entry.status]);

/** A world whose clock the opening record set to this day and hour. */
function worldAt(day: number, hour: number): WorldState {
  const world = createEmptyWorld();
  const opening = record(world, { now: { day, hour } });
  assert.deepEqual(opening.errors, []);
  // Setting the clock is where the story begins, not time passing.
  assert.deepEqual(opening.events, []);
  return world;
}

// --- time ---------------------------------------------------------------------

test('the clock rolls over midnight and on through the days', () => {
  assert.deepEqual(addHours({ day: 1, hour: 8 }, 0), { day: 1, hour: 8 });
  assert.deepEqual(addHours({ day: 1, hour: 22 }, 1), { day: 1, hour: 23 });
  assert.deepEqual(addHours({ day: 1, hour: 23 }, 1), { day: 2, hour: 0 });
  assert.deepEqual(addHours({ day: 1, hour: 22 }, 5), { day: 2, hour: 3 });
  assert.deepEqual(addHours({ day: 2, hour: 20 }, 3 * 24 + 5), { day: 6, hour: 1 });
  // The most one pass_time can move it: sixty days and 1440 hours.
  assert.deepEqual(addHours({ day: 9, hour: 0 }, 60 * 24 + 1440), { day: 129, hour: 0 });

  assert.equal(hoursBetween({ day: 1, hour: 20 }, { day: 3, hour: 2 }), 30);
  assert.equal(hoursBetween({ day: 3, hour: 2 }, { day: 1, hour: 20 }), -30);
});

test('an entry with an hour is due once the clock reaches it; one without, once its day is over', () => {
  const dawn = { day: 3, hour: 6 };
  assert.equal(isDue(dawn, { day: 3, hour: 6 }), true, 'at the exact hour');
  assert.equal(isDue(dawn, { day: 3, hour: 5 }), false, 'one hour short');
  assert.equal(isDue(dawn, { day: 2, hour: 23 }), false);
  assert.equal(isDue(dawn, { day: 4, hour: 0 }), true, 'and at any time after');

  const someTime = { day: 3, hour: null };
  assert.equal(isDue(someTime, { day: 3, hour: 0 }), false);
  assert.equal(isDue(someTime, { day: 3, hour: 23 }), false, 'not while its day lasts');
  assert.equal(isDue(someTime, { day: 4, hour: 0 }), true, 'the day after');
  assert.deepEqual(comesDueAt(someTime), { day: 4, hour: 0 });

  // Only what is still pending comes due, in the order its time came.
  const entry = (id: string, day: number, hour: number | null, status: ScheduleStatus = 'pending'): ScheduledEvent => ({
    id,
    title: id,
    description: '',
    day,
    hour,
    hidden: false,
    status,
  });
  const schedule = {
    late: entry('late', 3, 20),
    fair: entry('fair', 2, null),
    early: entry('early', 2, 9),
    settled: entry('settled', 1, 9, 'done'),
    told: entry('told', 1, 10, 'due'),
    ahead: entry('ahead', 9, 0),
  };
  assert.deepEqual(
    comingDue(schedule, { day: 4, hour: 0 }).map((due) => due.id),
    ['early', 'fair', 'late'],
  );
});

// --- pass_time ----------------------------------------------------------------

test('pass_time moves the clock and hands over what came due, hidden entries included', () => {
  const world = worldAt(1, 20);
  const scheduled = record(world, {
    schedule: [
      { id: 'ship', title: 'The Gull sails', description: 'She leaves with or without you.', day: 2, hour: 6 },
      { id: 'ambush', title: 'Bandits on the coast road', in_hours: 4, hidden: true },
      { id: 'fair', title: 'The harvest fair', in_days: 1 },
      { id: 'trial', title: 'The trial', day: 5, hour: 12 },
    ],
  });
  assert.deepEqual(scheduled.errors, []);
  // The player is told of what they know is coming, and of nothing else.
  assert.deepEqual(scheduled.events, [
    { type: 'schedule_added', id: 'ship', title: 'The Gull sails', day: 2, hour: 6 },
    { type: 'schedule_added', id: 'fair', title: 'The harvest fair', day: 2, hour: null },
    { type: 'schedule_added', id: 'trial', title: 'The trial', day: 5, hour: 12 },
  ]);

  const outcome = passTime(world, { hours: 12, reason: 'A night at the inn' });

  assert.equal(outcome.isError, false);
  // The ambush came due first, at midnight, but only the ship is announced.
  assert.deepEqual(outcome.events, [
    { type: 'time_passed', fromDay: 1, fromHour: 20, toDay: 2, toHour: 8, reason: 'A night at the inn' },
    { type: 'schedule_due', id: 'ship', title: 'The Gull sails' },
  ]);
  const { report } = outcome;
  assert.equal(report.hours_passed, 12);
  assert.deepEqual(report.now, { day: 2, hour: 8, part: 'morning' });
  assert.deepEqual(report.came_due, [
    { id: 'ambush', title: 'Bandits on the coast road', description: '', day: 2, hour: 0, hidden: true },
    { id: 'ship', title: 'The Gull sails', description: 'She leaves with or without you.', day: 2, hour: 6, hidden: false },
  ]);
  // The fair is some time today, so it comes due when the day is over.
  assert.deepEqual(report.ahead, [
    { id: 'fair', title: 'The harvest fair', day: 2, hour: null, hidden: false, due_in_hours: 16 },
    { id: 'trial', title: 'The trial', day: 5, hour: 12, hidden: false, due_in_hours: 76 },
  ]);
  assert.equal(report.still_due, undefined);
  assert.match(report.note, /happens now/);
  assert.match(report.note, /done in record\.calendar/);

  const calendar = calendarOf(world);
  assert.deepEqual([calendar.day, calendar.hour], [2, 8]);
  assert.deepEqual(statuses(world), [
    ['ship', 'due'],
    ['ambush', 'due'],
    ['fair', 'pending'],
    ['trial', 'pending'],
  ]);
});

test('what has come due is not announced again when more time passes, but the game master is reminded', () => {
  const world = worldAt(1, 20);
  record(world, {
    schedule: [
      { id: 'ship', title: 'The Gull sails', day: 2, hour: 6 },
      { id: 'fair', title: 'The harvest fair', day: 2 },
    ],
  });
  passTime(world, { hours: 12, reason: 'Sleep' });

  const again = passTime(world, { days: 1, reason: 'Wait for the next boat' });
  assert.deepEqual(again.events, [
    { type: 'time_passed', fromDay: 2, fromHour: 8, toDay: 3, toHour: 8, reason: 'Wait for the next boat' },
    { type: 'schedule_due', id: 'fair', title: 'The harvest fair' },
  ]);
  assert.deepEqual(
    again.report.came_due.map((entry) => entry.id),
    ['fair'],
  );
  assert.deepEqual(again.report.still_due, [{ id: 'ship', title: 'The Gull sails', hidden: false }]);
  assert.match(again.report.note, /still_due/);

  // Settled, they drop out of the reminders.
  record(world, { schedule: [{ id: 'ship', status: 'done' }, { id: 'fair', status: 'done' }] });
  const quiet = passTime(world, { hours: 1, reason: 'Wait' });
  assert.deepEqual(types(quiet.events), ['time_passed']);
  assert.deepEqual([quiet.report.came_due, quiet.report.still_due, quiet.report.ahead], [[], undefined, []]);
  assert.doesNotMatch(quiet.report.note, /happens now/);
});

test('time passed before the clock was ever set starts on the morning of day 1', () => {
  const world = createEmptyWorld();
  const outcome = passTime(world, { days: 1, hours: 2, reason: 'The crossing' });

  assert.equal(outcome.isError, false);
  assert.deepEqual(outcome.events, [{ type: 'time_passed', fromDay: 1, fromHour: 8, toDay: 2, toHour: 10, reason: 'The crossing' }]);
  assert.deepEqual(world.modules.calendar, { day: 2, hour: 10, schedule: {} });
  assert.deepEqual(outcome.report.now, { day: 2, hour: 10, part: 'morning' });
  assert.deepEqual([outcome.report.came_due, outcome.report.ahead], [[], []]);
});

test('pass_time refuses a span of nothing or of too much, and sets nothing up', () => {
  const world = createEmptyWorld();
  const refused = [
    { reason: 'Nothing' },
    { hours: 0, days: 0, reason: 'Nothing' },
    { hours: -2, reason: 'Backwards' },
    { hours: 2.5, reason: 'A while' },
    { days: 61, reason: 'A season' },
    { hours: 3 },
    { hours: 3, reason: 'Wait', minutes: 20 },
  ];
  for (const input of refused) {
    const outcome = passTime(world, input);
    assert.equal(outcome.isError, true, JSON.stringify(input));
    assert.deepEqual(outcome.events, []);
  }
  assert.match(passTime(world, { hours: 0, reason: 'Nothing' }).content, /give hours, days or both/);
  assert.equal(world.modules.calendar, undefined);
});

// --- record.calendar ----------------------------------------------------------

test('the opening sets the clock; what it leaves out starts at day 1, eight in the morning', () => {
  const evening = createEmptyWorld();
  assert.deepEqual(record(evening, { now: { hour: 21 } }).events, []);
  assert.deepEqual(evening.modules.calendar, { day: 1, hour: 21, schedule: {} });

  const later = createEmptyWorld();
  record(later, { now: { day: 4 } });
  assert.deepEqual(later.modules.calendar, { day: 4, hour: 8, schedule: {} });

  // A section with nothing in it sets no calendar up.
  const bare = createEmptyWorld();
  assert.deepEqual(record(bare, { now: {} }).errors, []);
  assert.equal(bare.modules.calendar, undefined);
});

test('now moved forward brings due what fell in between; moved back, what it overshot is ahead again', () => {
  const world = worldAt(1, 8);
  record(world, {
    schedule: [
      { id: 'letter', title: 'The letter arrives', day: 2 },
      { id: 'spy', title: 'The spy reports', day: 3, hour: 9, hidden: true },
      { id: 'duel', title: 'The duel', day: 4, hour: 6 },
    ],
  });

  const jump = record(world, { now: { day: 3, hour: 12 } });
  assert.deepEqual(jump.errors, []);
  assert.deepEqual(jump.events, [
    { type: 'time_passed', fromDay: 1, fromHour: 8, toDay: 3, toHour: 12, reason: '' },
    { type: 'schedule_due', id: 'letter', title: 'The letter arrives' },
  ]);
  assert.deepEqual(statuses(world), [
    ['letter', 'due'],
    ['spy', 'due'],
    ['duel', 'pending'],
  ]);

  // The hour alone keeps the day: back to seven that morning. What had come
  // due by then stays due; what the jump overshot is ahead again.
  const back = record(world, { now: { hour: 7 } });
  assert.deepEqual(back.events, []);
  assert.deepEqual([calendarOf(world).day, calendarOf(world).hour], [3, 7]);
  assert.deepEqual(statuses(world), [
    ['letter', 'due'],
    // Due at nine; at seven that is still ahead.
    ['spy', 'pending'],
    ['duel', 'pending'],
  ]);

  // Forward again over the same hours: nothing is announced twice.
  const forward = record(world, { now: { day: 4, hour: 6 } });
  assert.deepEqual(forward.events, [
    { type: 'time_passed', fromDay: 3, fromHour: 7, toDay: 4, toHour: 6, reason: '' },
    { type: 'schedule_due', id: 'duel', title: 'The duel' },
  ]);
  // Setting it to the time it already shows is no news either.
  assert.deepEqual(record(world, { now: { day: 4, hour: 6 } }).events, []);
});

test('a time is given by day, by days from today or by hours from now', () => {
  const world = worldAt(2, 22);
  const outcome = record(world, {
    schedule: [
      { id: 'market', title: 'Market day', day: 4, hour: 9 },
      { id: 'feast', title: 'The feast', day: 4 },
      { id: 'smith', title: 'Meet the smith', in_days: 1, hour: 10 },
      { id: 'curfew', title: 'Curfew lifts', in_days: 0 },
      { id: 'watch', title: 'The watch changes', in_hours: 3 },
      { id: 'poison', title: 'The duke is poisoned', in_hours: 30, hidden: true },
    ],
  });

  assert.deepEqual(outcome.errors, []);
  const when = (entryId: string) => {
    const entry = calendarOf(world).schedule[entryId];
    return [entry?.day, entry?.hour];
  };
  assert.deepEqual(when('market'), [4, 9]);
  assert.deepEqual(when('feast'), [4, null], 'no hour: some time that day');
  assert.deepEqual(when('smith'), [3, 10]);
  assert.deepEqual(when('curfew'), [2, null], 'some time today is still ahead');
  assert.deepEqual(when('watch'), [3, 1], 'across midnight');
  assert.deepEqual(when('poison'), [4, 4]);
  assert.deepEqual(
    outcome.events.map((event) => event.type === 'schedule_added' && event.id),
    ['market', 'feast', 'smith', 'curfew', 'watch'],
  );
  assert.deepEqual(calendarOf(world).schedule.poison, {
    id: 'poison',
    title: 'The duke is poisoned',
    description: '',
    day: 4,
    hour: 4,
    hidden: true,
    status: 'pending',
  });

  // Moved later, an entry keeps its hour; given an hour alone, it keeps its day.
  record(world, { schedule: [{ id: 'market', in_days: 3 }, { id: 'smith', hour: 15 }] });
  assert.deepEqual(when('market'), [5, 9]);
  assert.deepEqual(when('smith'), [3, 15]);
});

test('in one record the clock moves first, so times from now count from the new clock', () => {
  const world = worldAt(1, 8);
  const outcome = record(world, {
    schedule: [{ id: 'envoy', title: 'The envoy returns', in_days: 1, hour: 18 }],
    now: { day: 5, hour: 9 },
  });

  assert.deepEqual(outcome.errors, []);
  assert.deepEqual(outcome.events, [
    { type: 'time_passed', fromDay: 1, fromHour: 8, toDay: 5, toHour: 9, reason: '' },
    { type: 'schedule_added', id: 'envoy', title: 'The envoy returns', day: 6, hour: 18 },
  ]);
});

test('a bad schedule entry is refused on its own and leaves no trace', () => {
  const world = worldAt(3, 13);
  record(world, {
    schedule: [
      { id: 'ship', title: 'The Gull sails', day: 4, hour: 6 },
      { id: 'bell', title: 'The bell tolls', day: 3, hour: 14 },
    ],
  });
  passTime(world, { hours: 1, reason: 'Wait in the square' });
  assert.equal(calendarOf(world).schedule.bell?.status, 'due');
  const before = structuredClone(calendarOf(world));

  const outcome = record(world, {
    schedule: [
      { id: 'nameless', day: 5 },
      { id: 'timeless', title: 'Some day' },
      { id: 'at_nine', title: 'At nine', hour: 9 },
      { id: 'twice', title: 'Twice', day: 5, in_days: 2 },
      { id: 'clash', title: 'Clash', in_hours: 5, hour: 9 },
      { id: 'missed', title: 'Too late', day: 3, hour: 9 },
      { id: 'this_hour', title: 'Right now', in_days: 0, hour: 14 },
      { id: 'yesterday', title: 'Yesterday', day: 2 },
      // Moved to a day gone by, keeping its hour.
      { id: 'ship', day: 2 },
      // Waiting again for a time that has come.
      { id: 'bell', status: 'pending' },
      // Due is the server's to set.
      { id: 'bell', status: 'due' },
      { id: 'ghost', remove: true },
      { id: '__proto__', title: 'Everything', day: 9 },
      { id: 'late', title: 'Late', day: 4, hour: 24 },
      { id: 'never', title: 'Never', day: 0 },
    ],
    weather: 'rain',
  });

  assert.deepEqual(outcome.rejected, [...Array.from({ length: 15 }, (_, index) => `calendar.schedule[${index}]`), 'calendar.weather']);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(calendarOf(world), before);
  // Nothing leaked onto every object in the process.
  assert.equal(({} as { title?: string }).title, undefined);

  // Each refusal says what to send instead.
  const problem = (index: number) => outcome.errors.find((error) => error.at === `calendar.schedule[${index}]`)?.problem ?? '';
  assert.match(problem(0), /Include "title" to schedule it/);
  assert.match(problem(1), /Include a time \(day, in_days or in_hours\)/);
  assert.match(problem(2), /in_days \(0 for today\)/);
  assert.match(problem(3), /one way only/);
  assert.match(problem(4), /Leave hour out/);
  assert.match(problem(5), /Day 3, 09:00 has already come: it is now day 3, 14:00/);
  assert.match(problem(6), /Day 3, 14:00 has already come/);
  assert.match(problem(7), /Day 2 is already over/);
  assert.match(problem(8), /Day 2, 06:00 has already come/);
  assert.match(problem(9), /give it a new time/);
  assert.match(problem(11), /nothing on the calendar with id "ghost"/);

  // A first record in which nothing went in sets no calendar up.
  const fresh = createEmptyWorld();
  assert.deepEqual(record(fresh, { schedule: [{ id: 'nameless', day: 2 }] }).rejected, ['calendar.schedule[0]']);
  assert.equal(fresh.modules.calendar, undefined);
  assert.deepEqual(record(fresh, ['not', 'parts']).rejected, ['calendar']);
});

test('a hidden entry is announced when it is revealed while still ahead', () => {
  const world = worldAt(1, 8);
  record(world, {
    schedule: [
      { id: 'ambush', title: 'Ambush at the ford', day: 1, hour: 18, hidden: true },
      { id: 'coup', title: 'The coup', day: 1, hour: 10, hidden: true },
    ],
  });

  const revealed = record(world, { schedule: [{ id: 'ambush', hidden: false }] });
  assert.deepEqual(revealed.events, [{ type: 'schedule_added', id: 'ambush', title: 'Ambush at the ford', day: 1, hour: 18 }]);
  // Restated in full, at the time it already has, it is no news.
  const restated = record(world, { schedule: [{ id: 'ambush', title: 'Ambush at the ford', description: 'Six men in the reeds.', day: 1, hour: 18 }] });
  assert.deepEqual([restated.errors, restated.events], [[], []]);
  assert.equal(calendarOf(world).schedule.ambush?.description, 'Six men in the reeds.');

  // One that came due unseen is already happening: the story reveals it, not a notice.
  passTime(world, { hours: 3, reason: 'Ride north' });
  assert.equal(calendarOf(world).schedule.coup?.status, 'due');
  assert.deepEqual(record(world, { schedule: [{ id: 'coup', hidden: false, status: 'done' }] }).events, []);
  assert.deepEqual(
    [calendarOf(world).schedule.coup?.hidden, calendarOf(world).schedule.coup?.status],
    [false, 'done'],
  );
});

test('entries are settled as done or cancelled, put off with a new time, or removed', () => {
  const world = worldAt(1, 8);
  record(world, {
    schedule: [
      { id: 'meeting', title: 'Meet the broker', day: 1, hour: 12 },
      { id: 'storm', title: 'The storm breaks', day: 1, hour: 20 },
      { id: 'caravan', title: 'The caravan', day: 2 },
    ],
  });
  passTime(world, { hours: 4, reason: 'Haggle in the bazaar' });

  // The story dealt with the meeting; the storm blew out to sea before it broke.
  const settled = record(world, { schedule: [{ id: 'meeting', status: 'done' }, { id: 'storm', status: 'cancelled' }] });
  assert.deepEqual([settled.errors, settled.events], [[], []]);
  assert.deepEqual(statuses(world), [
    ['meeting', 'done'],
    ['storm', 'cancelled'],
    ['caravan', 'pending'],
  ]);
  // A cancelled entry does not come due when its hour passes.
  assert.deepEqual(types(passTime(world, { hours: 10, reason: 'Wait out the evening' }).events), ['time_passed']);

  // Given a new time, a settled entry is back on the calendar and will come due again.
  const postponed = record(world, { schedule: [{ id: 'meeting', in_days: 1 }] });
  assert.deepEqual(postponed.events, [{ type: 'schedule_added', id: 'meeting', title: 'Meet the broker', day: 2, hour: 12 }]);
  assert.equal(calendarOf(world).schedule.meeting?.status, 'pending');
  // Moving what the player already knows is coming is not news.
  assert.deepEqual(record(world, { schedule: [{ id: 'caravan', day: 3 }] }).events, []);

  const next = passTime(world, { hours: 14, reason: 'Sleep' });
  assert.deepEqual(next.events, [
    { type: 'time_passed', fromDay: 1, fromHour: 22, toDay: 2, toHour: 12, reason: 'Sleep' },
    { type: 'schedule_due', id: 'meeting', title: 'Meet the broker' },
  ]);

  // Removed, it is gone without a word.
  const removed = record(world, { schedule: [{ id: 'caravan', remove: true }] });
  assert.deepEqual([removed.errors, removed.events], [[], []]);
  assert.deepEqual(Object.keys(calendarOf(world).schedule), ['meeting', 'storm']);
});

// --- what the module is -------------------------------------------------------

test('the calendar is one instrument, a section of the record, and a guide in both languages', () => {
  assert.equal(calendarModule.id, 'calendar');
  assert.deepEqual([calendarModule.keptWhenUnused, calendarModule.hasPanel], [true, true]);
  assert.deepEqual(
    calendarModule.tools.map(({ tool, spec }) => [tool.name, spec.name, tool.silent, tool.records, tool.endsTurn]),
    [[PASS_TIME, PASS_TIME, false, false, false]],
  );
  assert.equal(PASS_TIME, 'pass_time');

  // The section turns into the schema the model is shown.
  const section = calendarModule.record;
  assert.ok(section);
  const properties = (toJsonSchema(section.schema) as { properties?: Record<string, unknown> }).properties ?? {};
  assert.deepEqual(Object.keys(properties), ['now', 'schedule']);

  for (const locale of ['en', 'zh'] as const) {
    const guide = calendarModule.guide[locale];
    assert.ok(guide.startsWith('## '), locale);
    assert.equal(guide.match(/^## /gm)?.length, 1, `${locale}: one section`);
    for (const word of ['pass_time', 'record.calendar', 'calendar.now', 'calendar.schedule', 'scene.time', 'hidden', 'done']) {
      assert.ok(guide.includes(word), `${locale}: ${word}`);
    }
  }
  assert.match(calendarModule.guide.zh, /日程/);
  assert.match(calendarModule.guide.zh, /到期/);
});
