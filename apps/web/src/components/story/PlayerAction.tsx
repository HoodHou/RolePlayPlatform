import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface PlayerActionProps {
  text: string;
  /** The player character's name, once the game master has created one. */
  speaker: string | undefined;
  lang: string;
  /** Sent, but not yet confirmed by the server. */
  pending: boolean;
}

export const PlayerAction = memo(function PlayerAction({ text, speaker, lang, pending }: PlayerActionProps) {
  const { t } = useTranslation();
  return (
    <div className={pending ? 'player-action is-pending' : 'player-action'}>
      <span className="player-action__who" lang={speaker ? lang : undefined}>
        {speaker ?? t('story.you')}
      </span>
      <p className="player-action__text" lang={lang}>
        {text}
      </p>
    </div>
  );
});
