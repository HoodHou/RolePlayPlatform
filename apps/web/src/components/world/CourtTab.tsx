import type {
  CourtEdict,
  CourtFaction,
  CourtMemorial,
  CourtOfficial,
  CourtState,
  Session,
  WorldState,
} from '@roleplay/shared';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { draftRuleOnMemorial, draftSummonOrSeek } from '../../lib/characterRoles';
import { focusComposer } from '../../lib/composer';
import { formatNumber, formatSigned } from '../../lib/text';
import { canTalkTo, isPresent } from '../../lib/world';
import { useGame } from '../../store/game';
import { useUi } from '../../store/ui';
import { CharacterAvatar } from '../CharacterAvatar';
import { Icon } from '../Icon';

export function hasCourtContent(world: WorldState): boolean {
  const court = world.modules?.court;
  if (!court) return false;
  return Boolean(
    court.regimeName ||
      court.metrics.length > 0 ||
      Object.keys(court.officials).length > 0 ||
      Object.keys(court.memorials).length > 0 ||
      Object.keys(court.factions).length > 0 ||
      Object.keys(court.edicts).length > 0,
  );
}

export function pendingMemorialCount(world: WorldState): number {
  const memorials = world.modules?.court?.memorials;
  if (!memorials) return 0;
  return Object.values(memorials).filter((m) => m.status === 'pending').length;
}

type CourtSection = 'officials' | 'memorials' | 'factions' | 'edicts';

function StatBar({
  label,
  value,
  tone = 'accent',
}: {
  label: string;
  value: number;
  tone?: 'accent' | 'good' | 'bad';
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`mini-meter mini-meter--${tone}`}>
      <div className="mini-meter__head">
        <span className="mini-meter__label">{label}</span>
        <span className="mini-meter__value">{value}</span>
      </div>
      <div className="mini-meter__track" aria-hidden="true">
        <div className="mini-meter__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function OfficialCard({
  official,
  state,
  session,
  lang,
}: {
  official: CourtOfficial;
  state: CourtState;
  session: Session;
  lang: string;
}) {
  const { t } = useTranslation();
  const openDossier = useUi((s) => s.openDossier);
  const closeDrawer = useUi((s) => s.closeDrawer);
  const talkingTo = useGame((s) => s.talkingTo);
  const startTalking = useGame((s) => s.startTalking);
  const stopTalking = useGame((s) => s.stopTalking);
  const setDraft = useGame((s) => s.setDraft);

  const { world } = session;
  const character = world.characters[official.characterId];
  const name = character?.name ?? official.characterId;
  const present = character ? isPresent(world, character) : false;
  const talkable = canTalkTo(world, official.characterId);
  const talking = talkable && talkingTo === official.characterId;
  const faction = official.factionId ? state.factions[official.factionId] : undefined;

  const handleAudience = () => {
    flushSync(() => {
      startTalking(official.characterId);
      closeDrawer();
    });
    focusComposer();
  };

  const handleSummon = () => {
    if (!character) return;
    const text = draftSummonOrSeek(session, character);
    flushSync(() => {
      stopTalking();
      setDraft(text);
      closeDrawer();
    });
    focusComposer();
  };

  return (
    <li className={present ? 'card is-present' : 'card'}>
      <div className="module-person">
        <button
          type="button"
          className="module-person__avatar"
          aria-label={t('world.dossier.openFor', { name })}
          onClick={() => character && openDossier(character.id)}
          disabled={!character}
        >
          <CharacterAvatar name={name} imageUrl={character?.imageUrl} />
        </button>
        <div className="module-person__main">
          <div className="card__head">
            <h4 className="card__title" lang={lang}>
              {character ? (
                <button
                  type="button"
                  className="card__title-link"
                  onClick={() => openDossier(character.id)}
                >
                  {name}
                </button>
              ) : (
                name
              )}
            </h4>
            {present && <span className="tag tag--accent">{t('world.characters.present')}</span>}
          </div>
          <div className="module-person__tags">
            <span className="tag tag--accent" lang={lang}>
              {official.office}
              {official.rank ? ` · ${official.rank}` : ''}
            </span>
            {official.department && (
              <span className="tag" lang={lang}>
                {official.department}
              </span>
            )}
            {faction && (
              <span className="tag" lang={lang}>
                {faction.name}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mini-meters mini-meters--grid">
        <StatBar label={t('world.court.stats.governance')} value={official.governance} />
        <StatBar label={t('world.court.stats.military')} value={official.military} />
        <StatBar label={t('world.court.stats.intrigue')} value={official.intrigue} />
        <StatBar
          label={t('world.court.stats.loyalty')}
          value={official.loyalty}
          tone={official.loyalty >= 70 ? 'good' : official.loyalty <= 35 ? 'bad' : 'accent'}
        />
      </div>

      <div className="court-official__meta">
        <span>
          {t('world.court.stats.influence')}: <strong>{official.influence}</strong>
        </span>
        {official.assignment && (
          <span lang={lang}>
            {t('world.court.assignment')}: {official.assignment}
          </span>
        )}
      </div>

      {character && (
        <div className="card__actions">
          <button
            type="button"
            className="disclosure"
            onClick={() => openDossier(character.id)}
          >
            <Icon name="dossier" size={14} />
            {t('world.dossier.open')}
          </button>
          {talkable ? (
            <button
              type="button"
              className={talking ? 'talk-button is-active' : 'talk-button'}
              onClick={handleAudience}
            >
              <Icon name="speech" size={14} />
              {talking ? t('world.characters.talking') : t('world.dossier.audience')}
            </button>
          ) : (
            <button type="button" className="talk-button" onClick={handleSummon}>
              <Icon name="speech" size={14} />
              {t('world.dossier.summon')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function MemorialCard({
  memorial,
  session,
  lang,
}: {
  memorial: CourtMemorial;
  session: Session;
  lang: string;
}) {
  const { t } = useTranslation();
  const openDossier = useUi((s) => s.openDossier);
  const closeDrawer = useUi((s) => s.closeDrawer);
  const stopTalking = useGame((s) => s.stopTalking);
  const setDraft = useGame((s) => s.setDraft);

  const authorChar = memorial.authorId ? session.world.characters[memorial.authorId] : undefined;
  const authorLabel = authorChar?.name || memorial.authorName;

  const urgencyClass =
    memorial.urgency === 'secret'
      ? 'tag tag--secret'
      : memorial.urgency === 'urgent'
        ? 'tag tag--live'
        : 'tag';

  const statusClass =
    memorial.status === 'pending'
      ? 'tag tag--accent'
      : memorial.status === 'approved'
        ? 'tag tag--completed'
        : memorial.status === 'rejected'
          ? 'tag tag--failed'
          : 'tag';

  const handleRule = () => {
    const text = draftRuleOnMemorial(session, memorial);
    flushSync(() => {
      stopTalking();
      setDraft(text);
      closeDrawer();
    });
    focusComposer();
  };

  return (
    <li className={memorial.status === 'pending' ? 'card is-present' : 'card'}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {memorial.title}
        </h4>
        <div className="card__head-tags">
          <span className={urgencyClass}>{t(`world.court.urgency.${memorial.urgency}`)}</span>
          <span className={statusClass}>{t(`world.court.memorialStatus.${memorial.status}`)}</span>
        </div>
      </div>

      {authorLabel && (
        <p className="card__meta">
          {t('world.court.petitioner')}:{' '}
          {authorChar ? (
            <button
              type="button"
              className="link-btn"
              lang={lang}
              onClick={() => openDossier(authorChar.id)}
            >
              {authorLabel}
            </button>
          ) : (
            <span lang={lang}>{authorLabel}</span>
          )}
        </p>
      )}

      {memorial.summary && (
        <p className="card__text" lang={lang}>
          {memorial.summary}
        </p>
      )}

      {memorial.proposal && (
        <div className="callout-box">
          <span className="card__label">{t('world.court.proposal')}</span>
          <p className="card__text" lang={lang}>
            {memorial.proposal}
          </p>
        </div>
      )}

      {memorial.ruling && (
        <div className="callout-box callout-box--rescript">
          <span className="card__label">{t('world.court.ruling')}</span>
          <p className="card__text" lang={lang}>
            {memorial.ruling}
          </p>
        </div>
      )}

      {memorial.status === 'pending' && (
        <div className="card__actions">
          <button type="button" className="talk-button" onClick={handleRule}>
            <Icon name="book" size={14} />
            {t('world.court.ruleAction')}
          </button>
        </div>
      )}
    </li>
  );
}

function FactionCard({
  faction,
  state,
  world,
  lang,
}: {
  faction: CourtFaction;
  state: CourtState;
  world: WorldState;
  lang: string;
}) {
  const { t } = useTranslation();
  const openDossier = useUi((s) => s.openDossier);
  const leader = faction.leaderId ? world.characters[faction.leaderId] : undefined;
  const members = Object.values(state.officials).filter((o) => o.factionId === faction.id);

  return (
    <li className="card">
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {faction.name}
        </h4>
        {faction.stance && (
          <span className="tag tag--accent" lang={lang}>
            {faction.stance}
          </span>
        )}
      </div>
      <StatBar label={t('world.court.factionInfluence')} value={faction.influence} />
      {leader && (
        <p className="card__meta">
          {t('world.sandbox.leader')}:{' '}
          <button
            type="button"
            className="link-btn"
            lang={lang}
            onClick={() => openDossier(leader.id)}
          >
            {leader.name}
          </button>
        </p>
      )}
      {faction.description && (
        <p className="card__text" lang={lang}>
          {faction.description}
        </p>
      )}
      {members.length > 0 && (
        <div className="places__links">
          <span className="card__label">{t('world.court.members')}</span>
          <ul className="chips">
            {members.map((m) => {
              const ch = world.characters[m.characterId];
              const label = ch ? `${ch.name} (${m.office})` : m.characterId;
              return (
                <li key={m.characterId}>
                  {ch ? (
                    <button
                      type="button"
                      className="chip-button"
                      lang={lang}
                      onClick={() => openDossier(ch.id)}
                    >
                      {label}
                    </button>
                  ) : (
                    <span className="chip" lang={lang}>
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

function EdictCard({ edict, lang }: { edict: CourtEdict; lang: string }) {
  const { t } = useTranslation();
  return (
    <li className={edict.active ? 'card is-present' : 'card'}>
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {edict.title}
        </h4>
        <span className={edict.active ? 'tag tag--accent' : 'tag'}>
          {edict.active ? t('world.court.edictActive') : t('world.court.edictRepealed')}
        </span>
      </div>
      {edict.effect && (
        <p className="card__subtitle" lang={lang}>
          {edict.effect}
        </p>
      )}
      {edict.description && (
        <p className="card__text" lang={lang}>
          {edict.description}
        </p>
      )}
    </li>
  );
}

export function CourtTab({ session, lang }: { session: Session; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const state = session.world.modules?.court;
  const [section, setSection] = useState<CourtSection>('officials');

  if (!state) return null;

  const officials = Object.values(state.officials).sort(
    (a, b) => b.influence - a.influence || b.governance - a.governance,
  );
  const urgencyRank = { secret: 0, urgent: 1, routine: 2 } as const;
  const memorials = Object.values(state.memorials).sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1;
    const pb = b.status === 'pending' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.status === 'pending' && b.status === 'pending') {
      return urgencyRank[a.urgency] - urgencyRank[b.urgency] || b.turn - a.turn;
    }
    return b.turn - a.turn;
  });
  const factions = Object.values(state.factions).sort((a, b) => b.influence - a.influence);
  const edicts = Object.values(state.edicts).sort(
    (a, b) => Number(b.active) - Number(a.active) || b.turnIssued - a.turnIssued,
  );

  const pendingCount = memorials.filter((m) => m.status === 'pending').length;

  const sections: { id: CourtSection; count: number; badge?: number }[] = [
    { id: 'officials', count: officials.length },
    { id: 'memorials', count: memorials.length, badge: pendingCount },
    { id: 'factions', count: factions.length },
    { id: 'edicts', count: edicts.length },
  ];

  const activeSection: CourtSection =
    sections.find((s) => s.id === section && s.count > 0)?.id ??
    sections.find((s) => s.count > 0)?.id ??
    'officials';

  return (
    <div className="module-tab">
      {(state.regimeName || state.rulerTitle || state.sessionsHeld > 0) && (
        <header className="regime-banner">
          <div className="regime-banner__main">
            {state.regimeName && (
              <h3 className="regime-banner__title" lang={lang}>
                {state.regimeName}
              </h3>
            )}
            {state.rulerTitle && (
              <span className="tag tag--accent" lang={lang}>
                {state.rulerTitle}
              </span>
            )}
          </div>
          {state.sessionsHeld > 0 && (
            <p className="regime-banner__meta">
              {t('world.court.sessionsHeld', { count: state.sessionsHeld })}
            </p>
          )}
        </header>
      )}

      {state.metrics.length > 0 && (
        <section className="metric-grid" aria-label={t('world.court.metricsLabel')}>
          {state.metrics.map((m) => {
            const pct = m.max ? Math.max(0, Math.min(100, (m.value / Math.max(1, m.max)) * 100)) : null;
            return (
              <div key={m.id} className="metric-tile">
                <div className="metric-tile__head">
                  <span className="metric-tile__name" lang={lang}>
                    {m.name}
                  </span>
                  {m.delta !== 0 && (
                    <span className={m.delta > 0 ? 'metric-tile__delta is-up' : 'metric-tile__delta is-down'}>
                      {formatSigned(m.delta, uiTag)}
                    </span>
                  )}
                </div>
                <div className="metric-tile__value">
                  {formatNumber(m.value, uiTag)}
                  {m.max !== undefined && <span className="metric-tile__max"> / {formatNumber(m.max, uiTag)}</span>}
                </div>
                {pct !== null && (
                  <div className="mini-meter__track" aria-hidden="true">
                    <div className="mini-meter__fill" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <div className="subtabs" role="group" aria-label={t('world.tabs.court')}>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className="chip-button"
            aria-pressed={activeSection === s.id}
            onClick={() => setSection(s.id)}
          >
            {t(`world.court.sections.${s.id}`)}
            {s.badge && s.badge > 0 ? (
              <span className="subtabs__badge subtabs__badge--due">{s.badge}</span>
            ) : s.count > 0 ? (
              <span className="subtabs__badge">{s.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      {activeSection === 'officials' &&
        (officials.length > 0 ? (
          <ul className="cards">
            {officials.map((o) => (
              <OfficialCard key={o.characterId} official={o} state={state} session={session} lang={lang} />
            ))}
          </ul>
        ) : (
          <p className="tab-empty">{t('world.court.emptyOfficials')}</p>
        ))}

      {activeSection === 'memorials' &&
        (memorials.length > 0 ? (
          <ul className="cards">
            {memorials.map((m) => (
              <MemorialCard key={m.id} memorial={m} session={session} lang={lang} />
            ))}
          </ul>
        ) : (
          <p className="tab-empty">{t('world.court.emptyMemorials')}</p>
        ))}

      {activeSection === 'factions' &&
        (factions.length > 0 ? (
          <ul className="cards">
            {factions.map((f) => (
              <FactionCard key={f.id} faction={f} state={state} world={session.world} lang={lang} />
            ))}
          </ul>
        ) : (
          <p className="tab-empty">{t('world.court.emptyFactions')}</p>
        ))}

      {activeSection === 'edicts' &&
        (edicts.length > 0 ? (
          <ul className="cards">
            {edicts.map((e) => (
              <EdictCard key={e.id} edict={e} lang={lang} />
            ))}
          </ul>
        ) : (
          <p className="tab-empty">{t('world.court.emptyEdicts')}</p>
        ))}
    </div>
  );
}
