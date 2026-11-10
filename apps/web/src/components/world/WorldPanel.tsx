import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { playedModules } from '../../lib/modules';
import { useGame } from '../../store/game';
import { useSubscriptions } from '../../store/library';
import { Icon } from '../Icon';
import { PlayerCard } from './PlayerCard';
import { WorldTabs } from './WorldTabs';

/** The right-hand panel: a read-only view of the world the game master maintains. */
export function WorldPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const session = useGame((s) => s.current);
  const subscriptions = useSubscriptions();

  let body = <p className="world__empty">{t('world.noSession')}</p>;
  if (session) {
    const lang = languageTag(session.language);
    // The rules only mean something while checks are still being rolled by them.
    const diceSystem = playedModules(session, subscriptions).includes('dice') ? session.world.modules?.dice?.system : undefined;
    body = (
      <div className="world__body">
        <PlayerCard world={session.world} diceSystem={diceSystem} lang={lang} />
        <WorldTabs session={session} subscriptions={subscriptions} lang={lang} />
      </div>
    );
  }

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
      {body}
    </div>
  );
}
