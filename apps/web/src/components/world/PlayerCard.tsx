import type { WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { StatList } from './StatList';
import { Thumb } from './Thumb';

export function PlayerCard({ world, lang }: { world: WorldState; lang: string }) {
  const { t } = useTranslation();
  const player = world.playerId ? world.characters[world.playerId] : undefined;

  return (
    <section className="player-card" aria-labelledby="player-card-heading">
      <h3 id="player-card-heading" className="eyebrow">
        {t('world.playerHeading')}
      </h3>
      {player ? (
        <>
          <div className="with-media">
            {player.imageUrl && (
              <Thumb
                url={player.imageUrl}
                alt={t('world.portraitOf', { name: player.name })}
                caption={player.name}
                shape="portrait"
                size="large"
                lang={lang}
              />
            )}
            <div className="with-media__main">
              <p className="player-card__name" lang={lang}>
                {player.name}
              </p>
              {player.role && (
                <p className="player-card__role" lang={lang}>
                  {player.role}
                </p>
              )}
              {player.status && (
                <p className="player-card__status" lang={lang}>
                  {player.status}
                </p>
              )}
            </div>
          </div>
          <StatList stats={player.stats} label={t('world.statsLabel', { name: player.name })} lang={lang} />
        </>
      ) : (
        <p className="muted player-card__unknown">{t('world.playerUnknown')}</p>
      )}
    </section>
  );
}
