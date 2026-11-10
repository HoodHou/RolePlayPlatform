import { reputationTier, type ReputationStanding, type WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { formatSigned } from '../../lib/text';
import { BondMeter } from './BondMeter';

function StandingCard({ standing, lang }: { standing: ReputationStanding; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const tier = reputationTier(standing.score);
  const latest = standing.history.at(-1);

  return (
    <li className="card bond">
      <div className="bond__head">
        <div className="bond__who">
          <h4 className="card__title" lang={lang}>
            {standing.name}
          </h4>
          {standing.title && (
            <p className="bond__role" lang={lang}>
              {t('world.reputation.titleHeld')}: {standing.title}
            </p>
          )}
        </div>
        <div className="bond__standing" aria-hidden="true">
          <span className="bond__stage">{t(`world.reputation.tier.${tier}`)}</span>
          <span className="bond__score">{formatSigned(standing.score, uiTag)}</span>
        </div>
      </div>
      <BondMeter score={standing.score} name={standing.name} />
      {standing.heat > 0 && (
        <p className="card__meta">
          <span className="tag tag--secret">
            {t('world.reputation.heat', { heat: standing.heat })}
          </span>
        </p>
      )}
      {standing.description && (
        <p className="card__text" lang={lang}>
          {standing.description}
        </p>
      )}
      {latest && latest.reason && (
        <p className="bond__latest">
          <span className="card__label">{t('world.bonds.lately')}</span>
          {latest.change !== 0 && (
            <>
              <span className={latest.change > 0 ? 'bond__change is-up' : 'bond__change is-down'}>
                {formatSigned(latest.change, uiTag)}
              </span>{' '}
            </>
          )}
          <span lang={lang}>{latest.reason}</span>
        </p>
      )}
    </li>
  );
}

/** Read-only view of the reputation ledger: standings, titles, and heat with groups and places. */
export function ReputationTab({ world, lang }: { world: WorldState; lang: string }) {
  const state = world.modules?.reputation;
  if (!state) return null;
  const standings = Object.values(state.standings).sort(
    (a, b) => Math.abs(b.score) - Math.abs(a.score) || a.name.localeCompare(b.name),
  );

  return (
    <div className="bonds">
      <ul className="cards">
        {standings.map((standing) => (
          <StandingCard key={standing.id} standing={standing} lang={lang} />
        ))}
      </ul>
    </div>
  );
}
