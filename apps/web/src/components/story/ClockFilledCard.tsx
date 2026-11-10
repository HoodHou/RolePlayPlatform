import type { WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import type { ClockTickEvent } from '../../lib/modules';
import { ClockDial } from '../world/ClockDial';

/**
 * The moment a clock fills: what it was counting toward happens now. Told on
 * a card in the alarm colour, so it cannot pass for one more tick. What the
 * clock meant comes from the world, while the clock is still kept there.
 */
export function ClockFilledCard({ event, world, lang }: { event: ClockTickEvent; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const description = world.modules?.clocks?.clocks[event.id]?.description.trim() ?? '';

  return (
    <div className="clock-filled" role="group" aria-label={event.name}>
      <ClockDial segments={event.segments} filled={event.to} size={44} />
      <div className="clock-filled__body">
        <p className="clock-filled__head">
          <span className="clock-filled__name" lang={lang}>
            {event.name}
          </span>
          <span className="clock-filled__badge">{t('events.clockFilled.badge')}</span>
        </p>
        <p className="clock-filled__text">{t('events.clockFilled.text')}</p>
        {description && (
          <p className="clock-filled__when" lang={lang}>
            {t('events.clockFilled.when', { description })}
          </p>
        )}
      </div>
    </div>
  );
}
