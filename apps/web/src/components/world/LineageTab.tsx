import type {
  ClanRelative,
  ConsortEntry,
  HeirEntry,
  Session,
  WorldState,
} from '@roleplay/shared';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { draftSummonOrSeek } from '../../lib/characterRoles';
import { focusComposer } from '../../lib/composer';
import { canTalkTo, isPresent } from '../../lib/world';
import { useGame } from '../../store/game';
import { useUi } from '../../store/ui';
import { CharacterAvatar } from '../CharacterAvatar';
import { Icon } from '../Icon';

export function hasLineageContent(world: WorldState): boolean {
  const lineage = world.modules?.lineage;
  if (!lineage) return false;
  return Boolean(
    lineage.houseName ||
      Object.keys(lineage.consorts).length > 0 ||
      Object.keys(lineage.heirs).length > 0 ||
      Object.keys(lineage.relatives).length > 0,
  );
}

export function lineageMemberCount(world: WorldState): number {
  const lineage = world.modules?.lineage;
  if (!lineage) return 0;
  return (
    Object.keys(lineage.consorts).length +
    Object.keys(lineage.heirs).length +
    Object.keys(lineage.relatives).length
  );
}

type LineageSection = 'consorts' | 'heirs' | 'relatives';

function MeterBar({
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

function ConsortCard({
  consort,
  session,
  lang,
}: {
  consort: ConsortEntry;
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
  const character = world.characters[consort.characterId];
  const name = character?.name ?? consort.characterId;
  const present = character ? isPresent(world, character) : false;
  const talkable = canTalkTo(world, consort.characterId);
  const talking = talkable && talkingTo === consort.characterId;

  const handleTalk = () => {
    flushSync(() => {
      startTalking(consort.characterId);
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
              {consort.title}
            </span>
            {consort.palace && (
              <span className="tag" lang={lang}>
                {consort.palace}
              </span>
            )}
          </div>
        </div>
      </div>

      <MeterBar
        label={t('world.lineage.favor')}
        value={consort.favor}
        tone={consort.favor >= 70 ? 'good' : 'accent'}
      />

      {consort.familyBackground && (
        <p className="card__meta" lang={lang}>
          {t('world.lineage.familyBackground')}: {consort.familyBackground}
        </p>
      )}

      {character && (
        <div className="card__actions">
          <button type="button" className="disclosure" onClick={() => openDossier(character.id)}>
            <Icon name="dossier" size={14} />
            {t('world.dossier.open')}
          </button>
          {talkable ? (
            <button
              type="button"
              className={talking ? 'talk-button is-active' : 'talk-button'}
              onClick={handleTalk}
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

function HeirCard({
  heir,
  session,
  lang,
}: {
  heir: HeirEntry;
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
  const character = world.characters[heir.characterId];
  const name = character?.name ?? heir.characterId;
  const present = character ? isPresent(world, character) : false;
  const talkable = canTalkTo(world, heir.characterId);
  const talking = talkable && talkingTo === heir.characterId;
  const tutor = heir.tutorId ? world.characters[heir.tutorId] : undefined;

  const handleTalk = () => {
    flushSync(() => {
      startTalking(heir.characterId);
      closeDrawer();
    });
    focusComposer();
  };

  const handleNurtureDraft = () => {
    const text =
      session.language === 'zh'
        ? `考校并栽培${heir.title || heir.order || ''}${name}的课业：`
        : `Examine and nurture ${heir.title ? `${heir.title} ` : ''}${name}: `;
    flushSync(() => {
      stopTalking();
      setDraft(text);
      closeDrawer();
    });
    focusComposer();
  };

  return (
    <li className={heir.isHeirApparent || present ? 'card is-present' : 'card'}>
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
            <div className="card__head-tags">
              {heir.isHeirApparent && (
                <span className="tag tag--accent">{t('world.lineage.heirApparent')}</span>
              )}
              {present && <span className="tag tag--accent">{t('world.characters.present')}</span>}
            </div>
          </div>
          <div className="module-person__tags">
            {heir.order && (
              <span className="tag" lang={lang}>
                {heir.order}
              </span>
            )}
            {heir.title && (
              <span className="tag tag--accent" lang={lang}>
                {heir.title}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mini-meters mini-meters--grid">
        <MeterBar label={t('world.lineage.aptitude.governance')} value={heir.aptitude.governance} />
        <MeterBar label={t('world.lineage.aptitude.martial')} value={heir.aptitude.martial} />
        <MeterBar label={t('world.lineage.aptitude.virtue')} value={heir.aptitude.virtue} />
        <MeterBar label={t('world.lineage.aptitude.learning')} value={heir.aptitude.learning} />
      </div>

      {(tutor || heir.backing) && (
        <div className="court-official__meta">
          {tutor && (
            <span>
              {t('world.lineage.tutor')}:{' '}
              <button
                type="button"
                className="link-btn"
                lang={lang}
                onClick={() => openDossier(tutor.id)}
              >
                {tutor.name}
              </button>
            </span>
          )}
          {heir.backing && (
            <span lang={lang}>
              {t('world.lineage.backing')}: {heir.backing}
            </span>
          )}
        </div>
      )}

      <div className="card__actions">
        <div className="card__actions-left">
          {character && (
            <button type="button" className="disclosure" onClick={() => openDossier(character.id)}>
              <Icon name="dossier" size={14} />
              {t('world.dossier.open')}
            </button>
          )}
          <button type="button" className="disclosure" onClick={handleNurtureDraft}>
            <Icon name="book" size={14} />
            {t('world.lineage.nurtureAction')}
          </button>
        </div>
        {talkable && (
          <button
            type="button"
            className={talking ? 'talk-button is-active' : 'talk-button'}
            onClick={handleTalk}
          >
            <Icon name="speech" size={14} />
            {talking ? t('world.characters.talking') : t('world.characters.talk')}
          </button>
        )}
      </div>
    </li>
  );
}

function RelativeCard({
  relative,
  world,
  lang,
}: {
  relative: ClanRelative;
  world: WorldState;
  lang: string;
}) {
  const { t } = useTranslation();
  const openDossier = useUi((s) => s.openDossier);
  const character = world.characters[relative.characterId];
  const name = character?.name ?? relative.characterId;

  return (
    <li className="card">
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
          </div>
          <div className="module-person__tags">
            {relative.relation && (
              <span className="tag tag--accent" lang={lang}>
                {relative.relation}
              </span>
            )}
            {relative.title && (
              <span className="tag" lang={lang}>
                {relative.title}
              </span>
            )}
          </div>
        </div>
      </div>
      <MeterBar label={t('world.lineage.influence')} value={relative.influence} />
      {relative.note && (
        <p className="card__text" lang={lang}>
          {relative.note}
        </p>
      )}
    </li>
  );
}

export function LineageTab({ session, lang }: { session: Session; lang: string }) {
  const { t } = useTranslation();
  const state = session.world.modules?.lineage;
  const [section, setSection] = useState<LineageSection>('consorts');

  if (!state) return null;

  const consorts = Object.values(state.consorts).sort(
    (a, b) => a.rankOrder - b.rankOrder || b.favor - a.favor,
  );
  const heirs = Object.values(state.heirs).sort(
    (a, b) => Number(b.isHeirApparent) - Number(a.isHeirApparent),
  );
  const relatives = Object.values(state.relatives).sort((a, b) => b.influence - a.influence);

  const sections: { id: LineageSection; count: number }[] = [
    { id: 'consorts', count: consorts.length },
    { id: 'heirs', count: heirs.length },
    { id: 'relatives', count: relatives.length },
  ];

  const activeSection: LineageSection =
    sections.find((s) => s.id === section && s.count > 0)?.id ??
    sections.find((s) => s.count > 0)?.id ??
    'consorts';

  return (
    <div className="module-tab">
      {(state.houseName || state.successionLaw) && (
        <header className="regime-banner">
          <div className="regime-banner__main">
            {state.houseName && (
              <h3 className="regime-banner__title" lang={lang}>
                {state.houseName}
              </h3>
            )}
          </div>
          {state.successionLaw && (
            <p className="regime-banner__meta" lang={lang}>
              {t('world.lineage.successionLaw')}: {state.successionLaw}
            </p>
          )}
        </header>
      )}

      <div className="subtabs" role="group" aria-label={t('world.tabs.lineage')}>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className="chip-button"
            aria-pressed={activeSection === s.id}
            onClick={() => setSection(s.id)}
          >
            {t(`world.lineage.sections.${s.id}`)}
            {s.count > 0 && <span className="subtabs__badge">{s.count}</span>}
          </button>
        ))}
      </div>

      {activeSection === 'consorts' &&
        (consorts.length > 0 ? (
          <ul className="cards">
            {consorts.map((c) => (
              <ConsortCard key={c.characterId} consort={c} session={session} lang={lang} />
            ))}
          </ul>
        ) : (
          <p className="tab-empty">{t('world.lineage.emptyConsorts')}</p>
        ))}

      {activeSection === 'heirs' &&
        (heirs.length > 0 ? (
          <ul className="cards">
            {heirs.map((h) => (
              <HeirCard key={h.characterId} heir={h} session={session} lang={lang} />
            ))}
          </ul>
        ) : (
          <p className="tab-empty">{t('world.lineage.emptyHeirs')}</p>
        ))}

      {activeSection === 'relatives' &&
        (relatives.length > 0 ? (
          <ul className="cards">
            {relatives.map((r) => (
              <RelativeCard key={r.characterId} relative={r} world={session.world} lang={lang} />
            ))}
          </ul>
        ) : (
          <p className="tab-empty">{t('world.lineage.emptyRelatives')}</p>
        ))}
    </div>
  );
}
