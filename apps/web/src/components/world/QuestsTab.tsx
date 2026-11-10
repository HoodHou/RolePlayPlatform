import type { WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { sortedQuests } from '../../lib/world';

export function QuestsTab({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const quests = sortedQuests(world);
  if (quests.length === 0) return <p className="tab-empty">{t('world.quests.empty')}</p>;

  return (
    <ul className="cards">
      {quests.map((quest) => (
        <li key={quest.id} className={`card quest quest--${quest.status}`}>
          <div className="card__head">
            <h4 className="card__title" lang={lang}>
              {quest.title}
            </h4>
            <span className={`tag tag--${quest.status}`}>{t(`world.quests.status.${quest.status}`)}</span>
          </div>
          {quest.description && (
            <p className="card__text" lang={lang}>
              {quest.description}
            </p>
          )}
          {quest.progress && (
            <div className="quest__progress">
              <span className="card__label">{t('world.quests.progress')}</span>
              <p className="card__text" lang={lang}>
                {quest.progress}
              </p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
