import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { MODULE_GLYPH, type CombatStartEvent } from '../../lib/modules';
import { formatNumber } from '../../lib/text';

/** A fight breaking out: everyone in it, in the order they will act, with their side and the initiative they rolled. */
export function CombatStartCard({ event, lang }: { event: CombatStartEvent; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const id = useId();

  return (
    <div className="combat-start">
      <div className="combat-start__head">
        <span className="combat-start__glyph" aria-hidden="true">
          {MODULE_GLYPH.combat}
        </span>
        <p className="combat-start__title">{t('events.combatStart.title')}</p>
      </div>
      <p id={`${id}-order`} className="combat-start__label">
        {t('events.combatStart.order')}
      </p>
      <ol className="combat-start__order" aria-labelledby={`${id}-order`}>
        {event.combatants.map((combatant, index) => (
          <li key={combatant.id} className={`order-chip side--${combatant.side}`}>
            <span className="order-chip__place" aria-hidden="true">
              {index + 1}
            </span>
            <span className="order-chip__name" lang={lang}>
              {combatant.name}
            </span>
            <span className="sr-only">, {t(`world.combat.side.${combatant.side}`)}, </span>
            <span className="order-chip__initiative" title={t('events.combatStart.initiative', { n: combatant.initiative })}>
              <span className="sr-only">{t('events.combatStart.initiative', { n: combatant.initiative })}</span>
              <span aria-hidden="true">{formatNumber(combatant.initiative, uiTag)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
