import type { ChronicleEntry, LoreEntry, WorldState } from '@roleplay/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { splitLore } from '../../lib/world';
import { useUi } from '../../store/ui';
import { SecretsSwitch } from './SecretsSwitch';

const RECENT_CHRONICLE_LIMIT = 8;

function LoreCard({ entry, lang, secret }: { entry: LoreEntry; lang: string; secret: boolean }) {
  const { t } = useTranslation();
  return (
    <li className={secret ? 'card is-secret' : 'card'}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {entry.title}
        </h4>
        {secret && <span className="tag tag--secret">{t('world.lore.secret')}</span>}
      </div>
      {entry.content && (
        <p className="card__text" lang={lang}>
          {entry.content}
        </p>
      )}
    </li>
  );
}

function ChronicleCard({ entry, lang }: { entry: ChronicleEntry; lang: string }) {
  const { t } = useTranslation();
  const when = [t('world.lore.chronicleTurn', { turn: entry.turn }), entry.time]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <li className={entry.secret ? 'card chronicle-card is-secret' : 'card chronicle-card'}>
      <div className="chronicle-card__meta">
        <span className="chronicle-card__when" lang={lang}>
          {when}
        </span>
        <div className="chronicle-card__badges">
          <span className={`tag${entry.kind === 'turning_point' || entry.kind === 'decree' ? ' tag--accent' : ''}`}>
            {t(`world.lore.chronicleKinds.${entry.kind}`)}
          </span>
          {entry.public && !entry.secret && (
            <span className="tag">{t('world.lore.chroniclePublic')}</span>
          )}
          {entry.secret && <span className="tag tag--secret">{t('world.lore.secret')}</span>}
        </div>
      </div>
      <h4 className="card__title" lang={lang}>
        {entry.title}
      </h4>
      {entry.summary && (
        <p className="card__text" lang={lang}>
          {entry.summary}
        </p>
      )}
      {entry.impact && (
        <p className="chronicle-card__impact" lang={lang}>
          {t('world.lore.chronicleImpact', { impact: entry.impact })}
        </p>
      )}
    </li>
  );
}

export function LoreTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const [showAllChronicle, setShowAllChronicle] = useState(false);
  const [expandSummary, setExpandSummary] = useState(false);
  const { visible, secret } = splitLore(world);

  const arc = world.storyArc;
  const hasArc = Boolean(arc && (arc.chapter || arc.summary || arc.threads.length > 0));
  const hasSummary = Boolean(world.storySummary && world.storySummary.trim());
  const allChronicle = [...(world.chronicle ?? [])]
    .filter((entry) => showSecrets || !entry.secret)
    .reverse();
  const shownChronicle = showAllChronicle
    ? allChronicle
    : allChronicle.slice(0, RECENT_CHRONICLE_LIMIT);
  const hasProgression = hasArc || hasSummary || allChronicle.length > 0;

  return (
    <div className="lore">
      {/* The warning sits with the secret entries further down. */}
      <SecretsSwitch />

      {hasProgression && (
        <section className="lore__section" aria-label={t('world.lore.progressionHeading')}>
          <h3 className="lore__heading">{t('world.lore.progressionHeading')}</h3>

          {hasArc && arc && (
            <div className="card lore-arc">
              <div className="card__head">
                <h4 className="card__title" lang={lang}>
                  {arc.chapter || t('world.lore.currentArc')}
                </h4>
                <span className="tag tag--accent">{t('world.lore.currentArc')}</span>
              </div>
              {arc.summary && (
                <p className="card__text" lang={lang}>
                  {arc.summary}
                </p>
              )}
              {arc.threads.length > 0 && (
                <div className="lore-arc__threads">
                  <span className="card__label">{t('world.lore.threadsLabel')}</span>
                  <ul className="lore-arc__thread-list">
                    {arc.threads.map((thread, idx) => (
                      <li key={`${idx}:${thread}`} className="lore-arc__thread" lang={lang}>
                        {thread}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {hasSummary && (
            <div className="card lore-summary">
              <div className="card__head">
                <h4 className="card__title">{t('world.lore.storySummary')}</h4>
                {world.summarizedUpToTurn > 0 && (
                  <span className="tag">
                    {t('world.lore.storySummaryTurns', { turn: world.summarizedUpToTurn })}
                  </span>
                )}
              </div>
              <p
                className={`card__text lore-summary__body${!expandSummary && world.storySummary.length > 260 ? ' is-clamped' : ''}`}
                lang={lang}
              >
                {world.storySummary}
              </p>
              {world.storySummary.length > 260 && (
                <button
                  type="button"
                  className="disclosure"
                  aria-expanded={expandSummary}
                  onClick={() => setExpandSummary((v) => !v)}
                >
                  {expandSummary ? t('world.mind.showFewer') : t('common.more', { defaultValue: '…' })}
                </button>
              )}
            </div>
          )}

          {allChronicle.length > 0 && (
            <div className="lore-chronicle">
              <h4 className="lore__subheading">
                {t('world.lore.chronicleHeading')}
                <span className="mind__count">{allChronicle.length}</span>
              </h4>
              <ol className="cards chronicle-list">
                {shownChronicle.map((entry) => (
                  <ChronicleCard key={entry.id} entry={entry} lang={lang} />
                ))}
              </ol>
              {allChronicle.length > RECENT_CHRONICLE_LIMIT && (
                <button
                  type="button"
                  className="disclosure"
                  aria-expanded={showAllChronicle}
                  onClick={() => setShowAllChronicle((v) => !v)}
                >
                  {showAllChronicle
                    ? t('world.lore.chronicleShowFewer')
                    : t('world.lore.chronicleShowAll', { n: allChronicle.length })}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {visible.length > 0 ? (
        <section className="lore__section" aria-label={t('world.lore.loreHeading')}>
          {hasProgression && <h3 className="lore__heading">{t('world.lore.loreHeading')}</h3>}
          <ul className="cards">
            {visible.map((entry) => (
              <LoreCard key={entry.id} entry={entry} lang={lang} secret={false} />
            ))}
          </ul>
        </section>
      ) : (
        !hasProgression && <p className="tab-empty">{t('world.lore.empty')}</p>
      )}

      {showSecrets && (
        <section className="secrets" aria-label={t('world.lore.secret')}>
          <p className="secrets__warning">{t('world.lore.secretsWarning')}</p>
          {secret.length > 0 ? (
            <ul className="cards">
              {secret.map((entry) => (
                <LoreCard key={entry.id} entry={entry} lang={lang} secret />
              ))}
            </ul>
          ) : (
            <p className="tab-empty">{t('world.lore.noSecrets')}</p>
          )}
        </section>
      )}

      {world.artStyle && (
        <p className="lore__art-style">
          {t('world.artStyle', { style: world.artStyle })}
        </p>
      )}
    </div>
  );
}
