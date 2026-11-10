import {
  dayPart,
  HOURS_PER_DAY,
  type CalendarState,
  type ScheduledEvent,
  type WorldState,
} from '@roleplay/shared';
import type { TFunction } from 'i18next';

/** The calendar, once the game master has set one up. It outlives the module being switched off. */
export function calendarOf(world: WorldState): CalendarState | undefined {
  return world.modules?.calendar;
}

/** Hours since the start of day 1: what moments are compared and subtracted by. */
function hoursOf(day: number, hour: number): number {
  return (day - 1) * HOURS_PER_DAY + hour;
}

/** When an entry comes due, in hours since day 1: its hour, or for "some time that day" the moment that day is over. */
function dueAt(entry: Pick<ScheduledEvent, 'day' | 'hour'>): number {
  return entry.hour === null ? hoursOf(entry.day + 1, 0) : hoursOf(entry.day, entry.hour);
}

/** Hours from now until an entry comes due; zero or less once its time has come. */
export function hoursUntil(calendar: CalendarState, entry: ScheduledEvent): number {
  return dueAt(entry) - hoursOf(calendar.day, calendar.hour);
}

export interface ScheduleView {
  /** Come due, waiting for the story to deal with it. */
  due: ScheduledEvent[];
  /** Still ahead, soonest first. */
  upcoming: ScheduledEvent[];
  /** Done or cancelled, latest first. */
  settled: ScheduledEvent[];
}

/** The schedule as the panel shows it; hidden entries only with the game master's secrets shown. */
export function scheduleOf(calendar: CalendarState, showSecrets: boolean): ScheduleView {
  const entries = Object.values(calendar.schedule).filter((entry) => showSecrets || !entry.hidden);
  const soonest = (a: ScheduledEvent, b: ScheduledEvent) => dueAt(a) - dueAt(b);
  return {
    due: entries.filter((entry) => entry.status === 'due').sort(soonest),
    upcoming: entries.filter((entry) => entry.status === 'pending').sort(soonest),
    settled: entries.filter((entry) => entry.status === 'done' || entry.status === 'cancelled').sort((a, b) => soonest(b, a)),
  };
}

/** "06:00". */
export function clockFace(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** A span of hours in words: "3 hours", "2 days", "1 day and 6 hours". */
export function formatSpan(t: TFunction, hours: number): string {
  const total = Math.max(Math.round(hours), 0);
  const days = Math.floor(total / HOURS_PER_DAY);
  const rest = total % HOURS_PER_DAY;
  if (days === 0) return t('time.hours', { count: rest });
  if (rest === 0) return t('time.days', { count: days });
  return t('time.daysHours', { days: t('time.days', { count: days }), hours: t('time.hours', { count: rest }) });
}

/**
 * When something falls, in words. `inline` is for the middle of a sentence
 * ("day 3, 06:00"), `title` for a line of its own ("Day 3, 06:00").
 */
export function formatWhen(t: TFunction, day: number, hour: number | null, style: 'title' | 'inline' = 'title'): string {
  if (hour === null) return t(`time.${style}.allDay`, { day });
  return t(`time.${style}.at`, { day, time: clockFace(hour) });
}

/** The part of the day an hour falls in, worded. */
export function partOfDay(t: TFunction, hour: number): string {
  return t(`time.dayParts.${dayPart(hour)}`);
}
