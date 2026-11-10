import type { Character, WorldState } from '@roleplay/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isPresent, npcsOf } from '../../lib/world';
import { Icon } from '../Icon';
import { StatList } from './StatList';
import { Thumb } from './Thumb';

interface CharacterCardProps {
  character: Character;
  present: boolean;
  whereabouts: string | undefined;
  lang: string;
}

function CharacterCard({ character, present, whereabouts, lang }: CharacterCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const hasDetails = Boolean(character.description || character.personality || character.stats.length > 0);

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
      </dl>
      {hasDetails && (
        <>
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
          </div>
        </>
      )}
    </li>
  );
}

export function CharactersTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const npcs = npcsOf(world);
  if (npcs.length === 0) return <p className="tab-empty">{t('world.characters.empty')}</p>;

  return (
    <ul className="cards">
      {npcs.map((character) => {
        const present = isPresent(world, character);
        const whereabouts =
          !present && character.locationId ? world.locations[character.locationId]?.name : undefined;
        return (
          <CharacterCard key={character.id} character={character} present={present} whereabouts={whereabouts} lang={lang} />
        );
      })}
    </ul>
  );
}
