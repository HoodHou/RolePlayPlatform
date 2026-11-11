import type { Character, WorldState } from '@roleplay/shared';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { bondOf } from '../../lib/bonds';
import { primaryStandingOf } from '../../lib/characterRoles';
import { focusComposer } from '../../lib/composer';
import { canTalkTo, isPresent, npcsOf } from '../../lib/world';
import { portraitKey, useGame } from '../../store/game';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { BondBadge } from './BondMeter';
import { CharacterMind } from './CharacterMind';
import { SecretsSwitch } from './SecretsSwitch';
import { StatList } from './StatList';
import { Thumb } from './Thumb';

type ViewMode = 'gallery' | 'list';
type CastFilter = 'all' | 'present';

interface CharacterItemProps {
  sessionId: string;
  character: Character;
  world: WorldState;
  lang: string;
  showSecrets: boolean;
  illustrationsActive: boolean;
}

function PortraitGalleryCard({
  sessionId,
  character,
  world,
  lang,
  illustrationsActive,
}: Omit<CharacterItemProps, 'showSecrets'>) {
  const { t } = useTranslation();
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const talkingTo = useGame((s) => s.talkingTo);
  const startTalking = useGame((s) => s.startTalking);
  const paintCharacterPortrait = useGame((s) => s.paintCharacterPortrait);
  const pKey = portraitKey(sessionId, character.id);
  const painting = useGame((s) => Boolean(s.paintingCharacters[pKey]));
  const openDossier = useUi((s) => s.openDossier);
  const closeDrawer = useUi((s) => s.closeDrawer);

  const present = isPresent(world, character);
  const talkable = canTalkTo(world, character.id);
  const talking = talkable && talkingTo === character.id;
  const standing = primaryStandingOf(world, character);
  const bond = bondOf(world, character.id);
  const hasPortrait = Boolean(character.imageUrl && character.imageUrl !== brokenUrl);
  const initial = Array.from(character.name.trim())[0]?.toUpperCase() ?? '?';

  const talk = () => {
    flushSync(() => {
      startTalking(character.id);
      closeDrawer();
    });
    focusComposer();
  };

  return (
    <li className={`portrait-card${present ? ' is-present' : ''}${painting ? ' is-painting' : ''}`}>
      <div className="portrait-card__visual">
        <button
          type="button"
          className="portrait-card__open"
          aria-label={t('world.dossier.openFor', { name: character.name })}
          onClick={() => openDossier(character.id)}
        >
          {hasPortrait && character.imageUrl ? (
            <img
              src={character.imageUrl}
              alt={t('world.portraitOf', { name: character.name })}
              loading="lazy"
              decoding="async"
              onError={() => setBrokenUrl(character.imageUrl ?? null)}
            />
          ) : (
            <div className="portrait-card__monogram" aria-hidden="true">
              <span className="portrait-card__initial">{initial}</span>
            </div>
          )}
          <div className="portrait-card__shade" aria-hidden="true" />
          <div className="portrait-card__overlay">
            {standing && (
              <span className="portrait-card__ribbon" lang={lang}>
                {standing}
              </span>
            )}
            <span className="portrait-card__name" lang={lang}>
              {character.name}
            </span>
          </div>
        </button>

        {present && (
          <span className="portrait-card__badge tag tag--accent" title={t('world.characters.presentLabel')}>
            {t('world.characters.present')}
          </span>
        )}

        {illustrationsActive && !hasPortrait && (
          <button
            type="button"
            className="portrait-card__paint"
            disabled={painting}
            title={t('world.dossier.paintPortrait')}
            aria-label={t('world.dossier.paintFor', { name: character.name })}
            onClick={() => void paintCharacterPortrait(character.id)}
          >
            <Icon name="sparkle" size={14} />
          </button>
        )}

        {painting && (
          <div className="portrait-card__painting" role="status">
            <span>{t('story.paintingImage')}</span>
          </div>
        )}
      </div>

      <div className="portrait-card__foot">
        <div className="portrait-card__meta">
          {bond ? (
            <BondBadge score={bond.score} name={character.name} />
          ) : character.attitude ? (
            <span className="portrait-card__attitude" lang={lang}>
              {character.attitude}
            </span>
          ) : (
            <span className="portrait-card__attitude muted">{t('world.dossier.open')}</span>
          )}
        </div>
        {talkable ? (
          <button
            type="button"
            className={talking ? 'portrait-card__talk is-active' : 'portrait-card__talk'}
            aria-pressed={talking}
            aria-label={t('world.characters.talkTo', { name: character.name })}
            title={t('world.characters.talkTo', { name: character.name })}
            onClick={talk}
          >
            <Icon name="speech" size={13} />
          </button>
        ) : (
          <button
            type="button"
            className="portrait-card__talk"
            aria-label={t('world.dossier.openFor', { name: character.name })}
            title={t('world.dossier.open')}
            onClick={() => openDossier(character.id)}
          >
            <Icon name="dossier" size={13} />
          </button>
        )}
      </div>
    </li>
  );
}

function CharacterCard({
  sessionId,
  character,
  world,
  lang,
  showSecrets,
  illustrationsActive,
}: CharacterItemProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const talkingTo = useGame((s) => s.talkingTo);
  const startTalking = useGame((s) => s.startTalking);
  const paintCharacterPortrait = useGame((s) => s.paintCharacterPortrait);
  const pKey = portraitKey(sessionId, character.id);
  const painting = useGame((s) => Boolean(s.paintingCharacters[pKey]));
  const openDossier = useUi((s) => s.openDossier);
  const closeDrawer = useUi((s) => s.closeDrawer);

  const present = isPresent(world, character);
  const whereabouts = !present && character.locationId ? world.locations[character.locationId]?.name : undefined;
  const talkable = canTalkTo(world, character.id);
  const talking = talkable && talkingTo === character.id;
  const standing = primaryStandingOf(world, character);
  const bond = bondOf(world, character.id);
  const hasDetails = Boolean(
    character.appearance ||
      character.description ||
      character.personality ||
      character.stats.length > 0 ||
      showSecrets,
  );

  const talk = () => {
    flushSync(() => {
      startTalking(character.id);
      closeDrawer();
    });
    focusComposer();
  };

  return (
    <li className={present ? 'card is-present' : 'card'}>
      <div className="with-media">
        {character.imageUrl && (
          <Thumb
            url={character.imageUrl}
            alt={t('world.portraitOf', { name: character.name })}
            caption={character.name}
            shape="portrait"
            lang={lang}
          />
        )}
        <div className="with-media__main">
          <div className="card__head">
            <h4 id={`${id}-name`} className="card__title" lang={lang}>
              <button
                type="button"
                className="card__title-link"
                onClick={() => openDossier(character.id)}
              >
                {character.name}
              </button>
            </h4>
            {present && (
              <span className="tag tag--accent" title={t('world.characters.presentLabel')}>
                {t('world.characters.present')}
              </span>
            )}
          </div>
          {standing && (
            <p className="card__subtitle" lang={lang}>
              {standing}
            </p>
          )}
        </div>
      </div>
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

      <div className="card__actions">
        <div className="card__actions-left">
          <button
            type="button"
            className="disclosure"
            onClick={() => openDossier(character.id)}
          >
            <Icon name="dossier" size={14} />
            {t('world.dossier.open')}
          </button>
          {illustrationsActive && !character.imageUrl && (
            <button
              type="button"
              className="disclosure"
              disabled={painting}
              onClick={() => void paintCharacterPortrait(character.id)}
            >
              <Icon name="sparkle" size={14} />
              {painting ? t('story.paintingImage') : t('world.dossier.paintShort')}
            </button>
          )}
          {hasDetails && (
            <button
              type="button"
              className="disclosure"
              aria-expanded={open}
              aria-controls={`${id}-details`}
              aria-describedby={`${id}-name`}
              onClick={() => setOpen((value) => !value)}
            >
              {t('world.characters.details')}
              <Icon name="chevron" size={14} className="disclosure__chevron" />
            </button>
          )}
        </div>
        {talkable && (
          <button
            type="button"
            className={talking ? 'talk-button is-active' : 'talk-button'}
            aria-pressed={talking}
            aria-label={t('world.characters.talkTo', { name: character.name })}
            onClick={talk}
          >
            <Icon name="speech" size={14} />
            {talking ? t('world.characters.talking') : t('world.characters.talk')}
          </button>
        )}
      </div>

      {hasDetails && (
        <div id={`${id}-details`} className="card__details" hidden={!open}>
          {character.appearance && (
            <div className="card__section">
              <h5 className="card__label">{t('world.characters.appearance')}</h5>
              <p className="card__text" lang={lang}>
                {character.appearance}
              </p>
            </div>
          )}
          {character.description && (
            <div className="card__section">
              <h5 className="card__label">{t('world.characters.description')}</h5>
              <p className="card__text" lang={lang}>
                {character.description}
              </p>
            </div>
          )}
          {character.personality && (
            <div className="card__section">
              <h5 className="card__label">{t('world.characters.personality')}</h5>
              <p className="card__text" lang={lang}>
                {character.personality}
              </p>
            </div>
          )}
          <StatList stats={character.stats} label={t('world.statsLabel', { name: character.name })} lang={lang} />
          {showSecrets && <CharacterMind character={character} world={world} lang={lang} />}
        </div>
      )}
    </li>
  );
}

export function CharactersTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const showSecrets = useUi((s) => s.showSecrets);
  const sessionId = useGame((s) => s.current?.id ?? '');
  const illustrationsActive = useSettings((s) => s.settings?.illustrationsActive ?? false);
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [filter, setFilter] = useState<CastFilter>('all');

  const npcs = npcsOf(world);
  if (npcs.length === 0) return <p className="tab-empty">{t('world.characters.empty')}</p>;

  const presentNpcs = npcs.filter((c) => isPresent(world, c));
  const filtered = filter === 'present' ? presentNpcs : npcs;

  return (
    <div className="characters">
      <div className="characters__toolbar">
        <div className="characters__filters" role="group" aria-label={t('world.characters.filterLabel')}>
          <button
            type="button"
            className="chip-button"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            {t('world.characters.filterAll', { count: npcs.length })}
          </button>
          <button
            type="button"
            className="chip-button"
            aria-pressed={filter === 'present'}
            onClick={() => setFilter('present')}
          >
            {t('world.characters.filterPresent', { count: presentNpcs.length })}
          </button>
        </div>
        <div className="characters__views" role="group" aria-label={t('world.characters.viewLabel')}>
          <button
            type="button"
            className="icon-btn characters__view-btn"
            aria-pressed={viewMode === 'gallery'}
            title={t('world.characters.viewGallery')}
            aria-label={t('world.characters.viewGallery')}
            onClick={() => setViewMode('gallery')}
          >
            <Icon name="grid" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn characters__view-btn"
            aria-pressed={viewMode === 'list'}
            title={t('world.characters.viewList')}
            aria-label={t('world.characters.viewList')}
            onClick={() => setViewMode('list')}
          >
            <Icon name="list" size={16} />
          </button>
        </div>
      </div>

      {viewMode === 'list' && <SecretsSwitch warning={t('world.characters.secretsWarning')} />}

      {filtered.length === 0 ? (
        <p className="tab-empty">{t('world.characters.emptyPresent')}</p>
      ) : viewMode === 'gallery' ? (
        <ul className="portrait-grid">
          {filtered.map((character) => (
            <PortraitGalleryCard
              key={character.id}
              sessionId={sessionId}
              character={character}
              world={world}
              lang={lang}
              illustrationsActive={illustrationsActive}
            />
          ))}
        </ul>
      ) : (
        <ul className="cards">
          {filtered.map((character) => (
            <CharacterCard
              key={character.id}
              sessionId={sessionId}
              character={character}
              world={world}
              lang={lang}
              showSecrets={showSecrets}
              illustrationsActive={illustrationsActive}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
