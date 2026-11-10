import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';

export function DemoBanner() {
  const { t } = useTranslation();
  const isDemo = useSettings((s) => s.settings?.gameMaster.provider === 'mock');
  const openDialog = useUi((s) => s.openDialog);
  if (!isDemo) return null;

  return (
    <div className="demo-banner" role="note">
      <Icon name="info" size={16} className="demo-banner__icon" />
      <span>{t('demo.message')}</span>
      <button type="button" className="link-btn" onClick={() => openDialog('settings')}>
        {t('demo.action')}
      </button>
    </div>
  );
}
