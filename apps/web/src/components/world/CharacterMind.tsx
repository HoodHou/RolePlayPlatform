import type { Character, Memory, WorldState } from '@roleplay/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { memoriesOf } from '../../lib/world';

/** How many memories show before "show all". */
const RECENT_MEMORIES = 5;

function Importance({ value }: { value: number }) {
  const { t } = useTranslation();
  const level = Math.min(5, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
  return (
    <span className="memory__importance" role="img" aria-label={t('world.mind.importance', { n: level })}>
      {[1, 2, 3, 4, 5].map((step) => (
        <span key={step} className={step <= level ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

function MemoryItem({ memory, world, lang }: { memory: Memory; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const place = memory.locationId ? world.locations[memory.locationId]?.name : undefined;
  const when = [memory.time, place].filter((part): part is string => Boolean(part)).join(' · ');
  // `toldBy` is expected to be a character id; a name (or a departed character) is shown as given.
  const source = memory.toldBy ? (world.characters[memory.toldBy]?.name ?? memory.toldBy) : undefined;

  return (
    <li className="memory">
      <div className="memory__meta">
        <Importance value={memory.importance} />
        {when && <span lang={lang}>{when}</span>}
      </div>
      <p className="memory__text" lang={lang}>
        {memory.text}
      </p>
      {source && (
        <p className="memory__source">
          {t('world.mind.toldBy', { name: source })}
        </p>
      )}
    </li>
  );
}

/**
 * The character's mind: voice, goals, secrets and memories. Spoilers, shown only
 * with the game master's secrets switched on; styled as backstage material.
 */
export function CharacterMind({ character, world, lang }: { character: Character; world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const memories = memoriesOf(character);
  const shown = showAll ? memories : memories.slice(0, RECENT_MEMORIES);
  const fields = [
    { label: t('world.mind.voice'), text: character.voice },
    { label: t('world.mind.goals'), text: character.goals },
    { label: t('world.mind.secrets'), text: character.secrets },
  ].filter((field) => typeof field.text === 'string' && field.text.trim() !== '');

  return (
    <section className="mind" aria-label={t('world.mind.title')}>
      <p className="mind__title">{t('world.mind.title')}</p>
      {fields.map((field) => (
        <div key={field.label} className="card__section">
          <h5 className="card__label">{field.label}</h5>
          <p className="card__text" lang={lang}>
            {field.text}
          </p>
        </div>
      ))}
      <div className="card__section">
        <h5 className="card__label">
          {t('world.mind.memories')}
          {memories.length > 0 && <span className="mind__count">{memories.length}</span>}
        </h5>
        {memories.length === 0 ? (
          <p className="mind__empty">{t('world.mind.noMemories')}</p>
        ) : (
          <ol className="memories">
            {shown.map((memory) => (
              <MemoryItem key={memory.id} memory={memory} world={world} lang={lang} />
            ))}
          </ol>
        )}
        {memories.length > RECENT_MEMORIES && (
          <button type="button" className="disclosure" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? t('world.mind.showFewer') : t('world.mind.showAll', { n: memories.length })}
          </button>
        )}
      </div>
    </section>
  );
}
