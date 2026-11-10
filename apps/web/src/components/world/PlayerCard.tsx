import type { DiceSystem, WorldState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { StatList } from './StatList';
import { Thumb } from './Thumb';

/** The rules checks are rolled by, under the stats: they say what the numbers mean. */
function DiceRules({ system }: { system: DiceSystem }) {
  const { t } = useTranslation();
  return (
    <div className="dice-rules">
      <span className="dice-rules__label">
        {t('world.dice.label')}
        <span className="tag tag--accent dice-rules__system">{system}</span>
      </span>
      <p className="dice-rules__text">{t(`world.dice.rules.${system}`)}</p>
    </div>
  );
}

interface PlayerCardProps {
  world: WorldState;
  /** Set while the story rolls checks. */
  diceSystem?: DiceSystem;
  lang: string;
}

export function PlayerCard({ world, diceSystem, lang }: PlayerCardProps) {
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
          {diceSystem && <DiceRules system={diceSystem} />}
        </>
      ) : (
        <p className="muted player-card__unknown">{t('world.playerUnknown')}</p>
      )}
    </section>
  );
}
