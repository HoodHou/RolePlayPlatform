import { dayPart, HOURS_PER_DAY, type CalendarState, type ScheduledEvent } from '@roleplay/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { clockFace, formatSpan, formatWhen, hoursUntil, partOfDay, scheduleOf } from '../../lib/calendar';
import { formatNumber } from '../../lib/text';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { SecretsSwitch } from './SecretsSwitch';

const HOURS = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hour);

/** The day as a strip of hours, each tinted for its part of the day, with the present hour raised. */
function DayTrack({ hour }: { hour: number }) {
  const { t } = useTranslation();
  return (
    <div className="day-track" role="img" aria-label={t('world.calendar.dayLabel')}>
      <div className="day-track__hours">
        {HOURS.map((h) => (
          <span key={h} className={`day-track__hour part--${dayPart(h)}${h === hour ? ' is-now' : ''}`} />
        ))}
      </div>
      <div className="day-track__marks" aria-hidden="true">
        {[0, 6, 12, 18].map((mark) => (
          <span key={mark} style={{ left: `${(mark / HOURS_PER_DAY) * 100}%` }}>
            {clockFace(mark)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScheduleCard({ entry, calendar, lang }: { entry: ScheduledEvent; calendar: CalendarState; lang: string }) {
  const { t } = useTranslation();
  const classes = ['card', 'card--compact', 'schedule', `schedule--${entry.status}`, entry.hidden ? 'is-secret' : '']
    .filter(Boolean)
    .join(' ');

  let badge: string;
  if (entry.status === 'pending') {
    const hours = hoursUntil(calendar, entry);
    badge = hours > 0 ? t('world.calendar.inSpan', { span: formatSpan(t, hours) }) : t('world.calendar.now');
  } else if (entry.status === 'due') badge = t('world.calendar.now');
  else badge = t(`world.calendar.status.${entry.status}`);

  return (
    <li className={classes}>
      <div className="card__head">
        <h5 className="card__title schedule__title" lang={lang}>
          {entry.title}
        </h5>
        <span className="schedule__badge">{badge}</span>
      </div>
      <p className="schedule__when">
        {formatWhen(t, entry.day, entry.hour)}
        {entry.hidden && <span className="tag tag--secret">{t('world.calendar.secret')}</span>}
      </p>
      {entry.description && (
        <p className="card__text schedule__description" lang={lang}>
          {entry.description}
        </p>
      )}
    </li>
  );
}

/**
 * The calendar: the day, the hour and its part of the day; what has come due
 * and awaits the story; what is coming and how long until it is due; and,
 * folded away, what is done or cancelled. Hidden entries only with the game
 * master's secrets shown.
 */
export function CalendarTab({ calendar, lang }: { calendar: CalendarState; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const showSecrets = useUi((s) => s.showSecrets);
  const id = useId();
  const [showSettled, setShowSettled] = useState(false);
  const { due, upcoming, settled } = scheduleOf(calendar, showSecrets);
  const empty = due.length + upcoming.length + settled.length === 0;
  const part = partOfDay(t, calendar.hour);

  return (
    <div className="calendar">
      <div
        className="calendar__now"
        aria-label={t('world.calendar.nowLabel', { day: calendar.day, time: clockFace(calendar.hour), part })}
        role="group"
      >
        <div className="calendar__when" aria-hidden="true">
          <p className="calendar__day">{t('world.calendar.day', { n: formatNumber(calendar.day, uiTag) })}</p>
          <p className="calendar__time">
            <span className="calendar__clock">{clockFace(calendar.hour)}</span>
            <span className="calendar__part">{part}</span>
          </p>
        </div>
        <DayTrack hour={calendar.hour} />
      </div>

      <SecretsSwitch warning={t('world.calendar.secretsWarning')} />

      {empty && <p className="tab-empty">{t('world.calendar.empty')}</p>}

      {due.length > 0 && (
        <section className="calendar__section calendar__section--due" aria-labelledby={`${id}-due`}>
          <h4 id={`${id}-due`} className="eyebrow calendar__heading">
            {t('world.calendar.due')}
          </h4>
          <p className="calendar__note">{t('world.calendar.dueNote')}</p>
          <ul className="cards">
            {due.map((entry) => (
              <ScheduleCard key={entry.id} entry={entry} calendar={calendar} lang={lang} />
            ))}
          </ul>
        </section>
      )}

      {!empty && (
        <section className="calendar__section" aria-labelledby={`${id}-upcoming`}>
          <h4 id={`${id}-upcoming`} className="eyebrow calendar__heading">
            {t('world.calendar.upcoming')}
          </h4>
          {upcoming.length > 0 ? (
            <ul className="cards">
              {upcoming.map((entry) => (
                <ScheduleCard key={entry.id} entry={entry} calendar={calendar} lang={lang} />
              ))}
            </ul>
          ) : (
            <p className="calendar__note">{t('world.calendar.nothingAhead')}</p>
          )}
        </section>
      )}

      {settled.length > 0 && (
        <section className="calendar__section">
          <button
            type="button"
            className="disclosure"
            aria-expanded={showSettled}
            aria-controls={`${id}-settled`}
            onClick={() => setShowSettled((value) => !value)}
          >
            {t('world.calendar.settled')}
            <span className="disclosure__count">{settled.length}</span>
            <Icon name="chevron" size={14} className="disclosure__chevron" />
          </button>
          <ul id={`${id}-settled`} className="cards" hidden={!showSettled}>
            {settled.map((entry) => (
              <ScheduleCard key={entry.id} entry={entry} calendar={calendar} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
