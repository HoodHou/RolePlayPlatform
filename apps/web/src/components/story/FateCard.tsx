import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { MODULE_GLYPH, type FateEvent } from '../../lib/modules';
import { formatNumber } from '../../lib/text';

/**
 * A question put to fate: the question, the odds the game master judged, the
 * d100 against the chance of a yes (drawn on a scale: the yes band, and where
 * the roll fell), the answer, and the twist when a double threw one in.
 */
export function FateCard({ event, lang }: { event: FateEvent; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const yes = event.answer.startsWith('yes');
  const chance = Math.min(Math.max(event.chance, 0), 100);
  const roll = Math.min(Math.max(event.roll, 1), 100);

  return (
    <div className={`fate fate--${yes ? 'yes' : 'no'} fate--${event.answer}`}>
      <div className="fate__head">
        <span className="fate__glyph" aria-hidden="true">
          {MODULE_GLYPH.oracle}
        </span>
        <p className="fate__title">
          {t('events.fate.title')}
          <span className="fate__odds"> · {t(`events.fate.odds.${event.odds}`)}</span>
        </p>
        <span className="fate__answer">{t(`events.fate.answer.${event.answer}`)}</span>
      </div>
      <p className="fate__question" lang={lang}>
        {event.question}
      </p>
      <div className="fate__scale" aria-hidden="true">
        <span className="fate__yes" style={{ width: `${chance}%` }} />
        <span className="fate__roll" style={{ left: `${roll - 0.5}%` }} />
      </div>
      <p className="fate__math">
        <span className="roll__system">d100</span>
        <span className="die">{formatNumber(event.roll, uiTag)}</span>
        <span className="fate__needs">{t('events.fate.needs', { chance: formatNumber(event.chance, uiTag) })}</span>
        <span className="fate__means">{t(`events.fate.means.${event.answer}`)}</span>
      </p>
      {event.twist && (
        <p className="fate__twist">
          <span className="fate__twist-label">✦ {t('events.fate.twist')}</span>
          <strong className="fate__twist-name">{t(`events.fate.twists.${event.twist}.name`)}</strong>
          <span>{t(`events.fate.twists.${event.twist}.means`)}</span>
          <span className="fate__twist-why">({t('events.fate.twistWhy')})</span>
        </p>
      )}
    </div>
  );
}
