import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';

interface PlayerActionProps {
  text: string;
  /** The player character's name, once the game master has created one. */
  speaker: string | undefined;
  /** Who it was said to, for words addressed to one character. */
  toName: string | undefined;
  lang: string;
  /** Sent, but not yet confirmed by the server. */
  pending: boolean;
  turn?: number;
  onBranch?: (turn: number) => void;
}

export const PlayerAction = memo(function PlayerAction({
  text,
  speaker,
  toName,
  lang,
  pending,
  turn,
  onBranch,
}: PlayerActionProps) {
  const { t } = useTranslation();
  return (
    <div className={pending ? 'player-action is-pending' : 'player-action'}>
      <div className="player-action__head">
        <span className="player-action__who" lang={speaker ? lang : undefined}>
          {speaker ?? t('story.you')}
        </span>
        {toName && <span className="player-action__to">{t('story.saidTo', { name: toName })}</span>}
        {!pending && turn !== undefined && onBranch && (
          <button
            type="button"
            className="player-action__branch"
            title={t('story.branchFromTurn', { turn })}
            onClick={() => onBranch(turn)}
          >
            <Icon name="branch" size={13} />
            <span>{t('story.branchShort')}</span>
          </button>
        )}
      </div>
      <p className="player-action__text" lang={lang}>
        {text}
      </p>
    </div>
  );
});
