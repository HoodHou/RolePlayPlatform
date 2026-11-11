import type { ProgressionAbility, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';

export function hasProgressionContent(world: WorldState): boolean {
  const prog = world.modules?.progression;
  if (!prog) return false;
  return Boolean(
    prog.realm ||
      prog.systemName ||
      prog.ladder.length > 0 ||
      Object.keys(prog.abilities).length > 0,
  );
}

function AbilityCard({ ability, lang }: { ability: ProgressionAbility; lang: string }) {
  const { t } = useTranslation();
  return (
    <li className={ability.equipped ? 'card is-present' : 'card'}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {ability.name}
        </h4>
        <div className="card__head-tags">
          {ability.rank && (
            <span className="tag" lang={lang}>
              {ability.rank}
            </span>
          )}
          {ability.equipped && (
            <span className="tag tag--accent">{t('world.progression.equipped')}</span>
          )}
        </div>
      </div>
      {(ability.category || ability.cost) && (
        <p className="card__meta" lang={lang}>
          {[ability.category, ability.cost ? `${t('world.progression.cost')}: ${ability.cost}` : '']
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {ability.description && (
        <p className="card__text" lang={lang}>
          {ability.description}
        </p>
      )}
    </li>
  );
}

export function ProgressionTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const state = world.modules?.progression;
  if (!state) return null;

  const xpPct = Math.max(0, Math.min(100, (state.xp / Math.max(1, state.xpMax)) * 100));
  const currentIdx = state.ladder.findIndex((r) => r === state.realm);
  const abilities = Object.values(state.abilities).sort(
    (a, b) => Number(b.equipped) - Number(a.equipped) || a.name.localeCompare(b.name),
  );

  return (
    <div className="module-tab">
      <header className="realm-crest">
        {state.systemName && (
          <p className="eyebrow" lang={lang}>
            {state.systemName}
          </p>
        )}
        <div className="realm-crest__main">
          <h3 className="realm-crest__realm" lang={lang}>
            {state.realm || t('world.progression.unawakened')}
          </h3>
          {state.subRealm && (
            <span className="tag tag--accent" lang={lang}>
              {state.subRealm}
            </span>
          )}
        </div>

        <div className="mini-meter mini-meter--accent">
          <div className="mini-meter__head">
            <span className="mini-meter__label">{t('world.progression.cultivation')}</span>
            <span className="mini-meter__value">
              {state.xp} / {state.xpMax}
            </span>
          </div>
          <div className="mini-meter__track" aria-hidden="true">
            <div className="mini-meter__fill" style={{ width: `${xpPct}%` }} />
          </div>
        </div>

        {state.deviation > 0 && (
          <div className="mini-meter mini-meter--bad">
            <div className="mini-meter__head">
              <span className="mini-meter__label">{t('world.progression.deviation')}</span>
              <span className="mini-meter__value">{state.deviation}%</span>
            </div>
            <div className="mini-meter__track" aria-hidden="true">
              <div className="mini-meter__fill" style={{ width: `${state.deviation}%` }} />
            </div>
          </div>
        )}

        {state.bottleneck && (
          <div className="callout-box">
            <span className="card__label">{t('world.progression.bottleneck')}</span>
            <p className="card__text" lang={lang}>
              {state.bottleneck}
            </p>
          </div>
        )}

        {state.ladder.length > 0 && (
          <div className="realm-ladder">
            <span className="card__label">{t('world.progression.ladder')}</span>
            <ol className="realm-ladder__steps">
              {state.ladder.map((step, idx) => {
                const isCurrent = step === state.realm;
                const isPassed = currentIdx >= 0 && idx < currentIdx;
                return (
                  <li
                    key={`${idx}:${step}`}
                    className={`realm-step${isCurrent ? ' is-current' : isPassed ? ' is-passed' : ''}`}
                    lang={lang}
                  >
                    {step}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </header>

      {abilities.length > 0 && (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.progression.abilitiesTitle')}</h3>
          <ul className="cards">
            {abilities.map((ab) => (
              <AbilityCard key={ab.id} ability={ab} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
