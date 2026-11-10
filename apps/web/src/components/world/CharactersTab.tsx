import type { Character, WorldState } from '@roleplay/shared';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { bondOf } from '../../lib/bonds';
import { focusComposer } from '../../lib/composer';
import { canTalkTo, isPresent, npcsOf } from '../../lib/world';
import { useGame } from '../../store/game';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { BondBadge } from './BondMeter';
import { CharacterMind } from './CharacterMind';
import { SecretsSwitch } from './SecretsSwitch';
import { StatList } from './StatList';
import { Thumb } from './Thumb';

interface CharacterCardProps {
  character: Character;
  world: WorldState;
  lang: string;
  showSecrets: boolean;
}

function CharacterCard({ character, world, lang, showSecrets }: CharacterCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const talkingTo = useGame((s) => s.talkingTo);
  const startTalking = useGame((s) => s.startTalking);
  const closeDrawer = useUi((s) => s.closeDrawer);

  const present = isPresent(world, character);
  const whereabouts = !present && character.locationId ? world.locations[character.locationId]?.name : undefined;
  const talkable = canTalkTo(world, character.id);
  const talking = talkable && talkingTo === character.id;
  // Kept by the bonds module; a character with no entry is a stranger and shows none.
  const bond = bondOf(world, character.id);
  const hasDetails = Boolean(character.description || character.personality || character.stats.length > 0 || showSecrets);

  const talk = () => {
    // On narrow screens this panel is a drawer: close it (and let it restore focus) before focusing the composer.
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
              {character.name}
            </h4>
            {present && (
              <span className="tag tag--accent" title={t('world.characters.presentLabel')}>
                {t('world.characters.present')}
              </span>
            )}
          </div>
          {character.role && (
            <p className="card__subtitle" lang={lang}>
              {character.role}
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

      {(hasDetails || talkable) && (
        <div className="card__actions">
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
      )}

      {hasDetails && (
        <div id={`${id}-details`} className="card__details" hidden={!open}>
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
  const npcs = npcsOf(world);
  if (npcs.length === 0) return <p className="tab-empty">{t('world.characters.empty')}</p>;

  return (
    <div className="characters">
      <SecretsSwitch warning={t('world.characters.secretsWarning')} />
      <ul className="cards">
        {npcs.map((character) => (
          <CharacterCard key={character.id} character={character} world={world} lang={lang} showSecrets={showSecrets} />
        ))}
      </ul>
    </div>
  );
}
