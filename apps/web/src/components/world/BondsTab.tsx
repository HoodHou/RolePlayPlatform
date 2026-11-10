import type { WorldState } from '@roleplay/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { bondsOf, type BondView } from '../../lib/bonds';
import { formatSigned } from '../../lib/text';
import { CharacterAvatar } from '../CharacterAvatar';
import { Icon } from '../Icon';
import { BondMeter } from './BondMeter';

function BondCard({ view, lang }: { view: BondView; lang: string }) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const id = useId();
  const [open, setOpen] = useState(false);
  const { bond, character, stage } = view;
  // Newest first: what moved it last is what the card leads with.
  const history = [...bond.history].reverse();
  const [latest, ...earlier] = history;

  return (
    <li className={`card bond stage--${stage}`}>
      <div className="bond__head">
        <CharacterAvatar name={character.name} imageUrl={character.imageUrl} size="small" />
        <div className="bond__who">
          <h4 id={`${id}-name`} className="card__title" lang={lang}>
            {character.name}
          </h4>
          {character.role && (
            <p className="bond__role" lang={lang}>
              {character.role}
            </p>
          )}
        </div>
        <div className="bond__standing" aria-hidden="true">
          <span className="bond__stage">{t(`world.bonds.stage.${stage}`)}</span>
          <span className="bond__score">{formatSigned(bond.score, uiTag)}</span>
        </div>
      </div>
      <BondMeter score={bond.score} name={character.name} />
      {latest && (
        <p className="bond__latest">
          <span className="card__label">{t('world.bonds.lately')}</span>
          <span className={latest.change > 0 ? 'bond__change is-up' : 'bond__change is-down'}>
            {formatSigned(latest.change, uiTag)}
          </span>{' '}
          <span lang={lang}>{latest.reason}</span>
        </p>
      )}
      {earlier.length > 0 && (
        <>
          <button
            type="button"
            className="disclosure"
            aria-expanded={open}
            aria-controls={`${id}-history`}
            aria-describedby={`${id}-name`}
            onClick={() => setOpen((value) => !value)}
          >
            {t('world.bonds.history')}
            <span className="disclosure__count">{history.length}</span>
            <Icon name="chevron" size={14} className="disclosure__chevron" />
          </button>
          <ol id={`${id}-history`} className="bond__history" hidden={!open}>
            {history.map((entry, index) => (
              <li key={`${entry.turn}:${index}`}>
                <span className={entry.change > 0 ? 'bond__change is-up' : 'bond__change is-down'}>
                  {formatSigned(entry.change, uiTag)}
                </span>
                <span className="bond__reason" lang={lang}>
                  {entry.reason}
                </span>
                <span className="bond__turn">{t('world.bonds.turn', { n: entry.turn })}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </li>
  );
}

/** Every bond with someone still in the cast, closest first: where it stands, its stage and what moved it lately. */
export function BondsTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const bonds = bondsOf(world);

  return (
    <div className="bonds">
      <ul className="cards">
        {bonds.map((view) => (
          <BondCard key={view.bond.characterId} view={view} lang={lang} />
        ))}
      </ul>
      <p className="world-note">{t('world.bonds.strangers')}</p>
    </div>
  );
}
