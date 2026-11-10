import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { useGame } from '../../store/game';
import { Icon } from '../Icon';
import { PlayerCard } from './PlayerCard';
import { WorldTabs } from './WorldTabs';

/** The right-hand panel: a read-only view of the world the game master maintains. */
export function WorldPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const session = useGame((s) => s.current);

  return (
    <div className="world">
      <div className="world__head">
        <h2 className="eyebrow">{t('world.title')}</h2>
        {onClose && (
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {session ? (
        <div className="world__body">
          <PlayerCard world={session.world} lang={languageTag(session.language)} />
          <WorldTabs world={session.world} lang={languageTag(session.language)} />
        </div>
      ) : (
        <p className="world__empty">{t('world.noSession')}</p>
      )}
    </div>
  );
}
