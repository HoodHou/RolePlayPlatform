import type { Character, Session, WorldState } from '@roleplay/shared';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { bondOf } from '../../lib/bonds';
import {
  draftSummonOrSeek,
  isImperialWorld,
  rolesOfCharacter,
} from '../../lib/characterRoles';
import { focusComposer } from '../../lib/composer';
import { describeError } from '../../lib/describe';
import { canTalkTo, isPresent } from '../../lib/world';
import { portraitKey, useGame } from '../../store/game';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { BondBadge } from './BondMeter';
import { CharacterMind } from './CharacterMind';
import { SecretsSwitch } from './SecretsSwitch';
import { StatList } from './StatList';

function MiniMeter({
  label,
  value,
  max = 100,
  tone = 'accent',
}: {
  label: string;
  value: number;
  max?: number;
  tone?: 'accent' | 'good' | 'bad';
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
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

function DossierContent({
  session,
  character,
  world,
  lang,
  onClose,
}: {
  session: Session;
  character: Character;
  world: WorldState;
  lang: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const promptId = useId();
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  const illustrationsActive = useSettings((s) => s.settings?.illustrationsActive ?? false);
  const showSecrets = useUi((s) => s.showSecrets);
  const openLightbox = useUi((s) => s.openLightbox);
  const openDossier = useUi((s) => s.openDossier);
  const closeDrawer = useUi((s) => s.closeDrawer);

  const talkingTo = useGame((s) => s.talkingTo);
  const startTalking = useGame((s) => s.startTalking);
  const stopTalking = useGame((s) => s.stopTalking);
  const setDraft = useGame((s) => s.setDraft);
  const paintCharacterPortrait = useGame((s) => s.paintCharacterPortrait);
  const dismissPortraitError = useGame((s) => s.dismissPortraitError);
  const pKey = portraitKey(session.id, character.id);
  const painting = useGame((s) => Boolean(s.paintingCharacters[pKey]));
  const portraitError = useGame((s) => s.portraitErrors[pKey]);

  const present = isPresent(world, character);
  const whereabouts = !present && character.locationId ? world.locations[character.locationId]?.name : undefined;
  const talkable = canTalkTo(world, character.id);
  const talking = talkable && talkingTo === character.id;
  const bond = !character.isPlayer ? bondOf(world, character.id) : undefined;
  const roles = rolesOfCharacter(world, character.id);
  const imperial = isImperialWorld(world);

  const hasPortrait = Boolean(character.imageUrl && character.imageUrl !== brokenUrl);
  const initial = Array.from(character.name.trim())[0]?.toUpperCase() ?? '?';

  const tutor = roles.heir?.tutorId ? world.characters[roles.heir.tutorId] : undefined;

  const handlePaint = () => {
    const trimmed = customPrompt.trim();
    void paintCharacterPortrait(character.id, trimmed || undefined);
  };

  const handleTalk = () => {
    flushSync(() => {
      startTalking(character.id);
      onClose();
      closeDrawer();
    });
    focusComposer();
  };

  const handleSummonOrSeek = () => {
    const text = draftSummonOrSeek(session, character);
    flushSync(() => {
      stopTalking();
      setDraft(text);
      onClose();
      closeDrawer();
    });
    focusComposer();
  };

  return (
    <Modal labelledBy={titleId} onClose={onClose} dismissOnBackdrop wide className="modal--dossier">
      <div className="dossier">
        <div className="dossier__media">
          <div className={`dossier__frame${painting ? ' is-painting' : ''}`}>
            {hasPortrait && character.imageUrl ? (
              <button
                type="button"
                className="dossier__portrait-btn"
                aria-label={t('story.viewLarger')}
                onClick={() => openLightbox({ url: character.imageUrl!, caption: character.name, lang })}
              >
                <img
                  src={character.imageUrl}
                  alt={t('world.portraitOf', { name: character.name })}
                  onError={() => setBrokenUrl(character.imageUrl ?? null)}
                />
                <span className="dossier__zoom" aria-hidden="true">
                  <Icon name="expand" size={14} />
                </span>
              </button>
            ) : (
              <div className="dossier__placeholder">
                <span className="dossier__initial" aria-hidden="true">
                  {initial}
                </span>
                <p className="dossier__no-portrait">{t('world.dossier.noPortrait')}</p>
              </div>
            )}
            {painting && (
              <div className="dossier__painting-overlay" role="status">
                <span>{t('story.paintingImage')}</span>
              </div>
            )}
          </div>

          {illustrationsActive && (
            <div className="dossier__paint-controls">
              <div className="dossier__paint-row">
                <button
                  type="button"
                  className={hasPortrait ? 'btn btn--small dossier__paint-btn' : 'btn btn--primary btn--small dossier__paint-btn'}
                  disabled={painting}
                  onClick={handlePaint}
                >
                  <Icon name={hasPortrait ? 'retry' : 'sparkle'} size={14} />
                  {painting
                    ? t('story.paintingImage')
                    : hasPortrait
                      ? t('world.dossier.repaintPortrait')
                      : t('world.dossier.paintPortrait')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  aria-expanded={showPromptInput}
                  aria-controls={promptId}
                  title={t('world.dossier.customPromptToggle')}
                  onClick={() => setShowPromptInput((v) => !v)}
                >
                  <Icon name="settings" size={14} />
                </button>
              </div>
              {showPromptInput && (
                <div id={promptId} className="dossier__prompt-box">
                  <input
                    type="text"
                    className="input dossier__prompt-input"
                    value={customPrompt}
                    placeholder={t('world.dossier.customPromptPlaceholder')}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !painting) {
                        e.preventDefault();
                        handlePaint();
                      }
                    }}
                  />
                </div>
              )}
              {portraitError && (
                <div className="dossier__paint-error" role="alert">
                  <span>{describeError(t, portraitError)}</span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => dismissPortraitError(character.id)}
                  >
                    {t('common.dismiss')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="dossier__main">
          <header className="dossier__head">
            <div className="dossier__title-group">
              <div className="dossier__name-row">
                <h2 id={titleId} className="dossier__name" lang={lang}>
                  {character.name}
                </h2>
                {present && (
                  <span className="tag tag--accent" title={t('world.characters.presentLabel')}>
                    {t('world.characters.present')}
                  </span>
                )}
                {character.isPlayer && <span className="tag tag--accent">{t('world.playerHeading')}</span>}
              </div>
              {character.role && (
                <p className="dossier__role" lang={lang}>
                  {character.role}
                </p>
              )}
              <div className="dossier__badges">
                {roles.official && (
                  <>
                    <span className="tag tag--accent" lang={lang}>
                      {roles.official.office}
                      {roles.official.rank ? ` · ${roles.official.rank}` : ''}
                    </span>
                    {roles.official.department && (
                      <span className="tag" lang={lang}>
                        {roles.official.department}
                      </span>
                    )}
                    {roles.faction && (
                      <span className="tag" lang={lang}>
                        {roles.faction.name}
                      </span>
                    )}
                  </>
                )}
                {roles.heir && (
                  <>
                    {roles.heir.isHeirApparent && (
                      <span className="tag tag--accent">{t('world.lineage.heirApparent')}</span>
                    )}
                    {(roles.heir.title || roles.heir.order) && (
                      <span className="tag" lang={lang}>
                        {[roles.heir.order, roles.heir.title].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </>
                )}
                {roles.consort && (
                  <>
                    <span className="tag tag--accent" lang={lang}>
                      {roles.consort.title}
                    </span>
                    {roles.consort.palace && (
                      <span className="tag" lang={lang}>
                        {roles.consort.palace}
                      </span>
                    )}
                  </>
                )}
                {roles.relative && (
                  <span className="tag" lang={lang}>
                    {[roles.relative.relation, roles.relative.title].filter(Boolean).join(' · ')}
                  </span>
                )}
                {roles.stewardFacilities.map((f) => (
                  <span key={f.id} className="tag" lang={lang}>
                    {t('world.domain.stewardBadge', { facility: f.name })}
                  </span>
                ))}
                {roles.isSpyCommander && (
                  <span className="tag tag--secret">{t('world.espionage.commander')}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="icon-btn dossier__close"
              data-autofocus
              aria-label={t('common.close')}
              onClick={onClose}
            >
              <Icon name="close" size={18} />
            </button>
          </header>

          <div className="dossier__body">
            <dl className="facts">
              {character.attitude && (
                <div className="facts__row">
                  <dt>{t('world.characters.attitude')}</dt>
                  <dd lang={lang}>{character.attitude}</dd>
                </div>
              )}
              {character.status && (
                <div className="facts__row">
                  <dt>{t('world.characters.status')}</dt>
                  <dd lang={lang}>{character.status}</dd>
                </div>
              )}
              {whereabouts && (
                <div className="facts__row">
                  <dt>{t('world.characters.whereabouts')}</dt>
                  <dd lang={lang}>{whereabouts}</dd>
                </div>
              )}
              {bond && (
                <div className="facts__row">
                  <dt>{t('world.characters.bond')}</dt>
                  <dd>
                    <BondBadge score={bond.score} name={character.name} />
                  </dd>
                </div>
              )}
            </dl>

            {roles.official && (
              <section className="dossier__section">
                <h3 className="card__label">{t('world.dossier.courtRecord')}</h3>
                {roles.official.assignment && (
                  <p className="card__meta" lang={lang}>
                    {t('world.court.assignment')}: {roles.official.assignment}
                  </p>
                )}
                <div className="mini-meters">
                  <MiniMeter label={t('world.court.stats.governance')} value={roles.official.governance} />
                  <MiniMeter label={t('world.court.stats.military')} value={roles.official.military} />
                  <MiniMeter label={t('world.court.stats.intrigue')} value={roles.official.intrigue} />
                  <MiniMeter label={t('world.court.stats.influence')} value={roles.official.influence} />
                  <MiniMeter
                    label={t('world.court.stats.loyalty')}
                    value={roles.official.loyalty}
                    tone={roles.official.loyalty >= 70 ? 'good' : roles.official.loyalty <= 35 ? 'bad' : 'accent'}
                  />
                </div>
              </section>
            )}

            {(roles.consort || roles.heir || roles.relative) && (
              <section className="dossier__section">
                <h3 className="card__label">{t('world.dossier.householdRecord')}</h3>
                {roles.consort && (
                  <>
                    <MiniMeter
                      label={t('world.lineage.favor')}
                      value={roles.consort.favor}
                      tone={roles.consort.favor >= 70 ? 'good' : 'accent'}
                    />
                    {roles.consort.familyBackground && (
                      <p className="card__meta" lang={lang}>
                        {t('world.lineage.familyBackground')}: {roles.consort.familyBackground}
                      </p>
                    )}
                  </>
                )}
                {roles.heir && (
                  <>
                    <div className="mini-meters">
                      <MiniMeter label={t('world.lineage.aptitude.governance')} value={roles.heir.aptitude.governance} />
                      <MiniMeter label={t('world.lineage.aptitude.martial')} value={roles.heir.aptitude.martial} />
                      <MiniMeter label={t('world.lineage.aptitude.virtue')} value={roles.heir.aptitude.virtue} />
                      <MiniMeter label={t('world.lineage.aptitude.learning')} value={roles.heir.aptitude.learning} />
                    </div>
                    {tutor && (
                      <p className="card__meta">
                        {t('world.lineage.tutor')}:{' '}
                        <button
                          type="button"
                          className="link-btn"
                          lang={lang}
                          onClick={() => openDossier(tutor.id)}
                        >
                          {tutor.name}
                        </button>
                      </p>
                    )}
                    {roles.heir.backing && (
                      <p className="card__meta" lang={lang}>
                        {t('world.lineage.backing')}: {roles.heir.backing}
                      </p>
                    )}
                  </>
                )}
                {roles.relative && (
                  <>
                    <MiniMeter label={t('world.lineage.influence')} value={roles.relative.influence} />
                    {roles.relative.note && (
                      <p className="card__text" lang={lang}>
                        {roles.relative.note}
                      </p>
                    )}
                  </>
                )}
              </section>
            )}

            {character.appearance && (
              <section className="dossier__section">
                <h3 className="card__label">{t('world.characters.appearance')}</h3>
                <p className="card__text" lang={lang}>
                  {character.appearance}
                </p>
              </section>
            )}

            {character.description && (
              <section className="dossier__section">
                <h3 className="card__label">{t('world.characters.description')}</h3>
                <p className="card__text" lang={lang}>
                  {character.description}
                </p>
              </section>
            )}

            {character.personality && (
              <section className="dossier__section">
                <h3 className="card__label">{t('world.characters.personality')}</h3>
                <p className="card__text" lang={lang}>
                  {character.personality}
                </p>
              </section>
            )}

            {character.stats.length > 0 && (
              <section className="dossier__section">
                <h3 className="card__label">{t('world.statsLabel', { name: character.name })}</h3>
                <StatList stats={character.stats} label={t('world.statsLabel', { name: character.name })} lang={lang} />
              </section>
            )}

            {!character.isPlayer && (
              <section className="dossier__section">
                <SecretsSwitch warning={t('world.characters.secretsWarning')} />
                {showSecrets && <CharacterMind character={character} world={world} lang={lang} />}
              </section>
            )}
          </div>

          {!character.isPlayer && (
            <footer className="dossier__foot">
              {talkable ? (
                <button
                  type="button"
                  className={talking ? 'btn btn--small is-active' : 'btn btn--primary btn--small'}
                  onClick={handleTalk}
                >
                  <Icon name="speech" size={15} />
                  {talking
                    ? t('world.characters.talking')
                    : imperial
                      ? t('world.dossier.audience')
                      : t('world.characters.talk')}
                </button>
              ) : (
                <button type="button" className="btn btn--small" onClick={handleSummonOrSeek}>
                  <Icon name="speech" size={15} />
                  {imperial ? t('world.dossier.summon') : t('world.dossier.seekOut')}
                </button>
              )}
            </footer>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function CharacterDossierModal() {
  const session = useGame((s) => s.current);
  const characterId = useUi((s) => s.dossierCharacterId);
  const closeDossier = useUi((s) => s.closeDossier);

  if (!session || !characterId) return null;
  const character = session.world.characters[characterId];
  if (!character) return null;

  return (
    <DossierContent
      key={`${session.id}:${character.id}`}
      session={session}
      character={character}
      world={session.world}
      lang={languageTag(session.language)}
      onClose={closeDossier}
    />
  );
}
