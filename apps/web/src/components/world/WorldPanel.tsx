import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { playedModules } from '../../lib/modules';
import { useGame } from '../../store/game';
import { useSubscriptions } from '../../store/library';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { PlayerCard } from './PlayerCard';
import { WorldTabs } from './WorldTabs';

/** The right-hand panel: world view + interactive module command workspace. */
export function WorldPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const session = useGame((s) => s.current);
  const stagedCount = useGame((s) => (s.current ? (s.stagedDirectives[s.current.id]?.length ?? 0) : 0));
  const lastNotice = useGame((s) => s.lastModuleNotice);
  const dismissNotice = useGame((s) => s.dismissModuleNotice);
  const workspaceExpanded = useUi((s) => s.workspaceExpanded);
  const toggleWorkspaceExpanded = useUi((s) => s.toggleWorkspaceExpanded);
  const subscriptions = useSubscriptions();

  let body = <p className="world__empty">{t('world.noSession')}</p>;
  if (session) {
    const lang = languageTag(session.language);
    // The rules only mean something while checks are still being rolled by them.
    const diceSystem = playedModules(session, subscriptions).includes('dice') ? session.world.modules?.dice?.system : undefined;
    body = (
      <div className="world__body">
        {lastNotice && (
          <div className={lastNotice.isError ? 'world__notice is-error' : 'world__notice'} role="status">
            <span className="world__notice-text">{lastNotice.text}</span>
            <button
              type="button"
              className="world__notice-close"
              aria-label={t('common.dismiss')}
              onClick={dismissNotice}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <PlayerCard world={session.world} diceSystem={diceSystem} lang={lang} />
        <WorldTabs session={session} subscriptions={subscriptions} lang={lang} />
      </div>
    );
  }

  return (
    <div className="world">
      <div className="world__head">
        <div className="world__head-left">
          <h2 className="eyebrow">{t('world.title')}</h2>
          {stagedCount > 0 && (
            <span className="tag tag--accent">{t('world.workspace.stagedBadge', { count: stagedCount })}</span>
          )}
        </div>
        <div className="world__head-actions">
          {!onClose && (
            <button
              type="button"
              className={workspaceExpanded ? 'icon-btn is-active' : 'icon-btn'}
              aria-pressed={workspaceExpanded}
              aria-label={workspaceExpanded ? t('world.workspace.collapse') : t('world.workspace.expand')}
              title={workspaceExpanded ? t('world.workspace.collapse') : t('world.workspace.expand')}
              onClick={toggleWorkspaceExpanded}
            >
              <Icon name="panelWide" size={17} />
            </button>
          )}
          {onClose && (
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
              <Icon name="close" />
            </button>
          )}
        </div>
      </div>
      {body}
    </div>
  );
}
