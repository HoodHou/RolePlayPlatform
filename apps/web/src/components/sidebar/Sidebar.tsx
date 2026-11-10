import { useTranslation } from 'react-i18next';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { LanguageToggle } from './LanguageToggle';
import { ProviderBadge } from './ProviderBadge';
import { SessionList } from './SessionList';

interface SidebarProps {
  /** Present when shown as a drawer. */
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const { t } = useTranslation();
  const openDialog = useUi((s) => s.openDialog);

  return (
    <div className="sidebar">
      <div className="sidebar__brand">
        <Icon name="logo" size={22} className="sidebar__logo" />
        <span className="sidebar__name">{t('app.name')}</span>
        {onClose && (
          <button type="button" className="icon-btn sidebar__close" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>

      <button type="button" className="btn btn--primary sidebar__new" onClick={() => openDialog('newGame')}>
        <Icon name="plus" size={16} />
        {t('sidebar.newGame')}
      </button>

      <nav className="sidebar__sessions" aria-label={t('sidebar.label')}>
        <h2 className="eyebrow sidebar__heading">{t('sidebar.savedGames')}</h2>
        <SessionList onOpened={onClose} />
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__footer-row">
          <LanguageToggle />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => openDialog('settings')}>
            <Icon name="settings" size={16} />
            {t('sidebar.settings')}
          </button>
        </div>
        <ProviderBadge />
      </div>
    </div>
  );
}
